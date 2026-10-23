<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { createId, formatWhen, hostOf } from "$lib";
  import { STORAGE_KEYS, loadList, saveList } from "$lib/stream.js";
  import { parseM3U } from "$lib/m3uParser.js";
  import { showToast } from "$lib/toast.svelte.js";

  let playlists = $state([]);
  let name = $state("");
  let url = $state("");
  let urlError = $state("");
  let dragging = $state(false);
  let reading = $state(false);
  let fileInput;

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
</style>
