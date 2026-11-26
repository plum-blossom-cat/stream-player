<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { createId, formatWhen, hostOf } from "$lib";
  import { STORAGE_KEYS, loadList, saveList } from "$lib/stream.js";
  import { parseM3U } from "$lib/m3uParser.js";
  import { showToast } from "$lib/toast.svelte.js";
  import { viewport } from "$lib/viewport.svelte.js";
  import Sheet from "$lib/components/mobile/Sheet.svelte";

  let playlists = $state([]);
  let name = $state("");
  let url = $state("");
  let urlError = $state("");
  let dragging = $state(false);
  let reading = $state(false);
  let fileInput = $state();
  // Phone: adding happens in a sheet; each row has a sheet of actions.
  let addOpen = $state(false);
  let actionsFor = $state(null);

  onMount(() => (playlists = loadList(STORAGE_KEYS.playlists)));

  function add(event) {
    event.preventDefault();
    const link = url.trim();
    try {
      const parsed = new URL(link);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      urlError = link ? "This isn't a valid http or https URL." : "Enter the playlist URL.";
      document.getElementById("playlistUrl")?.focus();
      return;
    }
    urlError = "";
    const label = name.trim() || hostOf(link);
    const now = new Date().toISOString();
    const item = { id: createId(), name: label, url: link, createdAt: now, updatedAt: now };
    playlists = [item, ...playlists];
    saveList(STORAGE_KEYS.playlists, playlists);
    name = "";
    url = "";
    addOpen = false;
    goto(`/playlist/${item.id}`);
  }

  function remove(item) {
    playlists = playlists.filter((p) => p.id !== item.id);
    saveList(STORAGE_KEYS.playlists, playlists);
    showToast(`Removed “${item.name}”.`);
  }

  /** @param {File} file */
  async function openFile(file) {
    if (!file) return;
    reading = true;
    try {
      const channels = parseM3U(await file.text());
      if (!channels.length) {
        showToast(`No channels found in ${file.name}. Check that it's an M3U playlist.`, "error");
        return;
      }
      sessionStorage.setItem(
        STORAGE_KEYS.tempPlaylist,
        JSON.stringify({
          id: "file",
          name: file.name.replace(/\.(m3u8?|txt)$/i, "") || "Playlist file",
          source: "file",
          loadedAt: new Date().toISOString(),
          channels,
        })
      );
      goto("/playlist/file");
    } catch (error) {
      showToast(`Couldn't read ${file.name}: ${error.message || error}`, "error");
    } finally {
      reading = false;
    }
  }

  function onDrop(event) {
    event.preventDefault();
    dragging = false;
    openFile(event.dataTransfer?.files?.[0]);
  }
</script>

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragging = false;
  }}
  ondrop={onDrop}
/>

