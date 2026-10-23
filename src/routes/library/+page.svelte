<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { createId, formatWhen, hostOf } from "$lib";
  import { STORAGE_KEYS, loadList, saveList, formatLabel, normalizeStream } from "$lib/stream.js";
  import { openPlayer, player } from "$lib/player/player.svelte.js";
  import { workspace } from "$lib/workspace.svelte.js";
  import { showToast } from "$lib/toast.svelte.js";

  let saved = $state([]);
  let history = $state([]);
  let query = $state("");

  const matches = (text) => text.toLowerCase().includes(query.trim().toLowerCase());
  const filteredSaved = $derived(
    query.trim() ? saved.filter((i) => matches(`${i.name} ${i.stream.streamUrl}`)) : saved
  );
  const filteredHistory = $derived(
    query.trim() ? history.filter((i) => matches(`${i.title || ""} ${i.stream.streamUrl}`)) : history
  );

  function refresh() {
    saved = loadList(STORAGE_KEYS.saved);
    history = loadList(STORAGE_KEYS.history);
  }

  onMount(refresh);

  $effect(() => {
    if (!player.open) refresh();
  });

  function edit(item) {
    workspace.draft = { stream: item.stream, profileId: item.id, profileName: item.name };
    goto("/");
  }

  function editHistory(item) {
    workspace.draft = { stream: item.stream };
    goto("/");
  }

  function remove(item) {
    saved = saved.filter((i) => i.id !== item.id);
    saveList(STORAGE_KEYS.saved, saved);
    showToast(`Deleted “${item.name}”.`);
  }

  function keep(item) {
    const name = item.title || hostOf(item.stream.streamUrl);
    const now = new Date().toISOString();
    saved = [{ id: createId(), name, createdAt: now, updatedAt: now, stream: normalizeStream(item.stream) }, ...saved];
    saveList(STORAGE_KEYS.saved, saved);
    showToast(`Saved “${name}” as a profile. Rename it from Edit.`);
  }

  function forget(item) {
    history = history.filter((i) => i.id !== item.id);
    saveList(STORAGE_KEYS.history, history);
  }

  function clearHistory() {
    history = [];
    saveList(STORAGE_KEYS.history, []);
    showToast("History cleared.");
  }
</script>

<div class="page">
  <div class="page-head">
    <div>
      <h1 class="display">Library</h1>
      <p class="lede">Profiles you saved and everything you played recently, kept on this computer.</p>
    </div>
    {#if saved.length || history.length}
      <div class="search">
        <Icon name="search" size={16} />
        <label for="libraryQuery" class="visually-hidden">Filter library</label>
        <input id="libraryQuery" class="input" bind:value={query} placeholder="Filter by name or URL" />
      </div>
    {/if}
  </div>

  <section class="block" aria-labelledby="profiles-title">
    <div class="block-head">
      <h2 id="profiles-title" class="section-title">Profiles <span class="n num">{saved.length}</span></h2>
    </div>
    {#if filteredSaved.length}
      <ul class="rows">
        {#each filteredSaved as item (item.id)}
          <li class="row">
            <button class="row-main" onclick={() => openPlayer(item.stream, { title: item.name })}>
              <span class="row-title">{item.name}</span>
              <span class="row-meta">
                <span class="tag">{formatLabel(item.stream)}</span>
                {#if item.stream.drmScheme !== "none"}<span class="tag drm">DRM</span>{/if}
                <span class="url">{item.stream.streamUrl}</span>
              </span>
            </button>
            <div class="row-actions">
              <span class="when">{formatWhen(item.updatedAt ?? item.createdAt)}</span>
              <button class="btn sm icon go" onclick={() => openPlayer(item.stream, { title: item.name })} aria-label="Play {item.name}" title="Play">
                <Icon name="play" size={15} />
              </button>
              <button class="btn sm icon quiet" onclick={() => edit(item)} aria-label="Edit {item.name}" title="Edit">
                <Icon name="edit" size={16} />
              </button>
              <button class="btn sm icon quiet danger" onclick={() => remove(item)} aria-label="Delete {item.name}" title="Delete">
                <Icon name="trash" size={16} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {:else if saved.length}
      <p class="none">No profiles match “{query}”.</p>
    {:else}
      <div class="empty">
        <strong>No profiles yet</strong>
        Set up a stream in the workspace and use Save as profile to keep its headers and keys together.
        <div class="empty-action"><a class="btn" href="/">Go to workspace</a></div>
      </div>
    {/if}
  </section>

  <section class="block" aria-labelledby="history-title">
    <div class="block-head">
      <h2 id="history-title" class="section-title">History <span class="n num">{history.length}</span></h2>
      {#if history.length}
        <button class="btn quiet sm" onclick={clearHistory}>Clear history</button>
      {/if}
    </div>
    {#if filteredHistory.length}
      <ul class="rows">
        {#each filteredHistory as item (item.id)}
          <li class="row">
            <button class="row-main" onclick={() => openPlayer(item.stream, { title: item.title })}>
              <span class="row-title">{item.title || hostOf(item.stream.streamUrl)}</span>
              <span class="row-meta">
                <span class="tag">{formatLabel(item.stream)}</span>
                {#if item.stream.drmScheme !== "none"}<span class="tag drm">DRM</span>{/if}
                <span class="url">{item.stream.streamUrl}</span>
              </span>
            </button>
            <div class="row-actions">
              <span class="when">{formatWhen(item.lastPlayed)}</span>
              <button class="btn sm icon go" onclick={() => openPlayer(item.stream, { title: item.title })} aria-label="Play again" title="Play again">
                <Icon name="play" size={15} />
              </button>
              <button class="btn sm icon quiet" onclick={() => editHistory(item)} aria-label="Open in workspace" title="Open in workspace">
                <Icon name="edit" size={16} />
              </button>
              <button class="btn sm icon quiet" onclick={() => keep(item)} aria-label="Save as profile" title="Save as profile">
                <Icon name="bookmark" size={16} />
              </button>
              <button class="btn sm icon quiet danger" onclick={() => forget(item)} aria-label="Remove from history" title="Remove from history">
                <Icon name="close" size={16} />
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {:else if history.length}
      <p class="none">Nothing in history matches “{query}”.</p>
    {:else}
      <p class="none">Nothing played yet.</p>
    {/if}
  </section>
</div>

<style>
  .search {
    position: relative;
    width: min(320px, 100%);
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

  .block {
    margin-bottom: 44px;
  }

  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 34px;
    margin-bottom: 4px;
  }

  .n {
    color: var(--faint);
    font-weight: 500;
    margin-left: 6px;
  }

  .row-main {
    min-width: 0;
    display: block;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .row-main .row-title,
  .row-main .row-meta {
    display: flex;
  }

  .row-main .row-title {
    display: block;
  }

  .row-main:hover .row-title {
    color: var(--accent-text);
  }

  .when {
    color: var(--faint);
    font-size: 12.5px;
    margin-right: 10px;
    white-space: nowrap;
  }

  .none {
    padding: 18px 12px;
    color: var(--muted);
    border-top: 1px solid var(--line);
  }

  .empty-action {
    margin-top: 16px;
  }

  .empty-action .btn {
    text-decoration: none;
  }

  @media (max-width: 720px) {
    .when {
      display: none;
    }
  }
</style>
