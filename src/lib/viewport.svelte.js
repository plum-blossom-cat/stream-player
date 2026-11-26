import { isTv } from "$lib";

/*
 * Phone layout: narrow screens that aren't a TV get the mobile UI (bottom link
 * bar, sheets, grouped lists) instead of the desktop page. Keyed on width so a
 * narrow desktop browser shows it too, which keeps it easy to work on.
 */
const query = typeof window !== "undefined" ? window.matchMedia("(max-width: 640px)") : null;

export const viewport = $state({
  phone: !isTv && !!query?.matches,
  /** True while a text field has focus (the on-screen keyboard is likely up). */
  typing: false,
});

query?.addEventListener?.("change", (event) => {
  viewport.phone = !isTv && event.matches;
});

if (typeof document !== "undefined") {
  const isField = (el) =>
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "submit", "file"].includes(el.type));
  document.addEventListener("focusin", (e) => (viewport.typing = isField(e.target)));
  document.addEventListener("focusout", () => (viewport.typing = false));
}

/** Open bottom sheets, newest last. Android Back closes the newest first. */
export const sheets = $state({ stack: /** @type {(() => void)[]} */ ([]) });

export function closeTopSheet() {
  const close = sheets.stack.at(-1);
  if (!close) return false;
  close();
  return true;
}
