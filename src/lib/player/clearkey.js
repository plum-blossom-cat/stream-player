/*
 * ClearKey decryption inside the app.
 *
 * ClearKey streams ship with their keys, but playing them through EME needs a
 * ClearKey module in the browser engine. WebView2 (Windows) has one; WebKit on
 * macOS doesn't. When it's missing, this decrypts each fragmented-MP4 segment
 * with WebCrypto and rewrites it to look unencrypted before Shaka hands it to
 * Media Source Extensions:
 *
 *   - Init segments: encrypted sample entries ('encv' / 'enca') get their
 *     original format back from 'frma', and 'sinf' / 'pssh' boxes are renamed
 *     to 'free'. Renaming keeps every box the same size, so no offsets change.
 *   - Media segments: samples are decrypted in place using the IVs and
 *     subsample map from 'senc' (or the PIFF equivalent), then 'senc', 'saiz'
 *     and 'saio' are renamed to 'free'.
 *   - Manifests: DRM signalling is removed so Shaka doesn't try EME at all.
 *
 * Supports the 'cenc' (AES-CTR), 'cbc1' and 'cbcs' (AES-CBC, with patterns)
 * schemes from ISO/IEC 23001-7. Widevine and PlayReady can't work this way:
 * their keys never leave the licence server.
 */

const PIFF_SENC = "a2394f525a9b4f14a2446c427c648df4";
const ENCRYPTED_ENTRIES = new Set(["encv", "enca", "encs", "enct"]);
const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf", "sinf", "schi", "edts"]);

/* ---------- Detection ---------- */

let nativeSupport = null;

/** Whether the engine can play ClearKey through EME. */
export async function hasNativeClearKey() {
  if (nativeSupport !== null) return nativeSupport;
  try {
    if (!navigator.requestMediaKeySystemAccess) throw new Error("no EME");
    await navigator.requestMediaKeySystemAccess("org.w3.clearkey", [
      {
        initDataTypes: ["cenc", "keyids"],
        videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      },
    ]);
    nativeSupport = true;
  } catch {
    nativeSupport = false;
  }
  return nativeSupport;
}

/** Developer switch to test the in-app path on engines that have native ClearKey. */
export function softwareClearKeyForced() {
  try {
    return localStorage.getItem("msp_software_clearkey") === "1";
  } catch {
    return false;
  }
}

/* ---------- Byte helpers ---------- */

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function base64UrlToBytes(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const bytesToBase64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Accept a 32-character hex value, a UUID, or base64 / base64url. */
function normalizeKeyMaterial(value) {
  let v = String(value || "").trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) v = v.replace(/-/g, "");
  if (/^[0-9a-f]{32}$/i.test(v)) return v.toLowerCase();
  try {
    const bytes = base64UrlToBytes(v);
    if (bytes.length === 16) return toHex(bytes);
  } catch {}
  return null;
}

const fourcc = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

function writeFourcc(bytes, at, type) {
  for (let i = 0; i < 4; i++) bytes[at + i] = type.charCodeAt(i);
}

/* ---------- MP4 boxes ---------- */

/**
 * List the boxes between start and end.
 * @returns {{ type: string, start: number, payload: number, end: number, uuid?: string }[]}
 */
function boxes(bytes, view, start, end) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = fourcc(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    const box = { type, start: at, payload: at + header, end: at + size };
    if (type === "uuid") {
      box.uuid = toHex(bytes.subarray(box.payload, box.payload + 16));
      box.payload += 16;
    }
    out.push(box);
    at += size;
  }
  return out;
}

const child = (bytes, view, box, type) => boxes(bytes, view, box.payload, box.end).find((b) => b.type === type);

/* ---------- Init segments ---------- */

/**
 * Read encryption details from an init segment and make it look unencrypted.
 * @returns {Map<number, TrackInfo>} keyed by track_ID
 *
 * @typedef {{ scheme: string, kid: string, ivSize: number, constantIv: Uint8Array | null,
 *             crypt: number, skip: number, defaultSampleSize: number }} TrackInfo
 */
