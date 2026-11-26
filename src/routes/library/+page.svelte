<script>
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { createId, formatWhen, hostOf } from "$lib";
  import { STORAGE_KEYS, loadList, saveList, formatLabel, normalizeStream } from "$lib/stream.js";
  import { openPlayer, player } from "$lib/player/player.svelte.js";
  import { workspace } from "$lib/workspace.svelte.js";
  import { showToast } from "$lib/toast.svelte.js";
  import { viewport } from "$lib/viewport.svelte.js";
  import Sheet from "$lib/components/mobile/Sheet.svelte";

  let saved = $state([]);
  let history = $state([]);
  let query = $state("");
  // Phone: one list at a time, and a sheet of actions for the tapped row.
  let tab = $state("profiles");
  /** @type {{ kind: "profile" | "history", item: any } | null} */
  let actions = $state(null);
  const actionTitle = $derived(
    actions ? (actions.kind === "profile" ? actions.item.name : actions.item.title || hostOf(actions.item.stream.streamUrl)) : ""
  );

  function act(fn) {
    const item = actions?.item;
    actions = null;
    if (item) fn(item);
  }

  function playFromSheet() {
    const a = actions;
    actions = null;
    if (a) openPlayer(a.item.stream, { title: a.kind === "profile" ? a.item.name : a.item.title });
  }

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

  onMount(() => {
    refresh();
    if (!saved.length && history.length) tab = "history";
  });

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

{#if viewport.phone}
<div class="m-screen">
  <h1 class="m-title lib-title">Library</h1>

  <div class="m-seg" role="group" aria-label="Show">
    <button aria-pressed={tab === "profiles"} onclick={() => (tab = "profiles")}>Profiles <span class="count num">{saved.length}</span></button>
    <button aria-pressed={tab === "history"} onclick={() => (tab = "history")}>History <span class="count num">{history.length}</span></button>
  </div>

  {#if saved.length + history.length > 4}
    <div class="m-search">
      <Icon name="search" size={18} />
      <label for="libraryQueryM" class="visually-hidden">Filter library</label>
      <input id="libraryQueryM" bind:value={query} placeholder="Search by name or link" enterkeyhint="search" />
    </div>
  {/if}

  {#if tab === "profiles"}
    {#if filteredSaved.length}
      <div class="m-group list">
        {#each filteredSaved as item (item.id)}
          <div class="m-row">
            <span class="m-tile" aria-hidden="true"><Icon name="bookmark" size={19} /></span>
            <button class="row-hit" onclick={() => openPlayer(item.stream, { title: item.name })}>
              <span class="m-row-text">
                <span class="m-row-title">{item.name}</span>
                <span class="m-row-meta">
                  <span class="tag">{formatLabel(item.stream)}</span>
                  {#if item.stream.drmScheme !== "none"}<span class="tag drm">DRM</span>{/if}
                  <span class="m-sub">{hostOf(item.stream.streamUrl)}</span>
                </span>
              </span>
            </button>
            <button class="m-icon-btn" onclick={() => (actions = { kind: "profile", item })} aria-label="More for {item.name}">
              <Icon name="more" size={20} />
            </button>
          </div>
        {/each}
      </div>
    {:else if saved.length}
      <p class="m-none">No profiles match “{query}”.</p>
    {:else}
      <div class="m-empty list">
        <strong>No profiles yet</strong>
        On Watch, open Options under the link bar and save a stream with its headers and keys.
      </div>
    {/if}
  {:else}
    {#if filteredHistory.length}
      <div class="m-group list">
        {#each filteredHistory as item (item.id)}
          <div class="m-row">
            <span class="m-tile" aria-hidden="true"><Icon name="clock" size={19} /></span>
            <button class="row-hit" onclick={() => openPlayer(item.stream, { title: item.title })}>
              <span class="m-row-text">
                <span class="m-row-title">{item.title || hostOf(item.stream.streamUrl)}</span>
                <span class="m-row-meta">
                  <span class="tag">{formatLabel(item.stream)}</span>
                  {#if item.stream.drmScheme !== "none"}<span class="tag drm">DRM</span>{/if}
                  <span class="m-sub">{formatWhen(item.lastPlayed)}</span>
                </span>
              </span>
            </button>
            <button class="m-icon-btn" onclick={() => (actions = { kind: "history", item })} aria-label="More for {item.title || hostOf(item.stream.streamUrl)}">
              <Icon name="more" size={20} />
            </button>
          </div>
        {/each}
      </div>
      <button class="m-btn danger clear-all" onclick={clearHistory}>Clear history</button>
    {:else if history.length}
      <p class="m-none">Nothing in history matches “{query}”.</p>
    {:else}
      <div class="m-empty list">
        <strong>Nothing played yet</strong>
        Streams you play show up here so you can get back to them.
      </div>
    {/if}
  {/if}
</div>

<Sheet open={!!actions} title={actionTitle} onclose={() => (actions = null)}>
  {#if actions}
    <p class="sheet-url">{actions.item.stream.streamUrl}</p>
    <button class="m-btn primary" onclick={playFromSheet}><Icon name="play" size={18} /> Play</button>
    {#if actions.kind === "profile"}
      <button class="m-btn" onclick={() => act(edit)}><Icon name="edit" size={17} /> Edit</button>
      <button class="m-btn danger" onclick={() => act(remove)}><Icon name="trash" size={17} /> Delete profile</button>
    {:else}
      <button class="m-btn" onclick={() => act(editHistory)}><Icon name="edit" size={17} /> Put in the link bar</button>
      <button class="m-btn" onclick={() => act(keep)}><Icon name="bookmark" size={17} /> Save as profile</button>
      <button class="m-btn danger" onclick={() => act(forget)}><Icon name="close" size={17} /> Remove from history</button>
    {/if}
  {/if}
</Sheet>
{:else}
<div class="page">
  <div class="page-head">
    <div>
      <h1 class="display">Library</h1>
      <p class="lede">Profiles you saved and everything you played recently, kept on this device.</p>
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
{/if}

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

  /* ---------- Phone ---------- */
  .lib-title {
    margin-top: 22px;
  }

  .count {
    margin-left: 6px;
    opacity: 0.6;
    font-size: 12.5px;
  }

  .m-search {
    position: relative;
    margin-top: 12px;
    color: var(--m-muted);
  }

  .m-search :global(svg) {
    position: absolute;
    left: 16px;
    top: 15px;
  }

  .m-search input {
    width: 100%;
    height: 48px;
    padding: 0 16px 0 46px;
    border-radius: 999px;
    border: 1px solid var(--m-line);
    background: var(--m-raised);
    color: var(--m-ink);
    font-size: 16px;
    outline: none;
  }

  .m-search input:focus {
    border-color: var(--accent);
  }

  .list {
    margin-top: 16px;
  }

  .row-hit {
    min-width: 0;
    align-self: stretch;
    display: flex;
    align-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
  }

  .m-none {
    margin: 20px 4px;
    color: var(--m-muted);
  }

  .clear-all {
    margin-top: 20px;
  }

  .sheet-url {
    margin: 0 0 18px;
    color: var(--m-muted);
    font-size: 13px;
    word-break: break-all;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
