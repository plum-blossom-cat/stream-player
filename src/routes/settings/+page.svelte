<script>
  import { settings, updateSettings } from "$lib/settings.svelte.js";
  import { STORAGE_KEYS, saveList } from "$lib/stream.js";
  import { showToast } from "$lib/toast.svelte.js";
  import { clearAudioPreference } from "$lib/player/audio.js";

  const themes = [
    { value: "system", label: "Match system" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];

  const shortcuts = [
    ["Space or K", "Play or pause"],
    ["F or double-click", "Enter or leave fullscreen"],
    ["Esc", "Leave fullscreen, then close the player"],
    ["← →", "Back or forward 10 seconds"],
    ["↑ ↓", "Volume up or down"],
    ["M", "Mute"],
    ["A", "Next audio track"],
    ["C", "Subtitles on or off"],
    ["N or Page Down", "Next channel"],
    ["P or Page Up", "Previous channel"],
    ["I", "Stream stats"],
  ];

  function clearHistory() {
    saveList(STORAGE_KEYS.history, []);
    showToast("History cleared.");
  }
</script>

<div class="page narrow">
  <div class="page-head">
    <div>
      <h1 class="display">Settings</h1>
      <p class="lede">Changes apply right away and are stored on this computer.</p>
    </div>
  </div>

  <section class="block" aria-labelledby="appearance">
    <h2 id="appearance" class="section-title">Appearance</h2>
    <div class="setting">
      <div>
        <p class="label">Theme</p>
        <p class="note">The player itself always stays dark.</p>
      </div>
      <div class="segmented" role="group" aria-label="Theme">
        {#each themes as theme}
          <button aria-pressed={settings.theme === theme.value} onclick={() => updateSettings({ theme: theme.value })}>
            {theme.label}
          </button>
        {/each}
      </div>
    </div>
  </section>

  <section class="block" aria-labelledby="playback">
    <h2 id="playback" class="section-title">Playback</h2>

    <label class="setting">
      <div>
        <p class="label">Start muted</p>
        <p class="note">Streams begin without sound. Press M to unmute.</p>
      </div>
      <input type="checkbox" class="switch" checked={settings.playMuted} onchange={(e) => updateSettings({ playMuted: e.currentTarget.checked })} />
    </label>

    <label class="setting">
      <div>
        <p class="label">Remember volume</p>
        <p class="note">Use the last volume level for the next stream.</p>
      </div>
      <input type="checkbox" class="switch" checked={settings.rememberVolume} onchange={(e) => updateSettings({ rememberVolume: e.currentTarget.checked })} />
    </label>

    <label class="setting">
      <div>
        <p class="label">Remember audio track</p>
        <p class="note">When a stream has several audio tracks, start with the language you picked last.</p>
      </div>
      <input
        type="checkbox"
        class="switch"
        checked={settings.rememberAudio}
        onchange={(e) => {
          updateSettings({ rememberAudio: e.currentTarget.checked });
          if (!e.currentTarget.checked) clearAudioPreference();
        }}
      />
    </label>

    <label class="setting">
      <div>
        <p class="label">Hide controls while watching</p>
        <p class="note">Controls and the cursor fade out after a few seconds without movement.</p>
      </div>
      <input type="checkbox" class="switch" checked={settings.autoHideControls} onchange={(e) => updateSettings({ autoHideControls: e.currentTarget.checked })} />
    </label>
  </section>

  <section class="block" aria-labelledby="keys">
    <h2 id="keys" class="section-title">Keyboard shortcuts in the player</h2>
    <dl class="keys">
      {#each shortcuts as [key, action]}
        <dt><kbd>{key}</kbd></dt>
        <dd>{action}</dd>
      {/each}
    </dl>
  </section>

  <section class="block" aria-labelledby="data">
    <h2 id="data" class="section-title">Data</h2>
    <div class="setting">
      <div>
        <p class="label">Playback history</p>
        <p class="note">Saved profiles and playlists aren't affected.</p>
      </div>
      <button class="btn danger" onclick={clearHistory}>Clear history</button>
    </div>
  </section>
</div>

<style>
  .narrow {
    max-width: 760px;
  }

  .block {
    margin-bottom: 40px;
  }

  .block > .section-title {
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line);
  }

  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 16px 0;
    border-bottom: 1px solid var(--line);
    cursor: default;
  }

  label.setting {
    cursor: pointer;
  }

  .label {
    font-weight: 560;
  }

  .note {
    margin-top: 2px;
    color: var(--muted);
    font-size: 13px;
  }

  .switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 40px;
    height: 22px;
    margin: 0;
    border-radius: var(--r-md);
    background: var(--line-strong);
    cursor: pointer;
    transition: background-color 160ms ease;
  }

  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 160ms var(--ease-out);
  }

  .switch:checked {
    background: var(--accent);
  }

  .switch:checked::after {
    transform: translateX(18px);
    background: var(--accent-ink);
  }

  .keys {
    display: grid;
    grid-template-columns: max-content 1fr;
    margin: 0;
  }

  .keys dt,
  .keys dd {
    margin: 0;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }

  .keys dt {
    padding-right: 32px;
  }

  .keys dd {
    color: var(--muted);
  }

  kbd {
    font-family: inherit;
    font-size: 12.5px;
    font-weight: 600;
    font-variation-settings: "wdth" 92;
    padding: 2px 7px;
    border-radius: var(--r-xs);
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    background: var(--surface);
    white-space: nowrap;
  }
</style>
