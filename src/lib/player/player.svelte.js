import { normalizeStream, recordHistory } from "$lib/stream.js";

/**
 * @typedef {{ title: string, subtitle?: string, logo?: string, stream: StreamFormData }} QueueItem
 */

/** One global player so every page shares the same stage and fullscreen logic. */
export const player = $state({
  open: false,
  /** @type {StreamFormData | null} */
  stream: null,
  title: "",
  subtitle: "",
  logo: "",
  /** @type {QueueItem[]} */
  queue: [],
  index: -1,
  fullscreen: false,
  /** Bumped to force a reload of the same stream. */
  session: 0,
});

/**
 * @param {StreamFormData} stream
 * @param {{ title?: string, subtitle?: string, logo?: string, queue?: QueueItem[], index?: number, remember?: boolean }} [options]
 */
export function openPlayer(stream, options = {}) {
  const normalized = normalizeStream(stream);
  player.stream = normalized;
  player.title = options.title || "";
  player.subtitle = options.subtitle || "";
  player.logo = options.logo || "";
  player.queue = options.queue || [];
  player.index = options.index ?? -1;
  player.session += 1;
  player.open = true;
  if (options.remember !== false) recordHistory(normalized, player.title);
}

export function closePlayer() {
  player.open = false;
  player.stream = null;
  player.queue = [];
  player.index = -1;
}

export function reloadPlayer() {
  player.session += 1;
}

/** Move through the queue (channel up/down). Wraps around. @param {number} delta */
export function stepQueue(delta) {
  const count = player.queue.length;
  if (count < 2) return;
  const index = (player.index + delta + count) % count;
  const item = player.queue[index];
  player.index = index;
  player.stream = normalizeStream(item.stream);
  player.title = item.title;
  player.subtitle = item.subtitle || "";
  player.logo = item.logo || "";
  player.session += 1;
}
