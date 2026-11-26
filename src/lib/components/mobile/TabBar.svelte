<script>
  import { page } from "$app/state";
  import Icon from "$lib/components/Icon.svelte";

  const tabs = [
    { label: "Watch", href: "/", icon: "broadcast" },
    { label: "Library", href: "/library", icon: "stack" },
    { label: "Playlists", href: "/playlist", icon: "list" },
    { label: "Settings", href: "/settings", icon: "sliders" },
  ];

  const isActive = (href) => (href === "/" ? page.url.pathname === "/" : page.url.pathname.startsWith(href));
</script>

<nav class="tabbar" aria-label="Main">
  {#each tabs as tab}
    <a href={tab.href} class:active={isActive(tab.href)} aria-current={isActive(tab.href) ? "page" : undefined}>
      <span class="pill" aria-hidden="true"><Icon name={tab.icon} size={22} /></span>
      <span class="label">{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    display: flex;
    height: var(--m-tabbar);
    background: #000;
    border-top: 1px solid var(--m-line);
  }

  a {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--m-muted);
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }

  .pill {
    display: grid;
    place-items: center;
    width: 56px;
    height: 30px;
    margin-bottom: 3px;
    border-radius: 999px;
    transition: background-color 180ms ease, color 180ms ease;
  }

  .label {
    font-size: 11.5px;
    font-weight: 560;
    letter-spacing: 0.01em;
  }

  a.active {
    color: var(--m-ink);
  }

  a.active .pill {
    background: var(--accent);
    color: var(--accent-ink);
  }

  a.active .label {
    font-weight: 680;
  }
</style>
