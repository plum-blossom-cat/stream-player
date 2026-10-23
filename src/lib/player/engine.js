// @ts-ignore
import shaka from "shaka-player/dist/shaka-player.compiled.js";
import JSON5 from "json5";
import { isTauri, parseHeaders, hostOf } from "$lib";
import { TauriFetchLoader } from "$lib/TauriFetchLoader.js";
import { detectFormat, parseClearKeys } from "$lib/stream.js";

export { shaka };

// Many DASH origins only answer Android clients, so that's the default when no UA is given.
const DEFAULT_USER_AGENT =
  "Dalvik/2.1.0 (Linux; U; Android 11; MI 6X Build/RQ3A.211001.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Mobile Safari/537.36";

let installed = false;

export function installShaka() {
  if (installed) return;
  installed = true;
  shaka.polyfill.installAll();

  // Route media requests through the Rust HTTP client so custom headers
  // (Referer, Origin, Cookie, User-Agent) are actually sent and CORS doesn't apply.
  // blob: URLs stay with Shaka's own loader.
  if (isTauri) {
    for (const scheme of ["http", "https"]) {
      shaka.net.NetworkingEngine.registerScheme(
        scheme,
        TauriFetchLoader.parse,
        shaka.net.NetworkingEngine.PluginPriority.PREFERRED,
        false
      );
    }
  }
}

/** @param {StreamFormData} stream */
function buildHeaders(stream) {
  const extra = parseHeaders(stream.requestHeaders);

  // Browsers silently drop these, and adding them can break CORS preflight.
  if (!isTauri) return extra;

  const url = new URL(stream.streamUrl);
  const headers = {
    referer: stream.referer.trim() || `${url.origin}/`,
    origin: stream.origin.trim() || url.origin,
    "user-agent": stream.userAgent.trim() || DEFAULT_USER_AGENT,
    ...extra,
  };
  if (stream.cookie.trim()) headers.cookie = stream.cookie.trim();
  return headers;
}

/** @param {StreamFormData} stream */
function buildDrmConfig(stream) {
  const scheme = stream.drmScheme;

  if (scheme === "clearkey_inline") {
    const clearKeys = parseClearKeys(stream.clearKey);
    return Object.keys(clearKeys).length ? { clearKeys } : null;
  }

  if (scheme === "org.w3.clearkey") {
    return { servers: { "org.w3.clearkey": stream.licenseUrl.trim() } };
  }

  if (scheme === "com.widevine.alpha" || scheme === "com.microsoft.playready") {
    const drm = { servers: { [scheme]: stream.licenseUrl.trim() } };
    if (stream.certificateUrl.trim()) {
      // serverCertificateUri takes a URL; serverCertificate wants raw bytes.
      drm.advanced = { [scheme]: { serverCertificateUri: stream.certificateUrl.trim() } };
    }
    return drm;
  }

  return null;
}

/**
 * Configure the player for this stream and load it.
 * @param {any} player shaka.Player
 * @param {StreamFormData} stream
 * @param {{ audio?: { language: string, label: string } | null }} [options]
 *   audio: the audio the viewer picked last time, used when the stream offers it
 */
export async function loadStream(player, stream, options = {}) {
  player.resetConfiguration();

  const { kind, mimeType } = detectFormat(stream);

  player.configure({
    manifest: {
      dash: { autoCorrectDrift: true, ignoreSuggestedPresentationDelay: true },
      hls: { liveSegmentsDelay: 3 },
      retryParameters: { maxAttempts: 3, baseDelay: 600, timeout: 20000 },
    },
    abr: { enabled: true },
    streaming: {
      bufferingGoal: 20,
      rebufferingGoal: 2,
      bufferBehind: 30,
      segmentPrefetchLimit: 2,
      lowLatencyMode: false,
      retryParameters: { maxAttempts: 4, baseDelay: 500, timeout: 20000 },
    },
  });

  // Shaka falls back to its normal choice when the stream has no matching track.
  if (options.audio) {
    player.configure({
      preferredAudioLanguage: options.audio.language || "",
      preferredAudioLabel: options.audio.label || "",
    });
  }

  const drm = buildDrmConfig(stream);
  if (drm) player.configure({ drm });

  if (stream.shakaConfig.trim()) {
    try {
      player.configure(JSON5.parse(stream.shakaConfig));
    } catch (error) {
      console.warn("Ignoring invalid player config", error);
    }
  }

  const headers = buildHeaders(stream);
  const licenseHeaders = parseHeaders(stream.licenseHeaders);
  const certificateHeaders = parseHeaders(stream.certificateHeaders);
  const RequestType = shaka.net.NetworkingEngine.RequestType;

  const net = player.getNetworkingEngine();
  net.clearAllRequestFilters();
  net.registerRequestFilter((type, request) => {
    request.headers = { ...request.headers, ...headers };

    if (type === RequestType.LICENSE) {
      request.headers = { ...request.headers, ...licenseHeaders };
      if (stream.drmScheme === "org.w3.clearkey" && !request.headers["content-type"]) {
        request.headers["content-type"] = "application/json";
      }
    }

    if (type === RequestType.SERVER_CERTIFICATE) {
      request.headers = { ...request.headers, ...certificateHeaders };
    }
  });

  await player.load(stream.streamUrl, null, mimeType ?? undefined);
  return kind;
}