function processInit(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks = new Map();
  const trex = new Map();

  for (const top of boxes(bytes, view, 0, bytes.length)) {
    if (top.type !== "moov") continue;
    for (const box of boxes(bytes, view, top.payload, top.end)) {
      if (box.type === "pssh") writeFourcc(bytes, box.start + 4, "free");
      if (box.type === "mvex") {
        for (const t of boxes(bytes, view, box.payload, box.end)) {
          if (t.type === "trex") trex.set(view.getUint32(t.payload + 4), view.getUint32(t.payload + 16));
        }
      }
      if (box.type !== "trak") continue;

      const tkhd = child(bytes, view, box, "tkhd");
      const trackId = view.getUint32(tkhd.payload + (bytes[tkhd.payload] === 1 ? 20 : 12));
      const stsd = ["mdia", "minf", "stbl", "stsd"].reduce((b, t) => b && child(bytes, view, b, t), box);
      if (!stsd) continue;

      // stsd is a full box with an entry count before its sample entries.
      for (const entry of boxes(bytes, view, stsd.payload + 8, stsd.end)) {
        if (!ENCRYPTED_ENTRIES.has(entry.type)) continue;
        let childStart = entry.payload + 8; // reserved(6) + data_reference_index(2)
        if (entry.type === "encv") childStart += 70;
        else if (entry.type === "enca") {
          const version = view.getUint16(entry.payload + 8);
          childStart += 20 + (version === 1 ? 16 : version === 2 ? 36 : 0);
        }
        const sinf = boxes(bytes, view, childStart, entry.end).find((b) => b.type === "sinf");
        if (!sinf) continue;
        const frma = child(bytes, view, sinf, "frma");
        const schm = child(bytes, view, sinf, "schm");
        const tenc = child(bytes, view, sinf, "schi") && child(bytes, view, child(bytes, view, sinf, "schi"), "tenc");
        if (!frma || !tenc) continue;

        const version = bytes[tenc.payload];
        const patternByte = bytes[tenc.payload + 5];
        const isProtected = bytes[tenc.payload + 6];
        const ivSize = bytes[tenc.payload + 7];
        const kid = toHex(bytes.subarray(tenc.payload + 8, tenc.payload + 24));
        let constantIv = null;
        if (isProtected && ivSize === 0) {
          const size = bytes[tenc.payload + 24];
          constantIv = bytes.slice(tenc.payload + 25, tenc.payload + 25 + size);
        }
        tracks.set(trackId, {
          scheme: schm ? fourcc(bytes, schm.payload + 4) : "cenc",
          kid,
          ivSize,
          constantIv,
          crypt: version >= 1 ? patternByte >> 4 : 0,
          skip: version >= 1 ? patternByte & 0x0f : 0,
          defaultSampleSize: 0,
          protected: !!isProtected,
        });

        // Put the real codec back and hide the protection info.
        bytes.set(bytes.subarray(frma.payload, frma.payload + 4), entry.start + 4);
        writeFourcc(bytes, sinf.start + 4, "free");
      }
    }
  }

  for (const [id, info] of tracks) info.defaultSampleSize = trex.get(id) || 0;
  return tracks;
}

/* ---------- Media segments ---------- */

/**
 * Per-sample overrides from 'seig' sample groups ('sgpd' + 'sbgp' in the traf).
 * Returns one TrackInfo per sample (or null when there are no seig groups).
 */
