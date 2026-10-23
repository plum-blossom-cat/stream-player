/*
 * Audio track naming and the remembered audio choice.
 *
 * Streams can carry several audio tracks that share a language (stereo and 5.1,
 * a commentary, a described version) or have no language code at all, only a
 * label, which is common in IPTV DASH. Grouping by language alone, as the first
 * version did, merged those into one entry. Each distinct track is listed here
 * instead, with enough detail to tell them apart.
 */

const PREF_KEY = "msp_audio_pref";

const CHANNELS = { 1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1" };

const ROLES = {
  commentary: "Commentary",
  description: "Audio description",
  dub: "Dubbed",
  alternate: "Alternate",
  supplementary: "Supplementary",
  emergency: "Emergency",
};

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" });
  } catch {
    return null;
  }
})();

/** @param {string} code */
export function languageLabel(code) {
  if (!code || code === "und") return "";
  try {
    const name = languageNames?.of(code);
    if (name && name.toLowerCase() !== code.toLowerCase()) return name;
  } catch {}
  return code.length > 3 ? code.charAt(0).toUpperCase() + code.slice(1) : code.toUpperCase();
}

/** @param {string} codecs */
function codecName(codecs = "") {
  const c = codecs.toLowerCase();
  if (c.startsWith("ec-3") || c.startsWith("ec3")) return "Dolby Digital Plus";
  if (c.startsWith("ac-3") || c.startsWith("ac3")) return "Dolby Digital";
  if (c.startsWith("ac-4")) return "Dolby AC-4";
  if (c.startsWith("mp4a.40.5") || c.startsWith("mp4a.40.29")) return "HE-AAC";
  if (c.startsWith("mp4a")) return "AAC";
  if (c.startsWith("opus")) return "Opus";
  if (c.startsWith("dts")) return "DTS";
  if (c.startsWith("flac")) return "FLAC";
  return "";
}

/**
 * @typedef {{ key: string, name: string, detail: string, active: boolean, track: any }} AudioItem
 */

/**
 * Turn Shaka audio tracks into menu entries with names that tell them apart.
 * @param {any[]} tracks result of player.getAudioTracks()
 * @returns {AudioItem[]}
 */
export function describeAudioTracks(tracks) {
  const items = tracks.map((track, index) => {
    const label = (track.label || "").trim();
    const language = languageLabel(track.language);
    const name = label || language || `Track ${index + 1}`;

    const detail = [];
    if (label && language && !label.toLowerCase().includes(language.toLowerCase())) detail.push(language);
    const role = (track.roles || []).find((r) => r && r !== "main");
    if (role) detail.push(ROLES[role] || role.charAt(0).toUpperCase() + role.slice(1));
    if (track.channelsCount) detail.push(CHANNELS[track.channelsCount] || `${track.channelsCount} ch`);
    if (track.spatialAudio) detail.push("Spatial");
    const codec = codecName(track.codecs || "");
    if (codec) detail.push(codec);

    return {
      key: [track.language, label, (track.roles || []).join(","), track.channelsCount, track.codecs].join("|"),
      name,
      detail: detail.join(", "),
      active: !!track.active,
      track,
    };
  });

  // Manifest order is arbitrary; alphabetical is easier to scan.
  items.sort((a, b) => a.name.localeCompare(b.name) || a.detail.localeCompare(b.detail));

  // If two entries still read the same, number them so both stay selectable.
  const seen = new Map();
  for (const item of items) {
    const text = `${item.name}|${item.detail}`;
    seen.set(text, (seen.get(text) || 0) + 1);
  }
  const counters = new Map();
  for (const item of items) {
    const text = `${item.name}|${item.detail}`;
    if (seen.get(text) > 1) {
      const n = (counters.get(text) || 0) + 1;
      counters.set(text, n);
      item.name = `${item.name} ${n}`;
    }
  }
  return items;
}

/** @returns {{ language: string, label: string } | null} */
export function loadAudioPreference() {
  try {
    const pref = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    return pref && (pref.language || pref.label) ? pref : null;
  } catch {
    return null;
  }
}

/** @param {any} track */
export function saveAudioPreference(track) {
  try {
    localStorage.setItem(
      PREF_KEY,
      JSON.stringify({ language: track.language && track.language !== "und" ? track.language : "", label: track.label || "" })
    );
  } catch {}
}

export function clearAudioPreference() {
  try {
    localStorage.removeItem(PREF_KEY);
  } catch {}
}
