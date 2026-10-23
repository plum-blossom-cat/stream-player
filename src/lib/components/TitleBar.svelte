<script>
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/state";
  import { isTauri } from "$lib";
  import Icon from "$lib/components/Icon.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import { player, closePlayer } from "$lib/player/player.svelte.js";

  const nav = [
    { label: "Workspace", href: "/" },
    { label: "Library", href: "/library" },
    { label: "Playlists", href: "/playlist" },
    { label: "Settings", href: "/settings" },
  ];

  let appWindow = null;
  let maximized = $state(false);
  let unlisten;

  const isActive = (href) =>
    href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href);

  onMount(async () => {
    if (!isTauri) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    appWindow = getCurrentWindow();
    maximized = await appWindow.isMaximized();
    unlisten = await appWindow.onResized(async () => {
      maximized = await appWindow.isMaximized();
    });
  });

  onDestroy(() => unlisten?.());
</script>

<header class="titlebar" data-tauri-drag-region>
  <a class="brand" href="/" onclick={() => player.open && closePlayer()} aria-label="Stream Player, workspace">
    <Logo size={22} />
    <span class="brand-name">Stream Player</span>
  </a>

  <nav aria-label="Main">
    {#each nav as item}
      <a
        href={item.href}
        class:active={isActive(item.href) && !player.open}
        aria-current={isActive(item.href) ? "page" : undefined}
        onclick={() => player.open && closePlayer()}
      >
        <i class="led" aria-hidden="true"></i>
        {item.label}
      </a>
    {/each}
  </nav>

  <div class="drag" data-tauri-drag-region></div>

  {#if player.open}
    <span class="on-air" data-tauri-drag-region><i aria-hidden="true"></i>Playing</span>
  {/if}

  {#if isTauri}
    <div class="window-controls">
      <button onclick={() => appWindow?.minimize()} aria-label="Minimize" title="Minimize">
        <Icon name="win-min" size={16} />
      </button>
      <button onclick={() => appWindow?.toggleMaximize()} aria-label={maximized ? "Restore" : "Maximize"} title={maximized ? "Restore" : "Maximize"}>
        <Icon name={maximized ? "win-restore" : "win-max"} size={15} />
      </button>
      <button class="close" onclick={() => appWindow?.close()} aria-label="Close" title="Close">
        <Icon name="close" size={17} />
      </button>
    </div>
  {/if}
</header>

<style>
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    height: var(--titlebar-h);
    display: flex;
    align-items: stretch;
    background: var(--bg);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 18px 0 14px;
    border-right: 1px solid var(--line);
    text-decoration: none;
    color: var(--ink);
  }

  .brand-name {
    font-size: 13.5px;
    font-weight: 700;
    font-variation-settings: "wdth" 122;
    letter-spacing: -0.005em;
  }

  /* Tabs are bordered cells with a small indicator light, like panel switches. */
  nav {
    display: flex;
    align-items: stretch;
  }

  nav a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    border-right: 1px solid var(--line);
    color: var(--muted);
    text-decoration: none;
    font-size: 13px;
    font-weight: 540;
    transition: color 120ms ease, background-color 120ms ease;
  }

  nav a:hover {
    color: var(--ink);
    background: var(--surface);
  }

  nav a.active {
    color: var(--ink);
    font-weight: 600;
    background: var(--surface);
  }

  .led {
    width: 6px;
    height: 6px;
    border-radius: 1px;
    background: var(--line-strong);
    transition: background-color 120ms ease, box-shadow 120ms ease;
  }

  nav a.active .led {
    background: var(--accent);
    box-shadow: 0 0 6px rgb(255 210 63 / 0.75);
  }

  nav a:focus-visible {
    outline-offset: -3px;
  }

  .drag {
    flex: 1;
  }

  .on-air {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 14px;
    color: var(--muted);
    font-size: 12.5px;
    font-weight: 560;
  }

  .on-air i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  .window-controls {
    display: flex;
  }

  .window-controls button {
    width: 46px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: var(--muted);
    transition: background-color 100ms ease, color 100ms ease;
  }

  .window-controls button:hover {
    background: var(--raised);
    color: var(--ink);
  }

  .window-controls .close:hover {
    background: #c42b1c;
    color: #fff;
  }

  @media (max-width: 760px) {
    .brand-name {
      display: none;
    }
    nav a {
      padding: 0 11px;
    }
  }
</style>