function sampleGroupInfo(bytes, view, parts, info, sampleCount) {
  const isSeig = (box) => fourcc(bytes, box.payload + 4) === "seig";
  const sgpd = parts.find((b) => b.type === "sgpd" && isSeig(b));
  const sbgp = parts.find((b) => b.type === "sbgp" && isSeig(b));
  if (!sgpd || !sbgp) return null;

  // Group descriptions: crypt/skip, isProtected, IV size, KID, constant IV.
  const version = bytes[sgpd.payload];
  let p = sgpd.payload + 8;
  let defaultLength = 0;
  if (version === 1) {
    defaultLength = view.getUint32(p);
    p += 4;
  } else if (version >= 2) p += 4;
  const entryCount = view.getUint32(p);
  p += 4;
  const groups = [];
  for (let i = 0; i < entryCount; i++) {
    let length = defaultLength;
    if (version === 1 && !defaultLength) {
      length = view.getUint32(p);
      p += 4;
    }
    const pattern = bytes[p + 1];
    const isProtected = bytes[p + 2];
    const ivSize = bytes[p + 3];
    const kid = toHex(bytes.subarray(p + 4, p + 20));
    let constantIv = null;
    if (isProtected && ivSize === 0) constantIv = bytes.slice(p + 21, p + 21 + bytes[p + 20]);
    groups.push({ ...info, kid, ivSize, constantIv, protected: !!isProtected, crypt: pattern >> 4, skip: pattern & 0x0f });
    p += length || 20 + (constantIv ? 1 + constantIv.length : 0);
  }

  // Sample-to-group runs. Index 0 means "no group"; above 0x10000 is a fragment-local group.
  const sbgpVersion = bytes[sbgp.payload];
  p = sbgp.payload + 8 + (sbgpVersion === 1 ? 4 : 0);
  const runs = view.getUint32(p);
  p += 4;
  const perSample = [];
  for (let i = 0; i < runs && perSample.length < sampleCount; i++) {
    const count = view.getUint32(p);
    const index = view.getUint32(p + 4);
    p += 8;
    const group = index === 0 ? info : groups[(index > 0x10000 ? index - 0x10001 : index - 1)] ?? info;
    for (let j = 0; j < count && perSample.length < sampleCount; j++) perSample.push(group);
  }
  while (perSample.length < sampleCount) perSample.push(info);
  return perSample;
}

