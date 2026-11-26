<script>
  import "@fontsource-variable/archivo/wdth.css";
  import "../app.css";
  import { onMount } from "svelte";
  import { isTauri, isAndroid, isTv } from "$lib";
  import { enableSpatialNavigation } from "$lib/spatial.js";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import TabBar from "$lib/components/mobile/TabBar.svelte";
  import { viewport, closeTopSheet } from "$lib/viewport.svelte.js";
  import Toasts from "$lib/components/Toasts.svelte";
  import PlayerStage from "$lib/components/PlayerStage.svelte";
  import { player } from "$lib/player/player.svelte.js";
  import { applyTheme } from "$lib/settings.svelte.js";

  let { children } = $props();

  // "Match system" removes data-theme so the CSS media query takes over.
  applyTheme();

  onMount(async () => {
    if (!import.meta.env.DEV) {
      document.addEventListener("keydown", (event) => {
        if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")) {
          event.preventDefault();
        }
      });
    }

    if (isAndroid) {
      document.documentElement.classList.add("android");
      if (isTv) enableSpatialNavigation();
      // MainActivity asks this first when Back is pressed; false lets Android go back or exit.
      window["__streamPlayerBack"] = () => {
        if (closeTopSheet()) return true;
        if (player.open) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
          return true;
        }
        if (location.pathname !== "/") {
          history.back();
          return true;
        }
        return false;
      };
      return;
    }

    if (!isTauri) return;

    const [{ invoke }, { Menu, PredefinedMenuItem }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/menu"),
    ]);

    const menu = await Menu.new({
      items: await Promise.all([
        PredefinedMenuItem.new({ text: "Cut", item: "Cut" }),
        PredefinedMenuItem.new({ text: "Copy", item: "Copy" }),
        PredefinedMenuItem.new({ text: "Paste", item: "Paste" }),
        PredefinedMenuItem.new({ text: "Select all", item: "SelectAll" }),
      ]),
    });

    document.addEventListener("contextmenu", async (event) => {
      if (import.meta.env.DEV) return;
      event.preventDefault();
      const target = /** @type {HTMLElement} */ (event.target);
      if (["TEXTAREA", "INPUT"].includes(target.tagName)) await menu.popup();
    });

    // Window starts hidden so it doesn't flash white before the UI paints.
    requestAnimationFrame(() => invoke("show_main_window"));
  });
</script>

{#if viewport.phone}
  {#if !player.open && !viewport.typing}<TabBar />{/if}
{:else}
  <TitleBar />
{/if}

<main
  class="content"
  class:phone={viewport.phone}
  class:typing={viewport.typing}
  class:behind-player={player.open}
  inert={player.open}
>
  {@render children()}
</main>

{#if player.open}
  <PlayerStage />
{/if}

<Toasts />

<style>
  .content {
    position: fixed;
    inset: var(--titlebar-h) 0 0 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .behind-player {
    visibility: hidden;
  }

  /* Phones: no title bar; the tab bar sits at the bottom (hidden while typing). */
  .content.phone {
    top: 0;
    bottom: var(--m-tabbar);
  }

  .content.phone.typing {
    bottom: 0;
  }
</style>
