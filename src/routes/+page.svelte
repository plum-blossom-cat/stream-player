<script>
  import { onMount, tick } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { createId, formatWhen, hostOf, isAndroid, isTv } from "$lib";
  import {
    DEFAULT_STREAM,
    STREAM_TYPES,
    DRM_SCHEMES,
    STORAGE_KEYS,
    normalizeStream,
    cleanUrl,
    validateUrl,
    validateShakaConfig,
    parsePastedStream,
    formatLabel,
    loadList,
    saveList,
  } from "$lib/stream.js";
  import { openPlayer, player } from "$lib/player/player.svelte.js";
  import { workspace } from "$lib/workspace.svelte.js";
  import { viewport } from "$lib/viewport.svelte.js";
  import Sheet from "$lib/components/mobile/Sheet.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import { showToast } from "$lib/toast.svelte.js";

  let form = $state({ ...DEFAULT_STREAM });
  let errors = $state({ streamUrl: null, shakaConfig: null });
  let touched = $state(false);

  let profileName = $state("");
  /** Set when editing an existing profile from the library. */
  let editing = $state(/** @type {{ id: string, name: string } | null} */ (null));

  let history = $state([]);
  let saved = $state([]);

  const drmLabel = $derived(DRM_SCHEMES.find((d) => d.value === form.drmScheme)?.text ?? "None");

  // Phone: headers, DRM and config live in a bottom sheet behind "Options".
  let optionsOpen = $state(false);
  const optionCount = $derived(headerCount + (form.drmScheme !== "none" ? 1 : 0) + (form.shakaConfig.trim() ? 1 : 0));
  const formatChip = $derived(
    form.streamType === "auto"
      ? detected ? `Auto, ${detected}` : "Auto format"
      : STREAM_TYPES.find((t) => t.value === form.streamType)?.text ?? "Auto"
  );
  const continueItem = $derived(history[0]);

  function cycleFormat() {
    const i = STREAM_TYPES.findIndex((t) => t.value === form.streamType);
    form.streamType = STREAM_TYPES[(i + 1) % STREAM_TYPES.length].value;
  }
  let urlInput = $state();

  const headerCount = $derived(
    [form.origin, form.referer, form.userAgent, form.cookie].filter((v) => v.trim()).length +
      form.requestHeaders.split("\n").filter((l) => l.includes(":")).length
  );
  const detected = $derived(form.streamUrl.trim() ? formatLabel(form) : "");
  const needsServer = $derived(!["none", "clearkey_inline"].includes(form.drmScheme));

  function refreshLists() {
    history = loadList(STORAGE_KEYS.history);
    saved = loadList(STORAGE_KEYS.saved);
  }

  onMount(() => {
    refreshLists();
    // On Android this would pop up the keyboard as soon as the app opens.
    if (!isAndroid && !viewport.phone) urlInput?.focus();
  });

  // Refresh "Recent" after the player closes.
  $effect(() => {
    if (!player.open) refreshLists();
  });

  // Accept streams handed over by "Edit stream" or "Edit profile".
  $effect(() => {
    const draft = workspace.draft;
    if (!draft) return;
    form = { ...normalizeStream(draft.stream) };
    editing = draft.profileId ? { id: draft.profileId, name: draft.profileName || "" } : null;
    profileName = draft.profileName || "";
    errors = { streamUrl: null, shakaConfig: validateShakaConfig(form.shakaConfig) };
    workspace.draft = null;
  });

  function validate() {
    errors.streamUrl = validateUrl(form.streamUrl);
    errors.shakaConfig = validateShakaConfig(form.shakaConfig);
    return !errors.streamUrl && !errors.shakaConfig;
  }

  function onUrlInput() {
    if (touched || errors.streamUrl) errors.streamUrl = validateUrl(form.streamUrl);
  }

  /** @param {ClipboardEvent} event */
  function onUrlPaste(event) {
    const text = event.clipboardData?.getData("text") || "";
    try {
      const result = parsePastedStream(text);
      if (!result) {
        setTimeout(() => {
          form.streamUrl = cleanUrl(form.streamUrl);
          errors.streamUrl = validateUrl(form.streamUrl);
        }, 0);
        return;
      }
      event.preventDefault();
      Object.assign(form, result.fields);
      errors.streamUrl = validateUrl(form.streamUrl);
      showToast(result.message);
    } catch (error) {
      event.preventDefault();
      showToast(error.message, "error");
    }
  }

  async function play(event) {
    event?.preventDefault();
    touched = true;
    form.streamUrl = cleanUrl(form.streamUrl);
    if (!validate()) {
      if (errors.shakaConfig && viewport.phone) optionsOpen = true;
      await tick();
      document.getElementById(errors.streamUrl ? "streamUrl" : "shakaConfig")?.focus();
      return;
    }
    openPlayer($state.snapshot(form), { title: editing?.name || profileName.trim() || "" });
  }

  function clearForm() {
    form = { ...DEFAULT_STREAM };
    errors = { streamUrl: null, shakaConfig: null };
    touched = false;
    editing = null;
    profileName = "";
    urlInput?.focus();
  }

  function saveProfile(asNew = false) {
    const name = profileName.trim();
    if (!name) {
      showToast("Give the profile a name first.", "error");
      document.getElementById("profileName")?.focus();
      return;
    }
    if (!validate()) {
      showToast(errors.streamUrl || errors.shakaConfig, "error");
      return;
    }
    const now = new Date().toISOString();
    const list = loadList(STORAGE_KEYS.saved);
    const stream = normalizeStream($state.snapshot(form));

    if (editing && !asNew) {
      const index = list.findIndex((item) => item.id === editing.id);
      if (index !== -1) {
        list[index] = { ...list[index], name, stream, updatedAt: now };
        saveList(STORAGE_KEYS.saved, list);
        editing = { id: editing.id, name };
        refreshLists();
        showToast(`Updated “${name}”.`);
        return;
      }
    }

    const id = createId();
    saveList(STORAGE_KEYS.saved, [{ id, name, createdAt: now, updatedAt: now, stream }, ...list]);
    editing = { id, name };
    refreshLists();
    showToast(`Saved “${name}” to your library.`);
  }

  function loadIntoForm(item) {
    form = { ...normalizeStream(item.stream) };
    errors = { streamUrl: null, shakaConfig: null };
    editing = item.name && item.createdAt ? { id: item.id, name: item.name } : null;
    profileName = editing?.name || "";
    urlInput?.focus();
  }

  function setType(value) {
    form.streamType = value;
  }

  function onSchemeChange() {
    if (form.drmScheme === "clearkey_inline") tick().then(() => document.getElementById("clearKey")?.focus());
  }