/** Find every sample in every moof, with its IV and subsample map. */
function collectSamples(bytes, tracksForSegment) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = [];

  for (const moof of boxes(bytes, view, 0, bytes.length)) {
    // 'pssh' can also arrive in media segments (in-band key signalling);
    // the decoder raises an 'encrypted' event for each one it sees.
    if (moof.type === "pssh") writeFourcc(bytes, moof.start + 4, "free");
    if (moof.type !== "moof") continue;

    for (const traf of boxes(bytes, view, moof.payload, moof.end)) {
      if (traf.type === "pssh") writeFourcc(bytes, traf.start + 4, "free");
      if (traf.type !== "traf") continue;
      const parts = boxes(bytes, view, traf.payload, traf.end);
      const tfhd = parts.find((b) => b.type === "tfhd");
      if (!tfhd) continue;

      const tfhdFlags = view.getUint32(tfhd.payload) & 0xffffff;
      const trackId = view.getUint32(tfhd.payload + 4);
      const info = tracksForSegment(trackId);
      if (!info) continue;

      let at = tfhd.payload + 8;
      let base = moof.start;
      if (tfhdFlags & 0x1) {
        base = Number(view.getBigUint64(at));
        at += 8;
      }
      if (tfhdFlags & 0x2) at += 4;
      if (tfhdFlags & 0x8) at += 4;
      const defaultSize = tfhdFlags & 0x10 ? view.getUint32(at) : info.defaultSampleSize;

      // Sample positions and sizes from every trun.
      const positions = [];
      let cursor = base;
      for (const trun of parts.filter((b) => b.type === "trun")) {
        const flags = view.getUint32(trun.payload) & 0xffffff;
        const count = view.getUint32(trun.payload + 4);
        let p = trun.payload + 8;
        if (flags & 0x1) {
          cursor = base + view.getInt32(p);
          p += 4;
        }
        if (flags & 0x4) p += 4;
        for (let i = 0; i < count; i++) {
          if (flags & 0x100) p += 4;
          let size = defaultSize;
          if (flags & 0x200) {
            size = view.getUint32(p);
            p += 4;
          }
          if (flags & 0x400) p += 4;
          if (flags & 0x800) p += 4;
          positions.push({ offset: cursor, size });
          cursor += size;
        }
      }

      // Sample groups can change the key, IV size or protection per sample.
      const perSample = sampleGroupInfo(bytes, view, parts, info, positions.length);

      // Per-sample IVs and subsamples from 'senc' or the PIFF uuid box.
      const senc = parts.find((b) => b.type === "senc" || (b.type === "uuid" && b.uuid === PIFF_SENC));

      // Hide every encryption marker; the decoder rejects segments that still
      // announce encryption ("Sample encryption info is not available").
      for (const box of parts) {
        const seigGroup = (box.type === "sgpd" || box.type === "sbgp") && fourcc(bytes, box.payload + 4) === "seig";
        if (["senc", "saiz", "saio"].includes(box.type) || box === senc || seigGroup) {
          writeFourcc(bytes, box.start + 4, "free");
        }
      }
      if (!senc) continue;

      const sencFlags = view.getUint32(senc.payload) & 0xffffff;
      let p = senc.payload + 4;
      let piffIvSize = null;
      if (sencFlags & 0x1) {
        // PIFF override: AlgorithmID(3) IV_size(1) KID(16)
        piffIvSize = bytes[p + 3];
        p += 20;
      }
      const count = view.getUint32(p);
      p += 4;
      for (let i = 0; i < count && i < positions.length; i++) {
        const sampleInfo = perSample ? perSample[i] : info;
        const ivSize = piffIvSize ?? sampleInfo.ivSize;
        const iv = ivSize ? bytes.slice(p, p + ivSize) : sampleInfo.constantIv;
        p += ivSize;
        let subsamples = null;
        if (sencFlags & 0x2) {
          const n = view.getUint16(p);
          p += 2;
          subsamples = [];
          for (let j = 0; j < n; j++) {
            subsamples.push({ clear: view.getUint16(p), encrypted: view.getUint32(p + 2) });
            p += 6;
          }
        }
        if (sampleInfo.protected) samples.push({ ...positions[i], iv, subsamples, info: sampleInfo });
      }
    }
  }
  return samples;
}

/* ---------- AES ---------- */

function padIv(iv) {
  const out = new Uint8Array(16);
  out.set(iv.subarray(0, 16));
  return out;
}

/** AES-CBC without padding, which WebCrypto doesn't offer directly. */
async function cbcDecrypt(key, iv, data) {
  if (!data.length) return data;
  // Encrypting an empty block chained from the last ciphertext block yields a
  // valid PKCS#7 padding block; append it so WebCrypto accepts the input.
  const last = data.subarray(data.length - 16);
  const pad = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: last }, key, new Uint8Array(0)));
  const input = new Uint8Array(data.length + 16);
  input.set(data);
  input.set(pad.subarray(0, 16), data.length);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, input));
}

/** Byte ranges [start, end) of a sample that are encrypted. */
function protectedRanges(sample) {
  if (!sample.subsamples) return [[sample.offset, sample.offset + sample.size]];
  const ranges = [];
  let at = sample.offset;
  for (const { clear, encrypted } of sample.subsamples) {
    at += clear;
    if (encrypted) ranges.push([at, at + encrypted]);
    at += encrypted;
  }
  return ranges;
}