{#if viewport.phone}
<div class="m-screen">
  <div class="m-appbar top">
    <span class="m-spacer"></span>
    <button class="m-icon-btn" onclick={() => fileInput.click()} disabled={reading} aria-label="Open a playlist file">
      <Icon name="file" size={21} />
    </button>
  </div>
  <h1 class="m-title">Playlists</h1>

  {#if playlists.length}
    <div class="m-group">
      {#each playlists as item (item.id)}
        <div class="m-row">
          <span class="m-tile" aria-hidden="true"><Icon name="list" size={20} /></span>
          <a class="row-hit" href={`/playlist/${item.id}`}>
            <span class="m-row-text">
              <span class="m-row-title">{item.name}</span>
              <span class="m-row-meta"><span class="m-sub">{hostOf(item.url)}</span></span>
            </span>
          </a>
          <button class="m-icon-btn" onclick={() => (actionsFor = item)} aria-label="More for {item.name}">
            <Icon name="more" size={20} />
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <div class="m-empty">
      <strong>No playlists yet</strong>
      Add an M3U link or open a file from this phone. Headers and ClearKey details in the playlist apply to every channel.
    </div>
  {/if}

  <button class="m-btn primary add-btn" onclick={() => (addOpen = true)}>
    <Icon name="plus" size={18} /> Add playlist
  </button>
  <button class="m-btn" onclick={() => fileInput.click()} disabled={reading}>
    <Icon name="file" size={17} /> {reading ? "Reading…" : "Open a file"}
  </button>
</div>

<Sheet open={addOpen} title="Add playlist" onclose={() => (addOpen = false)}>
  <form onsubmit={add} novalidate>
    <div class="m-field">
      <label for="playlistUrl">Playlist link</label>
      <input id="playlistUrl" class="m-input" class:invalid={!!urlError} bind:value={url} placeholder="https://example.com/channels.m3u" inputmode="url" spellcheck="false" oninput={() => (urlError = "")} />
      {#if urlError}<p class="error-text">{urlError}</p>{/if}
    </div>
    <div class="m-field">
      <label for="playlistName">Name (optional)</label>
      <input id="playlistName" class="m-input" bind:value={name} placeholder="Uses the site name if empty" enterkeyhint="done" />
    </div>
    <button class="m-btn primary" type="submit"><Icon name="plus" size={18} /> Add playlist</button>
  </form>
</Sheet>

<Sheet open={!!actionsFor} title={actionsFor?.name ?? ""} onclose={() => (actionsFor = null)}>
  {#if actionsFor}
    <p class="sheet-url">{actionsFor.url}</p>
    <a class="m-btn primary" href={`/playlist/${actionsFor.id}`} onclick={() => (actionsFor = null)}><Icon name="list" size={18} /> Open channels</a>
    <button class="m-btn danger" onclick={() => { const it = actionsFor; actionsFor = null; remove(it); }}><Icon name="trash" size={17} /> Remove playlist</button>
  {/if}
</Sheet>

<input bind:this={fileInput} type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl" hidden onchange={(e) => { openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
{:else}
<div class="page">
  <div class="page-head">
    <div>
      <h1 class="display">Playlists</h1>
      <p class="lede">Browse M3U channel lists. Headers and ClearKey details in the playlist are applied to each channel.</p>
    </div>
    <button class="btn" onclick={() => fileInput.click()} disabled={reading}>
      <Icon name="file" size={16} />
      {reading ? "Reading…" : "Open a file"}
    </button>
    <input bind:this={fileInput} type="file" accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl" hidden onchange={(e) => { openFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
  </div>

  <form class="add" onsubmit={add} novalidate>
    <div class="field url">
      <label for="playlistUrl">Playlist URL</label>
      <input id="playlistUrl" class="input" class:invalid={!!urlError} bind:value={url} placeholder="https://example.com/channels.m3u" spellcheck="false" oninput={() => (urlError = "")} />
    </div>
    <div class="field name">
      <label for="playlistName">Name <span class="optional">optional</span></label>
      <input id="playlistName" class="input" bind:value={name} placeholder="Uses the site name if empty" />
    </div>
    <button class="btn primary" type="submit"><Icon name="plus" size={16} />Add playlist</button>
    {#if urlError}<p class="error-text full">{urlError}</p>{/if}
  </form>

  {#if playlists.length}
    <ul class="rows">
      {#each playlists as item (item.id)}
        <li class="row">
          <a class="row-main" href={`/playlist/${item.id}`}>
            <span class="row-title">{item.name}</span>
            <span class="row-meta"><span class="url">{item.url}</span></span>
          </a>
          <div class="row-actions">
            <span class="when">Added {formatWhen(item.createdAt).toLowerCase()}</span>
            <a class="btn sm" href={`/playlist/${item.id}`}>Open<Icon name="chevron-right" size={14} /></a>
            <button class="btn sm icon quiet danger" onclick={() => remove(item)} aria-label="Remove {item.name}" title="Remove">
              <Icon name="trash" size={16} />
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {:else}
    <div class="empty">
      <strong>No playlists yet</strong>
      Add a playlist URL above, or drop an .m3u file anywhere on this page.
    </div>
  {/if}
</div>

{#if dragging}
  <div class="drop" aria-hidden="true">
    <div class="drop-inner">
      <Icon name="upload" size={28} />
      Drop the playlist file to open it
    </div>
  </div>
{/if}
{/if}

<style>
  .add {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto;
    align-items: end;
    gap: 12px;
    margin-bottom: 36px;
    padding: 18px;
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--line);
  }

  .add .btn {
    height: 38px;
  }

  .full {
    grid-column: 1 / -1;
    margin-top: -4px;
  }

  .optional {
    color: var(--faint);
    font-weight: 400;
    margin-left: 4px;
  }

  .row-main {
    display: block;
    min-width: 0;
    text-decoration: none;
  }

  .row-main .row-title {
    display: block;
  }

  .row-main:hover .row-title {
    color: var(--accent-text);
  }

  .row-actions a.btn {
    text-decoration: none;
    gap: 2px;
    padding-right: 6px;
  }

  .when {
    color: var(--faint);
    font-size: 12.5px;
    margin-right: 10px;
    white-space: nowrap;
  }

  .drop {
    position: fixed;
    inset: var(--titlebar-h) 0 0 0;
    z-index: 40;
    display: grid;
    place-items: center;
    background: var(--scrim);
    pointer-events: none;
  }

  .drop-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px 56px;
    border-radius: var(--r-lg);
    border: 1px dashed var(--accent);
    background: var(--surface);
    font-size: 15px;
    font-weight: 560;
    color: var(--ink);
  }

  .drop-inner :global(svg) {
    color: var(--accent);
  }

  @media (max-width: 760px) {
    .add {
      grid-template-columns: minmax(0, 1fr);
    }
    .when {
      display: none;
    }
  }

  /* ---------- Phone ---------- */
  .m-appbar.top {
    height: 48px;
  }

  .m-appbar.top + .m-title {
    margin-top: 0;
  }

  .row-hit {
    min-width: 0;
    align-self: stretch;
    display: flex;
    align-items: center;
    color: inherit;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }

  .add-btn {
    margin-top: 20px;
  }

  .m-input.invalid {
    border-color: var(--red);
  }

  .sheet-url {
    margin: 0 0 18px;
    color: var(--m-muted);
    font-size: 13px;
    word-break: break-all;
  }
</style>
