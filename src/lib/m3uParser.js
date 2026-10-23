const DEFAULT_STREAM = {
  streamUrl: "",
  streamType: "auto",
  cookie: "",
  referer: "",
  origin: "",
  userAgent: "",
  drmScheme: "none",
  clearKey: "",
  licenseUrl: "",
  licenseHeaders: "",
  certificateUrl: "",
  certificateHeaders: "",
  requestHeaders: "",
  shakaConfig: "",
};

const HEADER_ALIASES = {
  "http-referrer": "referer",
  "http-referer": "referer",
  referrer: "referer",
  referer: "referer",
  "http-origin": "origin",
  origin: "origin",
  "http-user-agent": "userAgent",
  "user-agent": "userAgent",
  useragent: "userAgent",
  "http-cookie": "cookie",
  cookie: "cookie",
};

const STREAM_TYPE_MAP = {
  hls: "application/vnd.apple.mpegurl",
  dash: "application/dash+xml",
  mpd: "application/dash+xml",
  m3u8: "application/vnd.apple.mpegurl",
};

const isUrl = (value) => /^https?:\/\//i.test(value || "");

const stripBom = (value) => value.replace(/^\uFEFF/, "");

const stripQuotes = (value = "") => {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const decodeSafe = (value = "") => {
  try {
    return decodeURIComponent(value.replace(/\+/g, "%20"));
  } catch (error) {
    return value;
  }
};

const toHeaderLine = (key, value) => `${key.trim()}: ${String(value ?? "").trim()}`;

const appendHeader = (state, key, value) => {
  const normalized = key.trim();
  const val = String(value ?? "").trim();
  if (!normalized || !val) return;

  const mapped = HEADER_ALIASES[normalized.toLowerCase()];
  if (mapped) {
    state.stream[mapped] = val;
    return;
  }

  state.extraHeaders.push(toHeaderLine(normalized, val));
};

const parseExtAttributes = (input = "") => {
  const attrs = {};
  const regex = /([A-Za-z0-9_:\-.]+)=("[^"]*"|'[^']*'|[^\s,]*)/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    attrs[match[1]] = stripQuotes(match[2]);
  }
  return attrs;
};

const parseCommaValue = (line = "") => {
  let quote = null;
  let commaIndex = -1;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const previous = line[index - 1];

    if ((char === '"' || char === "'") && previous !== "\\") {
      quote = quote === char ? null : quote || char;
      continue;
    }

    if (char === "," && !quote) {
      commaIndex = index;
    }
  }

  if (commaIndex === -1) return { before: line, after: "" };
  return { before: line.slice(0, commaIndex), after: line.slice(commaIndex + 1).trim() };
};

const parsePipeHeaders = (urlLine, state) => {
  const [rawUrl, rawHeaderText] = urlLine.split("|");
  if (!rawHeaderText) return rawUrl.trim();

  const params = new URLSearchParams(rawHeaderText.trim());
  params.forEach((value, key) => appendHeader(state, decodeSafe(key), decodeSafe(value)));
  return rawUrl.trim();
};

const parseHeaderText = (state, value = "") => {
  const text = stripQuotes(value.trim());
  if (!text) return;

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const json = JSON.parse(text);
      const headers = Array.isArray(json) ? json : (json.headers || json);
      Object.entries(headers).forEach(([key, val]) => appendHeader(state, key, val));
      return;
    } catch (error) {
      // Continue with text parser.
    }
  }

  text.split(/\\n|\n|;/).forEach((part) => {
    const line = part.trim();
    if (!line) return;
    const separator = line.includes(":") ? ":" : "=";
    const index = line.indexOf(separator);
    if (index === -1) return;
    appendHeader(state, line.slice(0, index), line.slice(index + 1));
  });
};

const collectHeaderLines = (value = "") => {
  const lines = [];
  const collector = { stream: {}, extraHeaders: lines };
  parseHeaderText(collector, value);
  Object.entries(collector.stream).forEach(([key, val]) => {
    const headerName = key === "userAgent" ? "User-Agent" : key === "referer" ? "Referer" : key.charAt(0).toUpperCase() + key.slice(1);
    lines.push(toHeaderLine(headerName, val));
  });
  return lines.filter(Boolean).join("\n");
};