async function decryptSample(bytes, sample, keys) {
  const { info } = sample;
  const ranges = protectedRanges(sample);

  if (info.scheme === "cenc") {
    // One CTR keystream runs across all encrypted ranges of the sample.
    const total = ranges.reduce((n, [s, e]) => n + e - s, 0);
    if (!total) return;
    const joined = new Uint8Array(total);
    let o = 0;
    for (const [s, e] of ranges) {
      joined.set(bytes.subarray(s, e), o);
      o += e - s;
    }
    const plain = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-CTR", counter: padIv(sample.iv), length: 64 }, keys.ctr, joined)
    );
    o = 0;
    for (const [s, e] of ranges) {
      bytes.set(plain.subarray(o, o + e - s), s);
      o += e - s;
    }
    return;
  }

  if (info.scheme === "cbcs" || info.scheme === "cbc1") {
    // cbcs restarts the IV for every subsample; cbc1 chains through the sample.
    const pattern = info.scheme === "cbcs" && info.crypt ? { crypt: info.crypt, skip: info.skip } : null;
    const groups = info.scheme === "cbcs" ? ranges.map((r) => [r]) : [ranges];
    for (const group of groups) {
      const blocks = [];
      for (const [s, e] of group) {
        let at = s;
        while (e - at >= 16) {
          const run = pattern ? pattern.crypt : Infinity;
          for (let i = 0; i < run && e - at >= 16; i++, at += 16) blocks.push(at);
          if (pattern) at += pattern.skip * 16;
        }
      }
      if (!blocks.length) continue;
      const cipher = new Uint8Array(blocks.length * 16);
      blocks.forEach((b, i) => cipher.set(bytes.subarray(b, b + 16), i * 16));
      const plain = await cbcDecrypt(keys.cbc, padIv(sample.iv), cipher);
      blocks.forEach((b, i) => bytes.set(plain.subarray(i * 16, i * 16 + 16), b));
    }
    return;
  }

  throw new Error(`The '${info.scheme}' encryption scheme isn't supported for in-app ClearKey.`);
}

/* ---------- Manifests ---------- */

function stripManifestDrm(text) {
  if (/<MPD[\s>]/.test(text)) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return text;
    for (const el of Array.from(doc.getElementsByTagNameNS("*", "ContentProtection"))) el.remove();
    return new XMLSerializer().serializeToString(doc);
  }
  if (text.startsWith("#EXTM3U")) {
    // Only fragmented-MP4 sample encryption is handled here; AES-128 whole-segment
    // encryption is left for Shaka, which decrypts it itself.
    const fmp4 = text.includes("#EXT-X-MAP");
    return text
      .split(/\r?\n/)
      .filter((line) => {
        if (!/^#EXT-X-(SESSION-)?KEY:/.test(line)) return true;
        if (!/METHOD=SAMPLE-AES/.test(line)) return true;
        return !(fmp4 || line.startsWith("#EXT-X-SESSION-KEY"));
      })
      .join("\n");
  }
  return text;
}

/* ---------- The filter ---------- */

export class SoftwareClearKey {
  /**
   * @param {{ keys: Record<string, string>, licenseUrl?: string, requestLicense?: (body: string) => Promise<string> }} options
   */
  constructor({ keys, licenseUrl, requestLicense }) {
    /** @type {Map<string, string>} kid hex -> key hex */
    this.keys = new Map();
    for (const [kid, key] of Object.entries(keys || {})) {
      const k = normalizeKeyMaterial(kid);
      const v = normalizeKeyMaterial(key);
      if (k && v) this.keys.set(k, v);
    }
    this.licenseUrl = licenseUrl || "";
    this.requestLicense = requestLicense;
    this.cryptoKeys = new Map();
    this.pendingLicense = new Map();
    /** Encryption info per Shaka stream, resolved when its init segment arrives. */
    this.streams = new Map();
    /** Fallback for requests without a stream context, keyed by track_ID. */
    this.byTrack = new Map();
  }

  streamEntry(id) {
    if (!this.streams.has(id)) {
      let resolve;
      const promise = new Promise((r) => (resolve = r));
      this.streams.set(id, { promise, resolve });
    }
    return this.streams.get(id);
  }

  async keyFor(kid) {
    if (!this.keys.has(kid)) {
      if (this.licenseUrl && this.requestLicense) await this.fetchLicense(kid);
      else if (this.keys.size === 1) return this.cryptoKeyPair(kid, [...this.keys.values()][0]);
    }
    const key = this.keys.get(kid);
    if (!key) throw new Error(`No ClearKey key for key ID ${kid}. Check the kid:key value.`);
    return this.cryptoKeyPair(kid, key);
  }