/** Errors that only mean "a newer load replaced this one". */
export function isInterruption(error) {
  const Code = shaka.util.Error.Code;
  return error?.code === Code.LOAD_INTERRUPTED || error?.code === Code.OPERATION_ABORTED;
}

/**
 * Turn a Shaka error into something a person can act on.
 * @param {any} error
 * @param {StreamFormData} stream
 * @returns {{ title: string, detail: string, code: string }}
 */
export function describeError(error, stream) {
  const Code = shaka.util.Error.Code;
  const name = Object.keys(Code).find((key) => Code[key] === error?.code) || "UNKNOWN";
  const code = error?.code ? `Shaka error ${error.code}, ${name}` : String(error?.message || error);
  const host = hostOf(error?.data?.[0] || stream?.streamUrl || "");
  const scheme = error?.data?.[0];

  switch (error?.code) {
    case Code.UNSUPPORTED_SCHEME:
      return {
        title: "This address isn't an http or https link",
        detail: "Check the start of the stream URL for stray characters, then play it again.",
        code,
      };
    case Code.BAD_HTTP_STATUS:
      return {
        title: `The server answered HTTP ${error.data?.[1]}`,
        detail: [401, 403].includes(error.data?.[1])
          ? `${host} refused the request. It usually wants a specific Referer, Origin, Cookie or User-Agent header.`
          : `${host} couldn't serve part of this stream. The link may have expired or moved.`,
        code,
      };
    case Code.HTTP_ERROR:
      return {
        title: `Couldn't reach ${host}`,
        detail: isTauri
          ? "Check the URL and your connection, then try again."
          : "Check the URL and your connection. In a browser the server must also allow cross-origin requests. The desktop app doesn't need that.",
        code,
      };
    case Code.TIMEOUT:
      return { title: "The server took too long to respond", detail: `${host} didn't answer in 20 seconds. Try again or check the URL.`, code };
    case Code.NO_LICENSE_SERVER_GIVEN:
      return {
        title: "This stream is encrypted",
        detail: `It needs ${scheme || "a DRM system"}. Open it in the workspace and add ClearKey keys or a license server under Content protection.`,
        code,
      };
    case Code.REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE:
      return {
        title: "This DRM system isn't available here",
        detail: "The built-in browser engine can't decrypt this stream with the chosen DRM scheme. ClearKey streams work everywhere.",
        code,
      };
    case Code.LICENSE_REQUEST_FAILED:
      return { title: "The license request failed", detail: "Check the license server URL and any license headers it needs.", code };
    case Code.UNABLE_TO_GUESS_MANIFEST_TYPE:
      return { title: "Couldn't tell what kind of stream this is", detail: "Set the format to HLS or DASH and play it again.", code };
    case Code.CONTENT_UNSUPPORTED_BY_BROWSER:
      return { title: "Unsupported codecs", detail: "This stream uses audio or video codecs the player can't decode on this device.", code };
    case Code.HLS_PLAYLIST_HEADER_MISSING:
    case Code.DASH_INVALID_XML:
      return {
        title: "The manifest couldn't be read",
        detail: "The URL returned something other than an HLS playlist or DASH manifest. Often that means a login page or an error page.",
        code,
      };
    default:
      return {
        title: "Playback stopped",
        detail: error?.message && !/^Shaka Error/.test(error.message) ? error.message : "Something went wrong while playing this stream.",
        code,
      };
  }
}
