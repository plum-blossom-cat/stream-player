<script>
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { fetchText, hostOf } from "$lib";
  import { STORAGE_KEYS, loadList } from "$lib/stream.js";
  import { parseM3U } from "$lib/m3uParser.js";
  import { openPlayer, player } from "$lib/player/player.svelte.js";
  import { showToast } from "$lib/toast.svelte.js";

  const PAGE_SIZE = 240;

  let playlist = $state(null);
  /** @type {any[]} */
  let channels = $state([]);
  let loading = $state(false);
  let loadError = $state("");
  let query = $state("");
  let group = $state("All");
  let limit = $state(PAGE_SIZE);
  let sentinel = $state();

  const groups = $derived.by(() => {
    const counts = new Map();
    for (const c of channels) counts.set(c.group || "Ungrouped", (counts.get(c.group || "Ungrouped") || 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  // Each channel keeps its number from the original playlist order.
  const numbered = $derived(channels.map((c, i) => ({ ...c, number: i + 1 })));

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return numbered.filter((c) => {
      if (group !== "All" && (c.group || "Ungrouped") !== group) return false;
      if (!q) return true;
      return `${c.name} ${c.group} ${c.tvgId} ${c.number}`.toLowerCase().includes(q);
    });
  });

  const visible = $derived(filtered.slice(0, limit));

  async function loadSaved(id) {
    const saved = loadList(STORAGE_KEYS.playlists).find((p) => p.id === id);
    if (!saved) {
      showToast("That playlist isn't in your list any more.", "error");
      goto("/playlist");
      return;
    }
    playlist = saved;
    loading = true;
    loadError = "";
    try {
      channels = parseM3U(await fetchText(saved.url));
      if (!channels.length) loadError = "The playlist loaded but has no playable channels.";
    } catch (error) {
      loadError = `Couldn't load the playlist from ${hostOf(saved.url)}: ${error.message || error}`;
    } finally {
      loading = false;
    }
  }

  function loadFile() {
    try {
      const temp = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.tempPlaylist) || "null");
      if (!temp || !Array.isArray(temp.channels)) throw new Error();
      playlist = temp;
      channels = temp.channels;
    } catch {
      showToast("Open the playlist file again from Playlists.", "error");
      goto("/playlist");
    }
  }

  function reload() {
    const id = page.params.id;
    group = "All";
    limit = PAGE_SIZE;
    if (id === "file") loadFile();
    else loadSaved(id);
  }

  $effect(() => {
    page.params.id;
    untrack(reload);
  });

  // Reset paging when the filter changes.
  $effect(() => {
    query;
    group;
    limit = PAGE_SIZE;
  });

  // Render more tiles as the end of the grid scrolls into view.
  $effect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && limit < filtered.length) limit += PAGE_SIZE;
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function play(channel) {
    const queue = filtered.map((c) => ({
      title: c.name,
      subtitle: c.group,
      logo: c.logo,
      stream: c.stream,
    }));
    openPlayer(channel.stream, {
      title: channel.name,
      subtitle: channel.group,
      logo: channel.logo,
      queue,
      index: filtered.indexOf(channel),
    });
  }

  function initials(name) {
    return (
      name
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || "?"
    );
  }
</script>

