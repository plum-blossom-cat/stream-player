/*
 * D-pad focus navigation for Android TV.
 *
 * TV remotes send arrow keys. Browsers don't move focus with them by default,
 * so this picks the nearest focusable element in the pressed direction.
 * The player handles its own keys first (seek, volume) and stops the event
 * when it uses one, so this only runs for keys the player leaves alone.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

const DIRECTIONS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

function visible(el) {
  if (el.closest("[inert]")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

function candidates() {
  // The player stage sits on top while open; keep focus inside it.
  const scope = document.querySelector(".stage") || document;
  return [...scope.querySelectorAll(FOCUSABLE)].filter(visible);
}

const isTextField = (el) =>
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "submit", "file"].includes(el.type));

/** Text fields being edited keep left/right for the caret, sliders for their value. */
function keepsHorizontalKeys(el) {
  if (el instanceof HTMLInputElement && el.type === "range") return true;
  return isTextField(el) && el.dataset.tvEditing === "1";
}

/*
 * On a TV, focusing a text field opens the on-screen keyboard, which then takes
 * over the D-pad. Like native TV apps, fields only open the keyboard when OK is
 * pressed: while merely focused they're read-only.
 */
function guardTextFields() {
  document.addEventListener(
    "focusin",
    (event) => {
      const el = event.target;
      if (isTextField(el) && el.dataset.tvEditing !== "1") el.readOnly = true;
    },
    true
  );
  document.addEventListener(
    "focusout",
    (event) => {
      const el = event.target;
      if (!isTextField(el)) return;
      delete el.dataset.tvEditing;
      el.readOnly = false;
    },
    true
  );
}

/** OK on a focused text field: make it editable and bring up the keyboard. */
function startEditing(el) {
  el.dataset.tvEditing = "1";
  el.readOnly = false;
  // Refocusing an editable field is what makes the WebView show the keyboard.
  el.blur();
  el.dataset.tvEditing = "1";
  el.focus();
  el.click();
}

function move(direction) {
  const all = candidates();
  if (!all.length) return false;
  const current = document.activeElement;
  if (!current || current === document.body || !all.includes(current)) {
    all[0].focus();
    all[0].scrollIntoView({ block: "nearest", inline: "nearest" });
    return true;
  }

  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best = null;
  let bestScore = Infinity;

  for (const el of all) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    // Must lie in the pressed direction, measured from the facing edge.
    const along = direction.x ? dx * direction.x : dy * direction.y;
    const edgeGap = direction.x
      ? direction.x > 0 ? r.left - from.right : from.left - r.right
      : direction.y > 0 ? r.top - from.bottom : from.top - r.bottom;
    if (along <= 0 || edgeGap < -Math.min(from.width, from.height) / 2) continue;
    const across = direction.x ? Math.abs(dy) : Math.abs(dx);
    // Overlap on the cross axis (same row or column) is strongly preferred.
    const overlaps = direction.x
      ? r.bottom > from.top && r.top < from.bottom
      : r.right > from.left && r.left < from.right;
    // Left/right stays on the same row; jumping rows sideways feels random on a remote.
    if (direction.x && !overlaps) continue;
    const score = Math.max(0, edgeGap) + across * (overlaps ? 0.5 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (!best) return false;
  best.focus();
  best.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

export function enableSpatialNavigation() {
  document.documentElement.classList.add("tv");
  guardTextFields();
  window.addEventListener("keydown", (event) => {
    const target0 = document.activeElement;
    if (event.key === "Enter" && isTextField(target0) && target0.readOnly && target0.dataset.tvEditing !== "1") {
      event.preventDefault();
      event.stopPropagation();
      startEditing(target0);
      return;
    }
    const direction = DIRECTIONS[event.key];
    if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = document.activeElement;
    if (target && direction.x && keepsHorizontalKeys(target)) return;
    if (target instanceof HTMLSelectElement) return;
    if (move(direction)) event.preventDefault();
  });
}
