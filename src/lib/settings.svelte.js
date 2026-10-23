const SETTINGS_KEY = "msp_app_settings";

const defaults = {
  /** @type {"system" | "dark" | "light"} */
  theme: "dark",
  playMuted: false,
  rememberVolume: true,
  rememberAudio: true,
  autoHideControls: true,
};

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      ...defaults,
      ...stored,
      theme: ["system", "dark", "light"].includes(stored?.theme) ? stored.theme : defaults.theme,
    };
  } catch {
    return { ...defaults };
  }
}

export const settings = $state(typeof localStorage === "undefined" ? { ...defaults } : read());

export function applyTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
}

/** @param {Partial<typeof defaults>} patch */
export function updateSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify($state.snapshot(settings)));
  } catch {}
  applyTheme();
}
