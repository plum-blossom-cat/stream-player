import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

/**
 * Svelte scopes component styles as `a:where(.svelte-xyz)`. `:where()` needs
 * Chrome 88, so older Android WebViews drop those rules entirely. Writing the
 * scope class plainly keeps the same scoping and works everywhere.
 */
const plainScopedSelectors = () => ({
  name: "plain-scoped-selectors",
  enforce: "post",
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === "asset" && file.fileName.endsWith(".css") && typeof file.source === "string") {
        file.source = expandInset(file.source.replace(/:where\((\.svelte-[\w-]+)\)/g, "$1"));
      }
    }
  },
});

/** Split a CSS value on top-level spaces, keeping calc(), var() and env() intact. */
function splitValue(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

/** `inset` needs Chrome 87; old WebViews ignore it and positioned layers collapse. */
function expandInset(css) {
  return css.replace(/(^|[{;\s])inset:([^;}]+)/g, (_m, before, raw) => {
    const important = /!important\s*$/.test(raw);
    const values = splitValue(raw.replace(/!important\s*$/, ""));
    const [top, right = top, bottom = top, left = right] = values;
    const imp = important ? "!important" : "";
    return `${before}top:${top}${imp};right:${right}${imp};bottom:${bottom}${imp};left:${left}${imp}`;
  });
}

export default defineConfig(async () => ({
  plugins: [sveltekit(), plainScopedSelectors()],

  // Android uses the system WebView, which on older phones and TV boxes can be
  // years out of date (Android 11 shipped Chrome 83). Compile for those engines;
  // app.html adds polyfills for the few newer built-ins the code relies on.
  build: {
    target: ["es2020", "chrome80", "safari14"],
    cssTarget: ["chrome80", "safari14"],
  },

  // Keep Rust errors visible and use the fixed port Tauri expects.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
