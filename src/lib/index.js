export const isTauri =
  typeof window !== "undefined" && !!window["__TAURI_INTERNALS__"];

/**
 * Parse "Name: value" lines into an object with lowercase keys.
 * @param {string} input
 * @returns {Record<string, string>}
 */
export function parseHeaders(input = "") {
  const headers = {};
  const headerNameRegex = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/; // RFC 7230 token

  String(input || "")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const index = trimmed.indexOf(":");
      if (index <= 0) return;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!headerNameRegex.test(key)) return;
      headers[key.toLowerCase()] = value;
    });

  return headers;
}

export function dev_log(...args) {
  if (import.meta.env.DEV) console.log(...args);
}

export const createId = () =>
  crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** @param {string | undefined} value */
export function formatWhen(value) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Just now";
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** @param {string} url */
export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Fetch text through the Tauri HTTP plugin when available (no CORS), otherwise the browser. */
export async function fetchText(url) {
  if (isTauri) {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const response = await fetch(url, {
      method: "GET",
      // @ts-ignore tauri-specific option
      danger: { acceptInvalidCerts: true, acceptInvalidHostnames: true },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.text();
}
