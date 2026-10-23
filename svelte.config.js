// Tauri has no Node server, so the app is built as an SPA with an index.html fallback.
// See: https://v2.tauri.app/start/frontend/sveltekit/
import adapter from "@sveltejs/adapter-static";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
  },
};

export default config;