const parseKodiProp = (state, line) => {
  const payload = line.replace(/^#KODIPROP:/i, "");
  const index = payload.indexOf("=");
  if (index === -1) return;

  const key = payload.slice(0, index).trim().toLowerCase();
  const value = stripQuotes(payload.slice(index + 1));

  if (key.endsWith("license_type")) {
    const licenseType = value.toLowerCase();
    if (licenseType.includes("clearkey")) state.stream.drmScheme = "clearkey_inline";
    if (licenseType.includes("widevine")) state.stream.drmScheme = "com.widevine.alpha";
    if (licenseType.includes("playready")) state.stream.drmScheme = "com.microsoft.playready";
  }

  if (key.endsWith("license_key")) {
    if (value.includes(":")) {
      state.stream.drmScheme = "clearkey_inline";
      state.stream.clearKey = value;
    } else if (isUrl(value)) {
      state.stream.licenseUrl = value;
      if (state.stream.drmScheme === "none") state.stream.drmScheme = "org.w3.clearkey";
    }
  }

  if (key.endsWith("license_uri") || key.endsWith("license_url")) {
    state.stream.licenseUrl = value;
    if (state.stream.drmScheme === "none") state.stream.drmScheme = "org.w3.clearkey";
  }

  if (key.endsWith("license_headers")) state.stream.licenseHeaders = collectHeaderLines(value);
  if (key.endsWith("manifest_type") || key.endsWith("stream_type")) {
    state.stream.streamType = STREAM_TYPE_MAP[value.toLowerCase()] || state.stream.streamType;
  }
};

const newState = () => ({
  info: {},
  stream: { ...DEFAULT_STREAM },
  extraHeaders: [],
  groupFromExtGrp: "",
});

const finalizeChannel = (channels, state, urlLine) => {
  const url = parsePipeHeaders(urlLine, state);
  if (!isUrl(url)) return newState();

  const attrs = state.info.attrs || {};
  const title = state.info.title || attrs["tvg-name"] || attrs.name || url.split("/").pop() || "Untitled";
  const requestHeaders = [...state.extraHeaders].filter(Boolean).join("\n");

  const stream = {
    ...DEFAULT_STREAM,
    ...state.stream,
    streamUrl: url,
    streamType: state.stream.streamType === "auto"
      ? (url.toLowerCase().includes(".mpd") ? "application/dash+xml" : url.toLowerCase().includes(".m3u8") || url.toLowerCase().includes(".m3u") ? "application/vnd.apple.mpegurl" : "auto")
      : state.stream.streamType,
    requestHeaders,
  };

  channels.push({
    id: `${channels.length + 1}-${Math.random().toString(16).slice(2)}`,
    name: title,
    logo: attrs["tvg-logo"] || attrs.logo || "",
    group: attrs["group-title"] || state.groupFromExtGrp || "Ungrouped",
    tvgId: attrs["tvg-id"] || "",
    rawAttributes: attrs,
    stream,
  });

  return newState();
};

export function parseM3U(input = "") {
  const channels = [];
  let state = newState();

  const lines = stripBom(input).split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      const payload = line.replace(/^#EXTINF:?/i, "");
      const { before, after } = parseCommaValue(payload);
      state.info = { attrs: parseExtAttributes(before), title: after };
      continue;
    }

    if (line.startsWith("#EXTGRP:")) {
      state.groupFromExtGrp = line.replace(/^#EXTGRP:/i, "").trim();
      continue;
    }

    if (line.startsWith("#KODIPROP:")) {
      parseKodiProp(state, line);
      continue;
    }

    if (line.startsWith("#EXTVLCOPT:")) {
      const value = line.replace(/^#EXTVLCOPT:/i, "");
      const separator = value.includes("=") ? "=" : ":";
      const index = value.indexOf(separator);
      if (index !== -1) appendHeader(state, value.slice(0, index), value.slice(index + 1));
      continue;
    }

    if (line.startsWith("#EXTHTTP:")) {
      parseHeaderText(state, line.replace(/^#EXTHTTP:/i, ""));
      continue;
    }

    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseExtAttributes(line.replace(/^#EXT-X-KEY:/i, ""));
      if ((attrs.KEYFORMAT || "").toLowerCase().includes("clearkey") && attrs.URI) {
        state.stream.drmScheme = "org.w3.clearkey";
        state.stream.licenseUrl = attrs.URI;
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    state = finalizeChannel(channels, state, line);
  }

  return channels;
}