<div class="page wide">
  <a class="back" href="/playlist"><Icon name="arrow-left" size={16} />Playlists</a>

  <div class="page-head">
    <div class="head-text">
      <h1 class="display">{playlist?.name ?? "Playlist"}</h1>
      <p class="lede">
        {#if loading}
          Loading channels…
        {:else if channels.length}
          <span class="num">{channels.length.toLocaleString()}</span> channels in
          <span class="num">{groups.length}</span> group{groups.length === 1 ? "" : "s"}{playlist?.url ? ` from ${hostOf(playlist.url)}` : ", opened from a file"}.
        {:else if !loadError}
          No channels.
        {/if}
      </p>
    </div>
    {#if playlist?.url}
      <button class="btn" onclick={reload} disabled={loading}>
        <Icon name="refresh" size={16} />
        {loading ? "Loading…" : "Reload"}
      </button>
    {/if}
  </div>

  {#if loadError}
    <div class="empty">
      <strong>{loadError}</strong>
      Check the URL in a browser, or try Reload.
    </div>
  {/if}

  {#if channels.length}
    <div class="filters">
      <div class="search">
        <Icon name="search" size={16} />
        <label for="channelQuery" class="visually-hidden">Search channels</label>
        <input id="channelQuery" class="input" bind:value={query} placeholder="Search by name, group or number" />
      </div>
      {#if groups.length > 1}
        <div class="groups" role="group" aria-label="Filter by group">
          <button aria-pressed={group === "All"} onclick={() => (group = "All")}>
            All <span class="num">{channels.length}</span>
          </button>
          {#each groups as [name, count] (name)}
            <button aria-pressed={group === name} onclick={() => (group = name)}>
              {name} <span class="num">{count}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if filtered.length}
      <ul class="grid">
        {#each visible as channel (channel.id)}
          <li>
            <button class="tile" class:current={player.open && player.title === channel.name} onclick={() => play(channel)}>
              <span class="logo">
                {#if channel.logo}
                  <img src={channel.logo} alt="" loading="lazy" decoding="async" onerror={(e) => e.currentTarget.remove()} />
                {/if}
                <span class="initials" aria-hidden="true">{initials(channel.name)}</span>
              </span>
              <span class="info">
                <span class="name">{channel.name}</span>
                <span class="sub">
                  <span class="number num">{channel.number}</span>
                  <span class="group">{channel.group}</span>
                  {#if channel.stream.drmScheme !== "none"}<span class="drm">DRM</span>{/if}
                </span>
              </span>
              <span class="go" aria-hidden="true"><Icon name="play" size={14} /></span>
            </button>
          </li>
        {/each}
      </ul>
      {#if limit < filtered.length}
        <div bind:this={sentinel} class="more">Showing {visible.length} of {filtered.length}</div>
      {/if}
    {:else}
      <p class="none">No channels match “{query}”{group !== "All" ? ` in ${group}` : ""}.</p>
    {/if}
  {/if}
</div>

<style>
  .wide {
    max-width: 1440px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 18px;
    color: var(--muted);
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 540;
  }

  .back:hover {
    color: var(--ink);
  }

  .head-text {
    min-width: 0;
  }

  .head-text .display {
    overflow-wrap: anywhere;
  }

  .filters {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0 calc(var(--gutter) * -1) 20px;
    padding: 14px var(--gutter);
    background: var(--bg);
    border-bottom: 1px solid var(--line);
  }

  .search {
    position: relative;
    max-width: 420px;
    color: var(--faint);
  }

  .search :global(svg) {
    position: absolute;
    left: 12px;
    top: 11px;
  }

  .search .input {
    padding-left: 36px;
  }

  .groups {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }

  .groups button {
    flex: none;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font-size: 13px;
    font-weight: 540;
    white-space: nowrap;
  }

  .groups button:hover {
    color: var(--ink);
    border-color: var(--line-strong);
  }

  .groups button .num {
    margin-left: 4px;
    color: var(--faint);
  }

  .groups button[aria-pressed="true"] {
    background: var(--raised);
    border-color: var(--accent);
    color: var(--ink);
    font-weight: 600;
  }

  .groups button[aria-pressed="true"] .num {
    color: var(--accent-text);
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 8px;
  }

  .tile {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px 10px 10px;
    border-radius: var(--r-lg);
    border: 1px solid var(--line);
    background: var(--surface);
    text-align: left;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .tile:hover {
    border-color: var(--line-strong);
    background: var(--raised);
  }

  .tile.current {
    border-color: var(--accent);
  }

  .logo {
    position: relative;
    width: 52px;
    height: 52px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--r-md);
    background: var(--sunken);
    border: 1px solid var(--line);
    overflow: hidden;
  }

  .logo img {
    position: absolute;
    inset: 6px;
    width: calc(100% - 12px);
    height: calc(100% - 12px);
    object-fit: contain;
    z-index: 1;
  }

  .initials {
    font-size: 15px;
    font-weight: 700;
    font-variation-settings: "wdth" 120;
    color: var(--faint);
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name {
    font-weight: 580;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .sub {
    display: flex;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    min-width: 0;
  }

  .number {
    color: var(--faint);
    flex: none;
  }

  .group {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drm {
    color: var(--accent-text);
    font-weight: 600;
    flex: none;
  }

  .go {
    width: 30px;
    height: 30px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--r-md);
    background: var(--accent);
    color: var(--accent-ink);
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 120ms ease, transform 120ms var(--ease-out);
  }

  .tile:hover .go,
  .tile:focus-visible .go {
    opacity: 1;
    transform: none;
  }

  .more {
    padding: 24px;
    text-align: center;
    color: var(--faint);
    font-size: 13px;
  }

  .none {
    padding: 24px 0;
    color: var(--muted);
  }
</style>
