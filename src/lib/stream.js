import JSON5 from "json5";
import parseCurl from "parse-curl";
import { createId } from "$lib";

/** @type {StreamFormData} */
export const DEFAULT_STREAM = {
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

export const STREAM_TYPES = [
  { value: "auto", text: "Auto" },
  { value: "application/vnd.apple.mpegurl", text: "HLS" },
  { value: "application/dash+xml", text: "DASH" },
];

export const DRM_SCHEMES = [
  { value: "none", text: "None" },
  { value: "clearkey_inline", text: "ClearKey, inline keys" },
  { value: "org.w3.clearkey", text: "ClearKey, license server" },
  { value: "com.widevine.alpha", text: "Widevine" },
  { value: "com.microsoft.playready", text: "PlayReady" },
];

/**
 * Strip what copying a URL out of a terminal, chat or document tends to bring along:
 * surrounding whitespace, invisible characters, quotes, backticks and angle brackets.
 * `new URL()` forgives leading spaces but Shaka doesn't, so " https://…" used to
 * fail with UNSUPPORTED_SCHEME.
 * @param {string} value
 */
export function cleanUrl(value = "") {
  return String(value)
    .replace(/[​-‍﻿]/g, "")
    .trim()
    .replace(/^["'`<]+|["'`>]+$/g, "")
    .trim();
}

/** @param {Partial<StreamFormData>} data */
export function normalizeStream(data = {}) {
  /** @type {any} */
  const out = {};
  for (const key of Object.keys(DEFAULT_STREAM)) {
    const value = data?.[key];
    out[key] = value === undefined || value === null ? DEFAULT_STREAM[key] : String(value);
  }
  out.streamUrl = cleanUrl(out.streamUrl);

  // Links typed or saved as "url|drmScheme=…" carry options in the URL itself.
  // Fields set explicitly in the form win over the inline values.
  const inline = splitInlineOptions(out.streamUrl);
  if (inline) {
    for (const [key, value] of Object.entries(inline.fields)) {
      if (key === "streamUrl") out.streamUrl = value;
      else if (!out[key] || out[key] === DEFAULT_STREAM[key]) out[key] = value;
    }
  }

  out.licenseUrl = cleanUrl(out.licenseUrl);
  out.certificateUrl = cleanUrl(out.certificateUrl);
  return /** @type {StreamFormData} */ (out);
}

/** @param {string} value */
export function validateUrl(value) {
  const cleaned = cleanUrl(value);
  if (!cleaned) return "Enter a stream URL to play.";
  try {
    const url = new URL(cleaned);
    if (!/^https?:$/.test(url.protocol)) return "Use an http or https URL.";
  } catch {
    return "This isn't a valid URL. Check for missing https:// or stray spaces.";
  }
  return null;
}

/** @param {string} value */
export function validateShakaConfig(value) {
  if (!String(value || "").trim()) return null;
  try {
    JSON5.parse(value);
    return null;
  } catch (error) {
    return `Config isn't valid JSON5: ${error.message}`;
  }
}

/**
 * Work out HLS / DASH / progressive from the explicit type or the URL.
 * @param {StreamFormData} stream
 * @returns {{ kind: "hls" | "dash" | "file", mimeType: string | null }}
 */
export function detectFormat(stream) {
  if (stream.streamType && stream.streamType !== "auto") {
    return {
      kind: stream.streamType === "application/dash+xml" ? "dash" : "hls",
      mimeType: stream.streamType,
    };
  }
  let path = stream.streamUrl.toLowerCase();
  try {
    path = new URL(stream.streamUrl).pathname.toLowerCase();
  } catch {}
  if (path.includes(".mpd")) return { kind: "dash", mimeType: "application/dash+xml" };
  if (path.includes(".m3u")) return { kind: "hls", mimeType: "application/vnd.apple.mpegurl" };
  return { kind: "file", mimeType: null };
}

/** @param {StreamFormData} stream */
export function formatLabel(stream) {
  const { kind } = detectFormat(stream);
  return kind === "dash" ? "DASH" : kind === "hls" ? "HLS" : "File";
}

/**
 * Understand pasted cURL commands and "url|key=value&..." NS Player style links.
 * Returns the fields to merge into the form, or null when the paste is a plain URL.
 * @param {string} text
 * @returns {{ fields: Partial<StreamFormData>, message: string } | null}
 */
export function parsePastedStream(text) {
  const pasted = cleanUrl(text);

  if (/^curl\s/i.test(pasted)) {
    const parsed = parseCurl(pasted);
    if (!parsed?.url) throw new Error("Couldn't find a URL in that cURL command. Copy it as cURL (bash).");
    /** @type {Partial<StreamFormData>} */
    const fields = { streamUrl: cleanUrl(parsed.url), requestHeaders: "" };
    const extra = [];
    for (const key in parsed.header || {}) {
      const name = key.trim().toLowerCase();
      const value = parsed.header[key];
      if (name === "cookie") fields.cookie = value;
      else if (name === "origin") fields.origin = value;
      else if (name === "referer") fields.referer = value;
      else if (name === "user-agent") fields.userAgent = value;
      else extra.push(`${key.trim()}: ${value}`);
    }
    fields.requestHeaders = extra.join("\n");
    return { fields, message: "Filled the URL and headers from your cURL command." };
  }

  const inline = splitInlineOptions(pasted);
  if (!inline) return null;

  return {
    fields: inline.fields,
    message: inline.found
      ? `Filled ${inline.found} field${inline.found === 1 ? "" : "s"} from the pasted link.`
      : "Pasted link had no headers or keys this player understands. Only the URL was used.",
  };
}

const OPTION_KEYS = /(^|[|&?])(drmscheme|drmlicense|referer|referrer|origin|useragent|user-agent|cookie)=/i;

/**
 * Split "url|key=value&..." links (NS Player / IPTV app style) into the URL and form fields.
 * The separator may be a literal "|" or percent-encoded as "%7C", e.g.
 * "https://host/cenc.mpd?%7CdrmScheme=clearkey&drmLicense=kid:key".
 * Returns null when the text has no such options, so ordinary URLs are left alone.
 * @param {string} text
 * @returns {{ fields: Partial<StreamFormData>, found: number } | null}
 */
export function splitInlineOptions(text) {
  const raw = cleanUrl(text);
  const match = /\||%7c/i.exec(raw);
  if (!match) return null;

  const options = raw.slice(match.index + match[0].length).trim();
  if (!OPTION_KEYS.test(`&${options}`)) return null;

  // Drop the "?" or "&" some apps leave between the URL and the separator.
  const url = raw.slice(0, match.index).replace(/[?&]+$/, "");
  const params = new URLSearchParams(options);
  /** @type {Partial<StreamFormData>} */
  const fields = { streamUrl: cleanUrl(url) };
  let found = 0;

  for (const [key, value] of params) {
    const name = key.toLowerCase();
    if (!value) continue;
    if (name === "referer" || name === "referrer") fields.referer = value;
    else if (name === "origin") fields.origin = value;
    else if (name === "useragent" || name === "user-agent") fields.userAgent = value;
    else if (name === "cookie") fields.cookie = value;
    else continue;
    found += 1;
  }

  const lookup = (key) => [...params].find(([k]) => k.toLowerCase() === key)?.[1] || "";
  const scheme = lookup("drmscheme").toLowerCase();
  const license = lookup("drmlicense").trim();
  if (license) {
    const isUrl = /^https?:\/\//i.test(license);
    if (scheme.includes("widevine")) {
      fields.drmScheme = "com.widevine.alpha";
      fields.licenseUrl = license;
    } else if (scheme.includes("playready")) {
      fields.drmScheme = "com.microsoft.playready";
      fields.licenseUrl = license;
    } else if (isUrl) {
      fields.drmScheme = "org.w3.clearkey";
      fields.licenseUrl = license;
    } else {
      fields.drmScheme = "clearkey_inline";
      fields.clearKey = license;
    }
    found += 1;
  }

  return { fields, found };
}

/**
 * Parse "kid:key" pairs separated by commas, spaces or new lines.
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseClearKeys(text = "") {
  const keys = {};
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [kid, key] = pair.split(":").map((v) => v?.trim());
      if (kid && key) keys[kid] = key;
    });
  return keys;
}

/* ---------- Local storage ---------- */

export const STORAGE_KEYS = {
  history: "msp_stream_history",
  saved: "msp_saved_streams",
  playlists: "msp_saved_playlists",
  tempPlaylist: "msp_temp_playlist",
};

const HISTORY_LIMIT = 24;

export function loadList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (error) {
    console.warn("Couldn't write to local storage", error);
  }
}

/**
 * Add a stream to history, keeping the newest copy of identical configs.
 * @param {StreamFormData} stream
 * @param {string} [title]
 */
export function recordHistory(stream, title = "") {
  const payload = normalizeStream(stream);
  const signature = JSON.stringify(payload);
  const history = loadList(STORAGE_KEYS.history).filter((item) => item.signature !== signature);
  history.unshift({
    id: createId(),
    title,
    lastPlayed: new Date().toISOString(),
    signature,
    stream: payload,
  });
  saveList(STORAGE_KEYS.history, history.slice(0, HISTORY_LIMIT));
}
