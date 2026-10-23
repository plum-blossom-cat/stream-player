import { isTauri } from "$lib";

/*
 * Fullscreen has to work differently in the desktop app and in a browser.
 *
 * The old player asked Shaka's container element to go fullscreen. Inside
 * WebView2 that only fills the webview, so the app then tried to resize the
 * Tauri window afterwards in a fullscreenchange listener. The two raced, the
 * transparent shadowed window left a border, and the player stayed inside a
 * transformed <dialog> with rounded corners.
 *
 * Now the desktop app fullscreens the *window* and the player stage
 * covers it with CSS (position: fixed; inset: 0). Only the browser build uses
 * the element Fullscreen API.
 */

let appWindow = null;

async function getWindow() {
  if (!appWindow) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    appWindow = getCurrentWindow();
  }
  return appWindow;
}

/** @param {HTMLElement} element */
export async function enterFullscreen(element) {
  if (isTauri) {
    const win = await getWindow();
    // A shadow on an undecorated window draws a 1px frame around a fullscreen window on Windows.
    await win.setShadow(false).catch(() => {});
    await win.setFullscreen(true);
    await win.setFocus().catch(() => {});
    return;
  }

  const el = /** @type {any} */ (element);
  if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
  else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
}

export async function exitFullscreen() {
  if (isTauri) {
    const win = await getWindow();
    await win.setFullscreen(false);
    await win.setShadow(true).catch(() => {});
    return;
  }

  const doc = /** @type {any} */ (document);
  if (doc.fullscreenElement) await doc.exitFullscreen();
  else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen();
}

/**
 * Keep app state in sync when fullscreen changes outside our buttons
 * (Esc in a browser, Win+Down or a display change in the desktop app).
 * @param {(fullscreen: boolean) => void} onChange
 * @returns {Promise<() => void>} unsubscribe
 */
export async function watchFullscreen(onChange) {
  if (isTauri) {
    const win = await getWindow();
    return await win.onResized(async () => {
      try {
        onChange(await win.isFullscreen());
      } catch {}
    });
  }

  const handler = () => {
    const doc = /** @type {any} */ (document);
    onChange(!!(doc.fullscreenElement || doc.webkitFullscreenElement));
  };
  document.addEventListener("fullscreenchange", handler);
  document.addEventListener("webkitfullscreenchange", handler);
  return () => {
    document.removeEventListener("fullscreenchange", handler);
    document.removeEventListener("webkitfullscreenchange", handler);
  };
}