</script>

{#if viewport.phone}
<div class="m-screen watch">
  <header class="m-appbar">
    <Logo size={28} />
    <span class="m-brand">Stream Player</span>
  </header>

  <h1 class="m-title">{editing ? editing.name : "Watch"}</h1>

  {#if continueItem}
    <button class="hero" onclick={() => openPlayer(continueItem.stream, { title: continueItem.title })}>
      <span class="hero-screen">
        <span class="hero-tags">
          <span class="hero-tag">{formatLabel(continueItem.stream)}</span>
          {#if continueItem.stream.drmScheme !== "none"}<span class="hero-tag drm">DRM</span>{/if}
        </span>
        <span class="hero-name">{continueItem.title || hostOf(continueItem.stream.streamUrl)}</span>
        <span class="hero-play" aria-hidden="true"><Icon name="play" size={26} /></span>
      </span>
      <span class="hero-caption">
        <span>Continue watching</span>
        <span class="num">{formatWhen(continueItem.lastPlayed)}</span>
      </span>
    </button>
  {:else}
    <div class="m-empty">
      <strong>Nothing played yet</strong>
      Paste an HLS or DASH link in the bar below. cURL commands and links with headers work too.
    </div>
  {/if}

  {#if history.length > 1}
    <h2 class="m-h2">Recent <a href="/library">Library</a></h2>
    <div class="m-group">
      {#each history.slice(1, 6) as item (item.id)}
        <div class="m-row">
          <span class="m-tile" aria-hidden="true"><Icon name={formatLabel(item.stream) === "DASH" ? "dash" : "hls"} size={20} /></span>
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
          <button class="m-icon-btn" onclick={() => loadIntoForm(item)} aria-label="Put {item.title || hostOf(item.stream.streamUrl)} in the link bar">
            <Icon name="edit" size={18} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if saved.length}
    <h2 class="m-h2">Profiles <a href="/library">All {saved.length}</a></h2>
    <div class="m-group">
      {#each saved.slice(0, 4) as item (item.id)}
        <div class="m-row">
          <span class="m-tile" aria-hidden="true"><Icon name="bookmark" size={19} /></span>
          <button class="row-hit" onclick={() => openPlayer(item.stream, { title: item.name })}>
            <span class="m-row-text">
              <span class="m-row-title">{item.name}</span>
              <span class="m-row-meta"><span class="m-sub">{hostOf(item.stream.streamUrl)}</span></span>
            </span>
          </button>
          <button class="m-icon-btn" onclick={() => loadIntoForm(item)} aria-label="Edit {item.name}">
            <Icon name="edit" size={18} />
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- The link bar: docked above the tabs, rides up with the keyboard. -->
<form class="dock" class:typing={viewport.typing} onsubmit={play} novalidate>
  <div class="dock-row">
    <div class="link" class:invalid={!!errors.streamUrl}>
      <label for="streamUrl" class="visually-hidden">Stream link</label>
      <input
        id="streamUrl"
        bind:this={urlInput}
        bind:value={form.streamUrl}
        oninput={onUrlInput}
        onpaste={onUrlPaste}
        type="text"
        inputmode="url"
        enterkeyhint="go"
        autocomplete="off"
        spellcheck="false"
        placeholder="Paste a stream link"
        aria-invalid={!!errors.streamUrl}
      />
      {#if form.streamUrl}
        <button type="button" class="clear" onclick={() => { form.streamUrl = ""; errors.streamUrl = null; }} aria-label="Clear link">
          <Icon name="close" size={16} />
        </button>
      {/if}
    </div>
    <button type="submit" class="go" aria-label="Play">
      <Icon name="play" size={24} />
    </button>
  </div>
  {#if errors.streamUrl}<p class="dock-error">{errors.streamUrl}</p>{/if}
  <div class="dock-chips">
    <button type="button" class="m-chip" onclick={cycleFormat} aria-label="Stream format: {formatChip}. Tap to change.">{formatChip}</button>
    <button type="button" class="m-chip" onclick={() => (optionsOpen = true)}>
      <Icon name="sliders" size={15} />
      Options
      {#if optionCount}<span class="m-badge">{optionCount}</span>{/if}
    </button>
  </div>
</form>

<Sheet open={optionsOpen} title="Stream options" onclose={() => (optionsOpen = false)}>
  <section class="m-sheet-section">
    <h3>Request headers</h3>
    <div class="m-field"><label for="referer">Referer</label><input id="referer" class="m-input" bind:value={form.referer} placeholder="Defaults to the stream's site" spellcheck="false" /></div>
    <div class="m-field"><label for="origin">Origin</label><input id="origin" class="m-input" bind:value={form.origin} placeholder="Defaults to the stream's site" spellcheck="false" /></div>
    <div class="m-field"><label for="userAgent">User-Agent</label><input id="userAgent" class="m-input" bind:value={form.userAgent} placeholder="Defaults to an Android client" spellcheck="false" /></div>
    <div class="m-field"><label for="cookie">Cookie</label><input id="cookie" class="m-input" bind:value={form.cookie} placeholder="name=value; other=value" spellcheck="false" /></div>
    <div class="m-field"><label for="requestHeaders">Other headers</label><textarea id="requestHeaders" class="m-input" rows="3" bind:value={form.requestHeaders} placeholder="One per line, e.g. X-Token: abc123" spellcheck="false"></textarea></div>
  </section>

  <section class="m-sheet-section">
    <h3>Content protection</h3>
    <div class="m-field">
      <label for="drmScheme">DRM scheme</label>
      <select id="drmScheme" class="m-input" bind:value={form.drmScheme} onchange={onSchemeChange}>
        {#each DRM_SCHEMES as scheme}<option value={scheme.value}>{scheme.text}</option>{/each}
      </select>
    </div>
    {#if form.drmScheme === "clearkey_inline"}
      <div class="m-field"><label for="clearKey">Keys</label><input id="clearKey" class="m-input" bind:value={form.clearKey} placeholder="kid:key, separate several with commas" spellcheck="false" /></div>
    {/if}
    {#if needsServer}
      <div class="m-field"><label for="licenseUrl">License server URL</label><input id="licenseUrl" class="m-input" bind:value={form.licenseUrl} placeholder="https://license.example.com/" spellcheck="false" /></div>
      <div class="m-field"><label for="certificateUrl">Certificate URL (optional)</label><input id="certificateUrl" class="m-input" bind:value={form.certificateUrl} spellcheck="false" /></div>
      <div class="m-field"><label for="licenseHeaders">License headers</label><textarea id="licenseHeaders" class="m-input" rows="3" bind:value={form.licenseHeaders} placeholder="Authorization: Bearer …" spellcheck="false"></textarea></div>
      <div class="m-field"><label for="certificateHeaders">Certificate headers</label><textarea id="certificateHeaders" class="m-input" rows="3" bind:value={form.certificateHeaders} spellcheck="false"></textarea></div>
    {/if}
  </section>

  <section class="m-sheet-section">
    <h3>Player config</h3>
    <div class="m-field">
      <label for="shakaConfig">Shaka Player overrides in JSON5</label>
      <textarea id="shakaConfig" class="m-input" rows="4" bind:value={form.shakaConfig} oninput={() => (errors.shakaConfig = validateShakaConfig(form.shakaConfig))} placeholder={'{ streaming: { bufferingGoal: 60 } }'} spellcheck="false"></textarea>
      {#if errors.shakaConfig}<p class="error-text">{errors.shakaConfig}</p>{/if}
    </div>
  </section>

  <section class="m-sheet-section">
    <h3>{editing ? "Profile" : "Save as profile"}</h3>
    <div class="m-field">
      <label for="profileName">Name</label>
      <input id="profileName" class="m-input" bind:value={profileName} placeholder="e.g. Sports HD" enterkeyhint="done" />
    </div>
    <button class="m-btn" type="button" onclick={() => saveProfile()}>
      <Icon name="bookmark" size={17} />
      {editing ? "Update profile" : "Save profile"}
    </button>
    {#if editing}<button class="m-btn" type="button" onclick={() => saveProfile(true)}>Save as new profile</button>{/if}
    <button class="m-btn" type="button" onclick={() => { clearForm(); optionsOpen = false; }}>Start over</button>
  </section>

  <button class="m-btn primary done" type="button" onclick={() => (optionsOpen = false)}>Done</button>
</Sheet>
{:else}
<div class="page">
  <form class="tuner-block" onsubmit={play} novalidate>
    <div class="intro">
      <h1 class="display">{editing ? editing.name : "Open a stream"}</h1>
      {#if editing}
        <p class="lede">Editing a saved profile. Play it as is, or change anything below and update it.</p>
      {:else}
        <p class="lede">Paste an HLS or DASH address. A cURL command or a <span class="nowrap">url|referer=…</span> link fills in the headers too.</p>
      {/if}
    </div>

    <div class="tuner" class:invalid={!!errors.streamUrl}>
      <label for="streamUrl" class="visually-hidden">Stream URL</label>
      <input
        id="streamUrl"
        bind:this={urlInput}
        bind:value={form.streamUrl}
        oninput={onUrlInput}
        onpaste={onUrlPaste}
        type="text"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        placeholder="https://example.com/live/index.m3u8"
        aria-invalid={!!errors.streamUrl}
        aria-describedby="streamUrl-help"
      />
      <div class="tuner-format">
        <div class="segmented" role="group" aria-label="Stream format">
          {#each STREAM_TYPES as type}
            <button type="button" aria-pressed={form.streamType === type.value} onclick={() => setType(type.value)}>
              {type.value === "auto" && detected && form.streamType === "auto" ? `Auto, ${detected}` : type.text}
            </button>
          {/each}
        </div>
      </div>
      <button type="submit" class="play">
        <Icon name="play" size={16} />
        Play
        {#if !isAndroid}<span class="kbd-hint">Enter</span>{/if}
      </button>
    </div>
    <p id="streamUrl-help" class="tuner-help" class:error-text={!!errors.streamUrl}>
      {#if errors.streamUrl}
        {errors.streamUrl}
      {:else}
        {#if isTv}
          Press OK on the field to type. In the player, OK pauses, left and right seek, Back closes.
        {:else if isAndroid}
          In the player, tap to show the controls and double-tap for fullscreen.
        {:else}
          In the player, F toggles fullscreen and Esc closes it.
        {/if}
      {/if}
    </p>
  </form>

  <div class="layout">
    <div class="config">
      <!-- Headers -->
      <section class="group" aria-labelledby="headers-title">
        <div class="group-head">
          <h2 id="headers-title" class="section-title"><i class="mark" class:on={headerCount > 0} aria-hidden="true"></i>Request headers</h2>
          <p class="section-note">
            Sent with every manifest and segment request.
            {#if headerCount}<span class="count">{headerCount} set</span>{/if}
          </p>
        </div>
        <div class="grid two">
          <div class="field">
            <label for="referer">Referer</label>
            <input id="referer" class="input" bind:value={form.referer} placeholder="Defaults to the stream's site" spellcheck="false" />
          </div>
          <div class="field">
            <label for="origin">Origin</label>
            <input id="origin" class="input" bind:value={form.origin} placeholder="Defaults to the stream's site" spellcheck="false" />
          </div>
          <div class="field">
            <label for="userAgent">User-Agent</label>
            <input id="userAgent" class="input" bind:value={form.userAgent} placeholder="Defaults to an Android client" spellcheck="false" />
          </div>
          <div class="field">
            <label for="cookie">Cookie</label>
            <input id="cookie" class="input" bind:value={form.cookie} placeholder="name=value; other=value" spellcheck="false" />
          </div>
          <div class="field span">
            <label for="requestHeaders">Other headers</label>
            <textarea id="requestHeaders" class="input" rows="3" bind:value={form.requestHeaders} placeholder="One per line, e.g. X-Token: abc123" spellcheck="false"></textarea>
          </div>
        </div>
      </section>

      <!-- DRM -->
      <section class="group" aria-labelledby="drm-title">
        <div class="group-head">
          <h2 id="drm-title" class="section-title"><i class="mark" class:on={form.drmScheme !== "none"} aria-hidden="true"></i>Content protection</h2>
          <p class="section-note">
            Only needed for encrypted streams.
          </p>
        </div>
        <div class="grid two">
          <div class="field">
            <label for="drmScheme">DRM scheme</label>
            <select id="drmScheme" class="input" bind:value={form.drmScheme} onchange={onSchemeChange}>
              {#each DRM_SCHEMES as scheme}
                <option value={scheme.value}>{scheme.text}</option>
              {/each}
            </select>
          </div>

          {#if form.drmScheme === "clearkey_inline"}
            <div class="field">
              <label for="clearKey">Keys</label>
              <input id="clearKey" class="input mono" bind:value={form.clearKey} placeholder="kid:key, separate several with commas" spellcheck="false" />
            </div>
          {/if}

          {#if needsServer}
            <div class="field">
              <label for="licenseUrl">License server URL</label>
              <input id="licenseUrl" class="input" bind:value={form.licenseUrl} placeholder="https://license.example.com/" spellcheck="false" />
            </div>
            <div class="field">
              <label for="certificateUrl">Certificate URL <span class="optional">optional</span></label>
              <input id="certificateUrl" class="input" bind:value={form.certificateUrl} spellcheck="false" />
            </div>
            <div class="field">
              <label for="licenseHeaders">License headers</label>
              <textarea id="licenseHeaders" class="input" rows="3" bind:value={form.licenseHeaders} placeholder="Authorization: Bearer …" spellcheck="false"></textarea>
            </div>
            <div class="field">
              <label for="certificateHeaders">Certificate headers</label>
              <textarea id="certificateHeaders" class="input" rows="3" bind:value={form.certificateHeaders} spellcheck="false"></textarea>
            </div>
          {/if}
        </div>
      </section>

      <!-- Advanced -->
      <details class="group advanced" open={!!form.shakaConfig.trim()}>
        <summary>
          <span class="section-title"><i class="mark" class:on={!!form.shakaConfig.trim()} aria-hidden="true"></i>Player config</span>
          <span class="section-note">
            Shaka Player overrides in JSON5. Applied after the defaults.
          </span>
          <Icon name="chevron-down" size={18} class="chev" />
        </summary>
        <div class="field">
          <label for="shakaConfig" class="visually-hidden">Shaka Player config</label>
          <textarea
            id="shakaConfig"
            class="input"
            class:invalid={!!errors.shakaConfig}
            rows="5"
            bind:value={form.shakaConfig}
            oninput={() => (errors.shakaConfig = validateShakaConfig(form.shakaConfig))}
            placeholder={'{ streaming: { bufferingGoal: 60 } }'}
            spellcheck="false"
          ></textarea>
          {#if errors.shakaConfig}<p class="error-text">{errors.shakaConfig}</p>{/if}
        </div>
      </details>
    </div>

    <aside class="side">
      <section class="save" aria-labelledby="save-title">
        <div class="save-head">
          <h2 id="save-title" class="section-title">{editing ? "Profile" : "Save as profile"}</h2>
          <p class="section-note">Keeps the URL, headers and keys together in your library.</p>
        </div>
        <div class="save-row">
          <label for="profileName" class="visually-hidden">Profile name</label>
          <input
            id="profileName"
            class="input"
            bind:value={profileName}
            placeholder="Name, e.g. Sports HD"
            onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), saveProfile())}
          />
          <button class="btn" type="button" onclick={() => saveProfile()}>{editing ? "Update" : "Save"}</button>
        </div>
        <div class="side-actions">
          {#if editing}
            <button class="btn quiet sm" type="button" onclick={() => saveProfile(true)}>Save as new profile</button>
          {/if}
          <button class="btn quiet sm" type="button" onclick={clearForm}>Start over</button>
        </div>
      </section>

      <section aria-labelledby="recent-title">
        <div class="side-head">
          <h2 id="recent-title" class="section-title">Recent</h2>
          {#if history.length}<a href="/library" class="link">Library</a>{/if}
        </div>
        {#if history.length}
          <ul class="recent">
            {#each history.slice(0, 7) as item (item.id)}
              <li>
                <button class="recent-load" onclick={() => loadIntoForm(item)} title="Load into the form">
                  <span class="recent-title">{item.title || hostOf(item.stream.streamUrl)}</span>
                  <span class="recent-meta">
                    <span class="tag">{formatLabel(item.stream)}</span>
                    {#if item.stream.drmScheme !== "none"}<span class="tag drm">DRM</span>{/if}
                    <span class="when">{formatWhen(item.lastPlayed)}</span>
                  </span>
                </button>
                <button class="btn sm icon go" onclick={() => openPlayer(item.stream, { title: item.title })} aria-label="Play {item.title || hostOf(item.stream.streamUrl)}">
                  <Icon name="play" size={14} />
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="side-empty">Streams you play show up here so you can get back to them quickly.</p>
        {/if}
      </section>

      {#if saved.length}
        <section aria-labelledby="saved-title">
          <div class="side-head">
            <h2 id="saved-title" class="section-title">Profiles</h2>
            <a href="/library" class="link">All {saved.length}</a>
          </div>
          <ul class="recent">
            {#each saved.slice(0, 4) as item (item.id)}
              <li>
                <button class="recent-load" onclick={() => loadIntoForm(item)} title="Edit this profile">
                  <span class="recent-title">{item.name}</span>
                  <span class="recent-meta"><span>{hostOf(item.stream.streamUrl)}</span></span>
                </button>
                <button class="btn sm icon go" onclick={() => openPlayer(item.stream, { title: item.name })} aria-label="Play {item.name}">
                  <Icon name="play" size={14} />
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </aside>
  </div>
</div>
{/if}

<style>
  .tuner-block {
    margin-bottom: 40px;
  }

  .intro {
    margin-bottom: 22px;
  }

  .nowrap {
    white-space: nowrap;
    font-variation-settings: "wdth" 88;
    color: var(--ink);
  }

  /* The URL field is the centrepiece: wide set type in one long bar,
     with the format switch and Play attached to its right end. */
  .tuner {
    display: flex;
    align-items: stretch;
    overflow: hidden;
    border-radius: var(--r-lg);
    background: var(--sunken);
    border: 1px solid var(--line-strong);
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }

  .tuner:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  .tuner.invalid {
    border-color: var(--red);
  }

  .tuner input {
    flex: 1;
    min-width: 0;
    height: 58px;
    padding: 0 20px;
    border: 0;
    background: transparent;
    font-size: clamp(17px, 1.8vw, 20px);
    font-weight: 500;
    font-variation-settings: "wdth" 112;
    letter-spacing: -0.005em;
    color: var(--ink);
    outline: none;
  }

  .tuner input::placeholder {
    color: var(--faint);
  }

  .tuner-format {
    display: flex;
    align-items: center;
    padding: 0 8px;
    border-left: 1px solid var(--line);
  }

  .play {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 24px;
    border: 0;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 15px;
    font-weight: 700;
    transition: background-color 120ms ease;
  }

  .play:hover {
    background: var(--accent-hover);
  }

  .play:active {
    background: var(--accent-press);
  }

  .play:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: -4px;
  }

  .tuner-help {
    margin-top: 10px;
    font-size: 13px;
    color: var(--faint);
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 48px;
    align-items: start;
  }

  .config {
    display: flex;
    flex-direction: column;
    gap: 36px;
  }

  .group-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding-bottom: 14px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--line);
  }

  .count {
    margin-left: 8px;
    color: var(--accent-text);
    font-weight: 600;
  }

  .grid {
    display: grid;
    gap: 16px 18px;
  }

  .grid.two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .span {
    grid-column: 1 / -1;
  }

  .optional {
    color: var(--faint);
    font-weight: 400;
    margin-left: 4px;
  }

  .mono,
  textarea.input {
    font-variation-settings: "wdth" 88;
  }

  .advanced summary {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    list-style: none;
  }

  .advanced summary::-webkit-details-marker {
    display: none;
  }

  .advanced summary :global(.chev) {
    margin-left: auto;
    align-self: center;
    color: var(--muted);
    transition: transform 160ms var(--ease-out);
  }

  .advanced[open] summary :global(.chev) {
    transform: rotate(180deg);
  }

  .advanced[open] summary {
    margin-bottom: 18px;
  }

  /* ---------- Side column ---------- */
  .side {
    display: flex;
    flex-direction: column;
    gap: 36px;
    position: sticky;
    top: 24px;
  }

  .save {
    border-radius: var(--r-lg);
    background: var(--surface);
    border: 1px solid var(--line);
  }

  .save-head {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
  }

  .save-row {
    display: flex;
    gap: 8px;
    padding: 16px;
  }

  .side-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--line);
  }

  .side-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }

  .link {
    font-size: 13px;
    color: var(--accent-text);
    text-decoration: none;
    font-weight: 560;
  }

  .link:hover {
    text-decoration: underline;
  }

  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .recent li {
    display: flex;
    align-items: center;
    gap: 6px;
    border-bottom: 1px solid var(--line);
  }

  .recent-load {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 4px;
    border: 0;
    background: transparent;
    text-align: left;
    border-radius: var(--r-sm);
  }

  .recent-load:hover .recent-title {
    color: var(--accent-text);
  }

  .recent-title {
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 12.5px;
    min-width: 0;
  }

  .recent-meta > span:first-child:not(.tag) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }


  .recent-meta .when {
    margin-left: auto;
    white-space: nowrap;
    color: var(--faint);
  }

  .side-empty {
    margin-top: 12px;
    color: var(--muted);
    font-size: 13px;
  }

  @media (max-width: 1080px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
    }
    .side {
      position: static;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 28px;
    }
  }

  @media (max-width: 760px) {
    .tuner {
      flex-wrap: wrap;
    }
    .tuner input {
      flex-basis: 100%;
    }
    .tuner-format {
      flex: 1;
      height: 48px;
      border-left: 0;
      border-top: 1px solid var(--line);
    }
    .play {
      border-top: 1px solid var(--accent);
    }
    .grid.two {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* ---------- Phone: Watch screen ---------- */
  .m-screen.watch {
    /* Room for the docked link bar. */
    padding-bottom: 150px;
  }

  .hero {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    -webkit-tap-highlight-color: transparent;
  }

  /* A screen-shaped tile: black glass with faint scan bands echoing the logo's segments. */
  .hero-screen {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 20px;
    border: 1px solid var(--m-line-strong);
    background:
      repeating-linear-gradient(180deg, rgb(255 210 63 / 0.045) 0 10px, transparent 10px 22px),
      radial-gradient(120% 90% at 85% 100%, rgb(255 210 63 / 0.14), transparent 60%),
      #050506;
    overflow: hidden;
  }

  @supports not (aspect-ratio: 16 / 9) {
    .hero-screen {
      height: 0;
      padding-top: 56.25%;
    }
  }

  .hero-tags {
    position: absolute;
    top: 14px;
    left: 16px;
    display: flex;
    gap: 6px;
  }

  .hero-tag {
    height: 22px;
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    border-radius: 6px;
    background: rgb(255 255 255 / 0.1);
    color: #f2f2f3;
    font-size: 11.5px;
    font-weight: 700;
    font-variation-settings: "wdth" 88;
  }

  :global(.no-flex-gap) .hero-tag + .hero-tag {
    margin-left: 6px;
  }

  .hero-tag.drm {
    background: rgb(255 210 63 / 0.18);
    color: #ffd23f;
  }

  .hero-name {
    position: absolute;
    left: 16px;
    right: 92px;
    bottom: 16px;
    color: #f2f2f3;
    font-size: 24px;
    line-height: 1.05;
    font-weight: 720;
    font-variation-settings: "wdth" 120;
    letter-spacing: -0.015em;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .hero-play {
    position: absolute;
    right: 16px;
    bottom: 16px;
    width: 60px;
    height: 60px;
    display: grid;
    place-items: center;
    padding-left: 4px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 8px 24px rgb(255 210 63 / 0.25);
  }

  .hero:active .hero-play {
    transform: scale(0.95);
  }

  .hero-caption {
    display: flex;
    justify-content: space-between;
    margin: 10px 4px 0;
    color: var(--m-muted);
    font-size: 13.5px;
  }

  .row-hit {
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    align-self: stretch;
    display: flex;
    align-items: center;
    -webkit-tap-highlight-color: transparent;
  }

  /* ---------- Phone: docked link bar ---------- */
  .dock {
    position: fixed;
    left: 0;
    right: 0;
    bottom: var(--m-tabbar);
    z-index: 40;
    padding: 10px 12px 10px;
    background: var(--bg);
    border-top: 1px solid var(--m-line);
  }

  .dock.typing {
    bottom: 0;
  }

  .dock-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  :global(.no-flex-gap) .dock-row > * + * {
    margin-left: 10px;
  }

  .link {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    height: 52px;
    padding: 0 6px 0 18px;
    border-radius: 999px;
    background: var(--m-raised);
    border: 1px solid var(--m-line-strong);
  }

  .link:focus-within {
    border-color: var(--accent);
  }

  .link.invalid {
    border-color: var(--red);
  }

  .link input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--m-ink);
    font-size: 16px;
    outline: none;
  }

  .link input::placeholder {
    color: var(--m-muted);
  }

  .clear {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    flex: none;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--m-muted);
  }

  .go {
    width: 56px;
    height: 56px;
    flex: none;
    display: grid;
    place-items: center;
    padding-left: 3px;
    border: 0;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    box-shadow: 0 6px 20px rgb(255 210 63 / 0.22);
  }

  .go:active {
    transform: scale(0.94);
    background: var(--accent-press);
  }

  .dock-error {
    margin: 8px 6px 0;
    color: var(--red-text);
    font-size: 13px;
  }

  .dock-chips {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  :global(.no-flex-gap) .dock-chips > * + * {
    margin-left: 8px;
  }

  .done {
    margin-top: 24px;
  }
</style>