  async cryptoKeyPair(kid, keyHex) {
    if (!this.cryptoKeys.has(kid)) {
      const raw = fromHex(keyHex);
      this.cryptoKeys.set(
        kid,
        Promise.all([
          crypto.subtle.importKey("raw", raw, "AES-CTR", false, ["decrypt"]),
          crypto.subtle.importKey("raw", raw, "AES-CBC", false, ["encrypt", "decrypt"]),
        ]).then(([ctr, cbc]) => ({ ctr, cbc }))
      );
    }
    return this.cryptoKeys.get(kid);
  }

  fetchLicense(kid) {
    if (!this.pendingLicense.has(kid)) {
      const body = JSON.stringify({ kids: [bytesToBase64Url(fromHex(kid))], type: "temporary" });
      this.pendingLicense.set(
        kid,
        this.requestLicense(body).then((text) => {
          const license = JSON.parse(text);
          for (const k of license.keys || []) {
            const id = normalizeKeyMaterial(k.kid);
            const value = normalizeKeyMaterial(k.k);
            if (id && value) this.keys.set(id, value);
          }
        })
      );
    }
    return this.pendingLicense.get(kid);
  }

  /**
   * Shaka response filter.
   * @param {number} type shaka.net.NetworkingEngine.RequestType
   */
  async filter(type, response, context, RequestType, AdvancedRequestType) {
    // Shaka adds response-filter time to the download time it uses for its
    // bandwidth estimate. Decrypting isn't network time, so take it back out;
    // otherwise adaptive quality would settle lower than the connection allows.
    const started = performance.now();
    try {
      await this.process(type, response, context, RequestType, AdvancedRequestType);
    } finally {
      if (typeof response.timeMs === "number") {
        response.timeMs = Math.max(1, response.timeMs - (performance.now() - started));
      }
    }
  }

  async process(type, response, context, RequestType, AdvancedRequestType) {
    const src = response.data instanceof ArrayBuffer
      ? new Uint8Array(response.data)
      : new Uint8Array(response.data.buffer, response.data.byteOffset, response.data.byteLength);

    if (type === RequestType.MANIFEST) {
      const text = new TextDecoder().decode(src);
      const stripped = stripManifestDrm(text);
      if (stripped !== text) response.data = new TextEncoder().encode(stripped).buffer;
      return;
    }
    if (type !== RequestType.SEGMENT) return;

    const bytes = new Uint8Array(src); // copy, so cached originals stay untouched
    const streamId = context?.stream?.id;

    if (context?.type === AdvancedRequestType.INIT_SEGMENT || hasBox(bytes, "moov")) {
      const tracks = processInit(bytes);
      for (const [id, info] of tracks) this.byTrack.set(id, info);
      if (streamId !== undefined) this.streamEntry(streamId).resolve(tracks);
      response.data = bytes.buffer;
      if (!hasBox(bytes, "moof")) return;
    }

    let tracks = null;
    if (streamId !== undefined) {
      tracks = await Promise.race([
        this.streamEntry(streamId).promise,
        new Promise((r) => setTimeout(() => r(null), 15000)),
      ]);
    }
    const lookup = (trackId) => tracks?.get(trackId) ?? this.byTrack.get(trackId);
    const samples = collectSamples(bytes, lookup);
    if (!samples.length) {
      response.data = bytes.buffer;
      return;
    }

    const keysByKid = new Map();
    for (const s of samples) {
      if (!keysByKid.has(s.info.kid)) keysByKid.set(s.info.kid, await this.keyFor(s.info.kid));
    }
    await Promise.all(samples.map((s) => decryptSample(bytes, s, keysByKid.get(s.info.kid))));
    response.data = bytes.buffer;
  }
}

function hasBox(bytes, type) {
  return boxes(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0, bytes.length).some((b) => b.type === type);
}

// Exported for tests.
export const _internal = { processInit, collectSamples, decryptSample, cbcDecrypt, stripManifestDrm, normalizeKeyMaterial };
