<script>
  import { onMount, onDestroy, untrack } from "svelte";
  import { fade } from "svelte/transition";
  import { goto } from "$app/navigation";
  import Icon from "$lib/components/Icon.svelte";
  import { player, closePlayer, reloadPlayer, stepQueue } from "$lib/player/player.svelte.js";
  import { enterFullscreen, exitFullscreen, watchFullscreen } from "$lib/player/fullscreen.js";
  import { shaka, installShaka, loadStream, describeError, isInterruption } from "$lib/player/engine.js";
  import { describeAudioTracks, languageLabel, loadAudioPreference, saveAudioPreference } from "$lib/player/audio.js";
  import { formatLabel } from "$lib/stream.js";
  import { hostOf } from "$lib";
  import { settings } from "$lib/settings.svelte.js";
  import { workspace } from "$lib/workspace.svelte.js";
  import { showToast } from "$lib/toast.svelte.js";

  /** @type {HTMLVideoElement} */
  let video;
  /** @type {HTMLDivElement} */
  let stageEl;
  let shakaPlayer = null;
  let ready = $state(false);

  let loading = $state(true);
  let firstLoad = $state(true);
  /** @type {{ title: string, detail: string, code: string } | null} */
  let error = $state(null);

  let paused = $state(true);
  let muted = $state(false);
  let volume = $state(1);
  let rate = $state(1);

  let current = $state(0);
  let rangeStart = $state(0);
  let rangeEnd = $state(0);
  let bufferedEnd = $state(0);
  let isLive = $state(false);
  let scrubbing = $state(false);
  let scrubValue = $state(0);
  /** @type {{ x: number, label: string } | null} */
  let hoverTip = $state(null);

  let idle = $state(false);
  let overControls = false;
  let idleTimer;

  /** @type {null | "root" | "quality" | "audio" | "text" | "speed"} */
  let menu = $state(null);
  let showStats = $state(false);
  let stats = $state({});

  /** @type {{ height: number, bandwidth: number, track: any }[]} */
  let qualities = $state([]);
  let abrOn = $state(true);
  let activeHeight = $state(0);
  let activeWidth = $state(0);
  let activeBandwidth = $state(0);
  let activeDeclaredFps = $state(0);
  let activeKey = $state("");
  /** Frames actually rendered per second, measured from the video element. */
  let measuredFps = $state(0);
  let fpsSample = null;
  /**
   * The rendition actually on screen. The active track is what's being downloaded,
   * which runs ahead of playback by the length of the buffer.
   * @type {{ width: number, height: number, fps: number, bandwidth: number } | null}
   */
  let onScreen = $state(null);
  /** @type {import("$lib/player/audio.js").AudioItem[]} */
  let audioItems = $state([]);
  const activeAudio = $derived(audioItems.find((item) => item.active) || null);
  const hasAudioChoice = $derived(audioItems.length > 1);
  /** @type {any[]} */
  let textTracks = $state([]);
  let activeText = $state(null);
  let textVisible = $state(false);

  let tickTimer;
  let unwatchFullscreen;
  let lastFullscreenChange = 0;
  let clickTimer;
  let notice = $state("");
  let noticeTimer;

  const canSeek = $derived(!isLive || rangeEnd - rangeStart > 30);
  const behindLive = $derived(Math.max(0, rangeEnd - current));
  const atLiveEdge = $derived(behindLive < 12);
  const span = $derived(Math.max(0.001, rangeEnd - rangeStart));
  const shown = $derived(scrubbing ? scrubValue : current);
  const playedPct = $derived(Math.min(100, Math.max(0, ((shown - rangeStart) / span) * 100)));
  const bufferPct = $derived(Math.min(100, Math.max(0, ((bufferedEnd - rangeStart) / span) * 100)));
  const heading = $derived(player.title || (player.stream ? hostOf(player.stream.streamUrl) : ""));
  const hasQueue = $derived(player.queue.length > 1);
  // Streams don't have to declare a frame rate, so fall back to the measured one.
  const shownWidth = $derived(onScreen?.width || activeWidth);
  const shownHeight = $derived(onScreen?.height || activeHeight);
  const shownBandwidth = $derived(onScreen?.bandwidth || activeBandwidth);
  const declaredFps = $derived(onScreen?.fps || activeDeclaredFps);
  const activeFps = $derived(declaredFps || measuredFps);
  const activeLabel = $derived(shownHeight ? `${shownHeight}p${activeFps ? fmtFps(activeFps) : ""}` : "");
  const qualityLabel = $derived(abrOn ? (activeLabel ? `Auto, ${activeLabel}` : "Auto") : activeLabel);

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds % 60);
    const m = Math.floor((seconds / 60) % 60);
    const h = Math.floor(seconds / 3600);
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function fmtFps(fps) {
    return String(Math.round(fps * 100) / 100);
  }

  function renditionKey(track) {
    return String(track.videoId ?? `${track.height}|${track.frameRate || 0}|${track.bandwidth}`);
  }

  function fmtRate(bps) {
    if (!bps || !Number.isFinite(bps)) return "–";
    return bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbps` : `${Math.round(bps / 1e3)} kbps`;
  }

  /* ---------- Loading ---------- */

  async function load(stream, session) {
    error = null;
    loading = true;
    menu = null;
    qualities = [];
    audioItems = [];
    textTracks = [];
    activeHeight = 0;
    activeWidth = 0;
    activeBandwidth = 0;
    activeDeclaredFps = 0;
    activeKey = "";
    measuredFps = 0;
    fpsSample = null;
    onScreen = null;
    abrOn = true;
    rate = 1;
    try {
      await loadStream(shakaPlayer, stream, {
        audio: settings.rememberAudio ? loadAudioPreference() : null,
      });
      if (session !== player.session) return;
      isLive = shakaPlayer.isLive();
      refreshTracks();
      tick();
      await startPlayback();
    } catch (err) {
      if (isInterruption(err) || session !== player.session) return;
      console.error(err);
      error = describeError(err, stream);
    } finally {
      if (session === player.session) {
        loading = false;
        firstLoad = false;
      }
    }
  }

  async function startPlayback() {
    try {
      await video.play();
    } catch (err) {
      if (err?.name === "NotAllowedError" && !video.muted) {
        video.muted = true;
        await video.play().catch(() => {});
        showToast("Started muted because autoplay with sound was blocked. Press M to unmute.");
      }
    }
  }

  function retry() {
    firstLoad = true;
    reloadPlayer();
  }

  function editStream() {
    if (!player.stream) return;
    workspace.draft = { stream: $state.snapshot(player.stream) };
    close();
    goto("/");
  }

  /* ---------- Tracks ---------- */

  function refreshTracks() {
    if (!shakaPlayer) return;
    const variants = shakaPlayer.getVariantTracks();
    const active = variants.find((t) => t.active);
    abrOn = !!shakaPlayer.getConfiguration().abr.enabled;
    activeHeight = active?.height || 0;
    activeWidth = active?.width || 0;
    activeBandwidth = active?.bandwidth || 0;
    activeDeclaredFps = Number(active?.frameRate) || 0;
    activeKey = active ? renditionKey(active) : "";

    const sameAudio = variants.filter(
      (t) => !active || (t.language === active.language && t.audioId === active.audioId)
    );
    const pool = sameAudio.length ? sameAudio : variants;
    // One entry per rendition: 720p25 and 720p50, or two bitrates of 720p, are separate choices.
    const renditions = new Map();
    for (const track of pool) {
      if (!track.height) continue;
      renditions.set(renditionKey(track), track);
    }
    qualities = [...renditions.entries()]
      .map(([key, track]) => ({
        key,
        height: track.height,
        fps: Number(track.frameRate) || 0,
        bandwidth: track.bandwidth,
        track,
      }))
      .sort((a, b) => b.height - a.height || b.fps - a.fps || b.bandwidth - a.bandwidth);

    audioItems = describeAudioTracks(shakaPlayer.getAudioTracks());

    textTracks = shakaPlayer.getTextTracks();
    activeText = textTracks.find((t) => t.active) || null;
    textVisible = shakaPlayer.isTextTrackVisible();
  }

  function onMediaQualityChanged(event) {
    const quality = event.mediaQuality;
    if (quality?.contentType !== "video") return;
    // The event carries the video bitrate alone; show the same total as the quality menu.
    const variant = shakaPlayer
      .getVariantTracks()
      .find((t) => t.videoBandwidth === quality.bandwidth && t.height === quality.height && t.active)
      ?? shakaPlayer.getVariantTracks().find((t) => t.videoBandwidth === quality.bandwidth && t.height === quality.height);
    onScreen = {
      width: quality.width || 0,
      height: quality.height || 0,
      fps: Number(quality.frameRate) || 0,
      bandwidth: variant?.bandwidth || quality.bandwidth || 0,
    };
  }

  function selectQuality(option) {
    if (option === "auto") {
      shakaPlayer.configure({ abr: { enabled: true } });
    } else {
      shakaPlayer.configure({ abr: { enabled: false } });
      shakaPlayer.selectVariantTrack(option.track, true);
    }
    refreshTracks();
    menu = null;
  }

  /** @param {import("$lib/player/audio.js").AudioItem} item */
  function selectAudio(item, { keepMenu = false } = {}) {
    // selectAudioTrack keeps adaptive quality on, unlike picking a variant directly.
    shakaPlayer.selectAudioTrack(item.track);
    if (settings.rememberAudio) saveAudioPreference(item.track);
    audioItems = audioItems.map((i) => ({ ...i, active: i.key === item.key }));
    if (!keepMenu) menu = null;
    flash(`Audio: ${item.name}${item.detail ? `, ${item.detail}` : ""}`);
  }

  function cycleAudio() {
    if (!hasAudioChoice) return;
    const index = audioItems.findIndex((i) => i.active);
    selectAudio(audioItems[(index + 1) % audioItems.length], { keepMenu: true });
  }

  function flash(message) {
    notice = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = ""), 1800);
  }

  function selectText(track) {
    if (!track) {
      shakaPlayer.setTextTrackVisibility(false);
    } else {
      shakaPlayer.selectTextTrack(track);
      shakaPlayer.setTextTrackVisibility(true);
    }
    refreshTracks();
    menu = null;
  }

  function toggleCaptions() {
    if (!textTracks.length) return;
    selectText(textVisible ? null : activeText || textTracks[0]);
  }

  function selectRate(value) {
    video.playbackRate = value;
    rate = value;
    menu = null;
  }

  /* ---------- Transport ---------- */

  function tick() {
    if (!video || !shakaPlayer) return;
    if (!scrubbing) current = video.currentTime;
    isLive = shakaPlayer.isLive();
    const range = shakaPlayer.seekRange();
    rangeStart = isLive ? range.start : 0;
    rangeEnd = isLive ? range.end : Number.isFinite(video.duration) ? video.duration : range.end;

    const buffered = video.buffered;
    let end = video.currentTime;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= video.currentTime + 0.5 && buffered.end(i) >= video.currentTime) {
        end = buffered.end(i);
      }
    }
    bufferedEnd = end;
    sampleFps();

    if (showStats) {
      const s = shakaPlayer.getStats();
      const active = shakaPlayer.getVariantTracks().find((t) => t.active);
      stats = {
        resolution: s.width && s.height ? `${s.width} × ${s.height}` : "–",
        bitrate: fmtRate(s.streamBandwidth),
        estimate: fmtRate(s.estimatedBandwidth),
        buffer: `${Math.max(0, end - video.currentTime).toFixed(1)} s`,
        dropped: `${s.droppedFrames ?? 0} of ${s.decodedFrames ?? 0}`,
        codecs: [active?.videoCodec, active?.audioCodec].filter(Boolean).join(", ") || "–",
        latency: isLive && Number.isFinite(s.liveLatency) ? `${s.liveLatency.toFixed(1)} s` : null,
      };
    }
  }

  function sampleFps() {
    const quality = video.getVideoPlaybackQuality?.();
    if (!quality) return;
    const now = performance.now();
    const rendered = quality.totalVideoFrames - quality.droppedVideoFrames;
    if (video.paused || video.seeking || video.readyState < 3) {
      fpsSample = null;
      return;
    }
    if (!fpsSample) {
      fpsSample = { now, rendered };
      return;
    }
    if (now - fpsSample.now < 2000) return;
    const fps = ((rendered - fpsSample.rendered) * 1000) / (now - fpsSample.now) / video.playbackRate;
    if (fps > 0) measuredFps = fps;
    fpsSample = { now, rendered };
  }

  function togglePlay() {
    if (error || !video) return;
    if (video.paused) startPlayback();
    else video.pause();
  }

  function seekTo(time) {
    if (!canSeek) return;
    video.currentTime = Math.min(rangeEnd, Math.max(rangeStart, time));
    current = video.currentTime;
  }

  function seekBy(delta) {
    seekTo(video.currentTime + delta);
  }

  function goLive() {
    if (typeof shakaPlayer.goToLive === "function") shakaPlayer.goToLive();
    else seekTo(rangeEnd);
    if (video.paused) startPlayback();
  }

  function onScrubInput(event) {
    scrubbing = true;
    scrubValue = Number(event.currentTarget.value);
    seekTo(scrubValue);
  }

  function onScrubEnd() {
    scrubbing = false;
  }

  function onSeekHover(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const time = rangeStart + ratio * span;
    hoverTip = {
      x: ratio * rect.width,
      label: isLive ? `-${fmt(rangeEnd - time)}` : fmt(time),
    };
  }

  function setVolume(value) {
    video.volume = Math.min(1, Math.max(0, value));
    if (video.volume > 0 && video.muted) video.muted = false;
  }

  function toggleMute() {
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = 0.5;
    } else {
      video.muted = true;
    }
  }

  function onVolumeChange() {
    muted = video.muted;
    volume = video.volume;
    if (settings.rememberVolume) {
      try {
        localStorage.setItem("player_volume", String(video.volume));
      } catch {}
    }
  }

  function onWheel(event) {
    if (!event.target.closest?.(".volume")) return;
    event.preventDefault();
    setVolume(video.volume + (event.deltaY < 0 ? 0.05 : -0.05));
  }

  async function togglePip() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (err) {
      showToast(`Picture in picture isn't available: ${err.message}`, "error");
    }
  }

  /* ---------- Fullscreen ---------- */

  async function toggleFullscreen() {
    const next = !player.fullscreen;
    player.fullscreen = next;
    lastFullscreenChange = performance.now();
    try {
      if (next) await enterFullscreen(stageEl);
      else await exitFullscreen();
    } catch (err) {
      player.fullscreen = !next;
      showToast(`Couldn't switch fullscreen: ${err?.message || err}`, "error");
    }
    wake();
  }

  async function close() {
    if (player.fullscreen) {
      player.fullscreen = false;
      await exitFullscreen().catch(() => {});
    }
    closePlayer();
  }

  /* ---------- Pointer & keyboard ---------- */

  function wake() {
    idle = false;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (settings.autoHideControls && !paused && !menu && !overControls && !error && !loading) {
        idle = true;
      }
    }, 2600);
  }

  function onSurfaceClick() {
    if (menu) {
      menu = null;
      return;
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(togglePlay, 220);
  }

  function onSurfaceDoubleClick() {
    clearTimeout(clickTimer);
    toggleFullscreen();
  }

  function isTyping(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
    return target.tagName === "INPUT" && /** @type {HTMLInputElement} */ (target).type !== "range";
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = /** @type {HTMLElement} */ (event.target);
    const onRange = target instanceof HTMLInputElement && target.type === "range";
    const onButton = target instanceof HTMLButtonElement;
    const key = event.key;

    const handled = (() => {
      switch (key) {
        case " ":
        case "k":
        case "K":
          if (onButton && key === " ") return false;
          togglePlay();
          return true;
        case "f":
        case "F":
        case "F11":
          toggleFullscreen();
          return true;
        case "m":
        case "M":
          toggleMute();
          return true;
        case "c":
        case "C":
          toggleCaptions();
          return true;
        case "i":
        case "I":
          showStats = !showStats;
          return true;
        case "a":
        case "A":
          cycleAudio();
          return hasAudioChoice;
        case "ArrowLeft":
          if (onRange) return false;
          seekBy(-10);
          return true;
        case "ArrowRight":
          if (onRange) return false;
          seekBy(10);
          return true;
        case "ArrowUp":
          if (onRange) return false;
          setVolume(video.volume + 0.05);
          return true;
        case "ArrowDown":
          if (onRange) return false;
          setVolume(video.volume - 0.05);
          return true;
        case "PageUp":
        case "p":
        case "P":
          stepQueue(-1);
          return hasQueue;
        case "PageDown":
        case "n":
        case "N":
          stepQueue(1);
          return hasQueue;
        case "Escape":
          if (menu) menu = null;
          else if (player.fullscreen) toggleFullscreen();
          // A browser consumes Esc to leave fullscreen; don't treat the same press as "close".
          else if (performance.now() - lastFullscreenChange > 400) close();
          return true;
        default:
          return false;
      }
    })();

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      wake();
    }
  }

  /* ---------- Lifecycle ---------- */

  $effect(() => {
    const session = player.session;
    const stream = player.stream;
    if (!ready || !stream) return;
    untrack(() => load(stream, session));
  });

  $effect(() => {
    if (paused || menu || error) {
      idle = false;
      clearTimeout(idleTimer);
    } else {
      untrack(wake);
    }
  });

  onMount(async () => {
    installShaka();
    shakaPlayer = new shaka.Player();

    shakaPlayer.addEventListener("error", (event) => {
      const err = event.detail;
      if (err?.severity === shaka.util.Error.Severity.CRITICAL && !isInterruption(err)) {
        error = describeError(err, player.stream);
        loading = false;
      } else {
        console.warn("Recoverable playback error", err);
      }
    });
    shakaPlayer.addEventListener("mediaqualitychanged", onMediaQualityChanged);
    shakaPlayer.addEventListener("buffering", (event) => {
      if (!firstLoad) loading = event.buffering;
    });
    for (const name of ["trackschanged", "variantchanged", "adaptation", "abrstatuschanged", "textchanged", "texttrackvisibility"]) {
      shakaPlayer.addEventListener(name, refreshTracks);
    }

    await shakaPlayer.attach(video);

    video.muted = settings.playMuted;
    if (settings.rememberVolume) {
      const stored = Number(localStorage.getItem("player_volume"));
      if (Number.isFinite(stored) && stored >= 0 && stored <= 1 && localStorage.getItem("player_volume") !== null) {
        video.volume = stored;
      }
    }
    onVolumeChange();

    unwatchFullscreen = await watchFullscreen((fullscreen) => {
      if (fullscreen !== player.fullscreen) {
        player.fullscreen = fullscreen;
        lastFullscreenChange = performance.now();
      }
    });

    tickTimer = setInterval(tick, 250);
    window.addEventListener("keydown", onKeydown, true);
    ready = true;
  });

  onDestroy(() => {
    clearInterval(tickTimer);
    clearTimeout(idleTimer);
    clearTimeout(clickTimer);
    clearTimeout(noticeTimer);
    if (typeof window !== "undefined") window.removeEventListener("keydown", onKeydown, true);
    unwatchFullscreen?.();
    shakaPlayer?.destroy();
    if (player.fullscreen) {
      player.fullscreen = false;
      exitFullscreen().catch(() => {});
    }
  });
</script>

<div
  class="stage"
  class:fullscreen={player.fullscreen}
  class:idle
  bind:this={stageEl}
  onpointermove={wake}
  onpointerdown={wake}
  onwheel={onWheel}
  role="region"
  aria-label="Video player"
  transition:fade={{ duration: 160 }}
>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={video}
    playsinline
    autoplay
    onplay={() => (paused = false)}
    onpause={() => (paused = true)}
    onvolumechange={onVolumeChange}
    onratechange={() => (rate = video.playbackRate)}
  ></video>

  <!-- Click to play / pause, double-click for fullscreen -->
  <div class="surface" onclick={onSurfaceClick} ondblclick={onSurfaceDoubleClick} aria-hidden="true"></div>

  {#if loading && !error}
    <div class="tuning" class:first={firstLoad} transition:fade={{ duration: 120 }}>
      <span class="meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      {#if firstLoad}<span>Tuning in</span>{/if}
    </div>
  {/if}

  {#if paused && !loading && !error}
    <button class="big-play" onclick={togglePlay} aria-label="Play" transition:fade={{ duration: 120 }}>
      <Icon name="play" size={34} />
    </button>
  {/if}

  {#if error}
    <div class="error" role="alert">
      <Icon name="alert" size={28} class="error-icon" />
      <h2>{error.title}</h2>
      <p>{error.detail}</p>
      <p class="error-code num">{error.code}</p>
      <div class="error-actions">
        <button class="btn primary" onclick={retry}><Icon name="refresh" size={16} />Try again</button>
        <button class="btn" onclick={editStream}><Icon name="edit" size={16} />Edit stream</button>
        {#if hasQueue}
          <button class="btn" onclick={() => stepQueue(1)}><Icon name="next" size={16} />Next channel</button>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Top bar -->
  <header class="top chrome" role="group" aria-label="Now playing" onpointerenter={() => (overControls = true)} onpointerleave={() => (overControls = false)}>
    {#if player.logo}
      <img class="logo" src={player.logo} alt="" onerror={(e) => (e.currentTarget.style.display = "none")} />
    {/if}
    <div class="title-block">
      <h2 class="title">{heading}</h2>
      <div class="meta">
        {#if player.stream}<span class="chip">{formatLabel(player.stream)}</span>{/if}
        {#if shownHeight}<span class="chip num" title="Current resolution">{shownWidth ? `${shownWidth}×${shownHeight}` : `${shownHeight}p`}</span>{/if}
        {#if activeFps}<span class="chip num" title="Current frame rate">{fmtFps(Math.round(activeFps * 100) / 100)} fps</span>{/if}
        {#if shownBandwidth}<span class="chip num" title="Current stream bitrate">{fmtRate(shownBandwidth)}</span>{/if}
        {#if player.stream && player.stream.drmScheme !== "none"}<span class="chip">DRM</span>{/if}
        {#if hasAudioChoice && activeAudio}<span class="sub">Audio: {activeAudio.name}</span>{/if}
        {#if player.subtitle}<span class="sub">{player.subtitle}</span>{/if}
        {#if hasQueue}<span class="sub num">Channel {player.index + 1} of {player.queue.length}</span>{/if}
      </div>
    </div>
    <button class="ctl close" onclick={close} aria-label="Close player" title="Close (Esc)">
      <Icon name="close" size={20} />
    </button>
  </header>

  {#if showStats}
    <dl class="stats num chrome" transition:fade={{ duration: 120 }}>
      <dt>Resolution</dt><dd>{stats.resolution ?? "–"}</dd>
      <dt>Frame rate</dt><dd>{declaredFps ? `${fmtFps(declaredFps)} declared` : "Not declared"}{measuredFps ? `, ${measuredFps.toFixed(1)} rendered` : ""}</dd>
      <dt>Stream bitrate</dt><dd>{stats.bitrate ?? "–"}</dd>
      <dt>Bandwidth estimate</dt><dd>{stats.estimate ?? "–"}</dd>
      <dt>Buffer ahead</dt><dd>{stats.buffer ?? "–"}</dd>
      <dt>Dropped frames</dt><dd>{stats.dropped ?? "–"}</dd>
      <dt>Codecs</dt><dd>{stats.codecs ?? "–"}</dd>
      {#if stats.latency}<dt>Live latency</dt><dd>{stats.latency}</dd>{/if}
    </dl>
  {/if}

  {#if notice}
    <div class="notice" role="status" transition:fade={{ duration: 140 }}>{notice}</div>
  {/if}

  <!-- Bottom controls -->
  <div class="bottom chrome" role="group" aria-label="Player controls" onpointerenter={() => (overControls = true)} onpointerleave={() => (overControls = false)}>
    {#if canSeek && rangeEnd > 0}
      <div class="seek" role="presentation" onpointermove={onSeekHover} onpointerleave={() => (hoverTip = null)}>
        <div class="track">
          <div class="buffered" style:width="{bufferPct}%"></div>
          <div class="played" style:width="{playedPct}%"></div>
          <div class="thumb" style:left="{playedPct}%"></div>
        </div>
        <input
          type="range"
          aria-label="Seek"
          aria-valuetext={isLive ? `${fmt(behindLive)} behind live` : `${fmt(shown)} of ${fmt(rangeEnd)}`}
          min={rangeStart}
          max={rangeEnd}
          step="0.1"
          value={shown}
          oninput={onScrubInput}
          onchange={onScrubEnd}
          onpointerup={onScrubEnd}
        />
        {#if hoverTip}
          <span class="tip num" style:left="{hoverTip.x}px">{hoverTip.label}</span>
        {/if}
      </div>
    {/if}

    <div class="bar">
      <button class="ctl" onclick={togglePlay} aria-label={paused ? "Play" : "Pause"} title={paused ? "Play (K)" : "Pause (K)"}>
        <Icon name={paused ? "play" : "pause"} size={22} />
      </button>

      {#if hasQueue}
        <button class="ctl" onclick={() => stepQueue(-1)} aria-label="Previous channel" title="Previous channel (P)">
          <Icon name="prev" size={20} />
        </button>
        <button class="ctl" onclick={() => stepQueue(1)} aria-label="Next channel" title="Next channel (N)">
          <Icon name="next" size={20} />
        </button>
      {/if}

      <div class="volume">
        <button class="ctl" onclick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} title="Mute (M)">
          <Icon name={muted || volume === 0 ? "volume-mute" : volume < 0.5 ? "volume-low" : "volume-high"} size={21} />
        </button>
        <input
          class="volume-range"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={muted ? 0 : volume}
          style:--fill="{(muted ? 0 : volume) * 100}%"
          oninput={(e) => setVolume(Number(e.currentTarget.value))}
          aria-label="Volume"
        />
      </div>

      {#if isLive}
        {#if atLiveEdge || !canSeek}
          <span class="live"><i aria-hidden="true"></i>Live</span>
        {:else}
          <button class="go-live" onclick={goLive} title="Jump to the live edge">
            <span class="num">-{fmt(behindLive)}</span>
            Go live
          </button>
        {/if}
      {:else if rangeEnd > 0}
        <span class="time num">{fmt(shown)} <span class="dim">/ {fmt(rangeEnd)}</span></span>
      {/if}

      <span class="spacer"></span>

      {#if hasAudioChoice}
        <button
          class="ctl"
          class:on={menu === "audio"}
          onclick={() => (menu = menu === "audio" ? null : "audio")}
          aria-haspopup="menu"
          aria-expanded={menu === "audio"}
          aria-label="Audio track: {activeAudio?.name ?? 'default'}"
          title="Audio track (A)"
        >
          <Icon name="audio" size={20} />
        </button>
      {/if}

      {#if textTracks.length}
        <button class="ctl" class:on={textVisible} onclick={toggleCaptions} aria-pressed={textVisible} aria-label="Subtitles" title="Subtitles (C)">
          <Icon name="captions" size={21} />
        </button>
      {/if}

      <div class="menu-anchor">
        <button
          class="ctl"
          class:on={!!menu}
          onclick={() => (menu = menu ? null : "root")}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label="Playback settings"
          title="Quality and playback"
        >
          <Icon name="sliders" size={20} />
        </button>

        {#if menu}
          <div class="menu" role="menu" transition:fade={{ duration: 100 }}>
            {#if menu === "root"}
              {#if qualities.length}
                <button role="menuitem" onclick={() => (menu = "quality")}>
                  <span>Quality</span><span class="val">{qualityLabel}</span><Icon name="chevron-right" size={16} />
                </button>
              {/if}
              {#if hasAudioChoice}
                <button role="menuitem" onclick={() => (menu = "audio")}>
                  <span>Audio</span><span class="val">{activeAudio?.name ?? "Default"}</span><Icon name="chevron-right" size={16} />
                </button>
              {/if}
              {#if textTracks.length}
                <button role="menuitem" onclick={() => (menu = "text")}>
                  <span>Subtitles</span>
                  <span class="val">{textVisible && activeText ? activeText.label || languageLabel(activeText.language) || "On" : "Off"}</span>
                  <Icon name="chevron-right" size={16} />
                </button>
              {/if}
              {#if !isLive}
                <button role="menuitem" onclick={() => (menu = "speed")}>
                  <span>Speed</span><span class="val">{rate === 1 ? "Normal" : `${rate}×`}</span><Icon name="chevron-right" size={16} />
                </button>
              {/if}
              <button role="menuitemcheckbox" aria-checked={showStats} onclick={() => { showStats = !showStats; menu = null; }}>
                <span>Stream stats</span><span class="val">{showStats ? "On" : "Off"}</span><span class="kbd">I</span>
              </button>
            {:else}
              <button class="menu-back" onclick={() => (menu = "root")}>
                <Icon name="chevron-left" size={16} />
                {menu === "quality" ? "Quality" : menu === "audio" ? "Audio" : menu === "text" ? "Subtitles" : "Speed"}
              </button>
              {#if menu === "quality"}
                <button role="menuitemradio" aria-checked={abrOn} onclick={() => selectQuality("auto")}>
                  <Icon name="check" size={16} class="tick" /><span>Auto</span><span class="val">Adapts to your connection</span>
                </button>
                {#each qualities as q (q.key)}
                  <button role="menuitemradio" aria-checked={!abrOn && activeKey === q.key} onclick={() => selectQuality(q)}>
                    <Icon name="check" size={16} class="tick" /><span class="num">{q.height}p</span>{#if q.fps}<span class="fps num">{fmtFps(q.fps)} fps</span>{/if}<span class="val num">{fmtRate(q.bandwidth)}</span>
                  </button>
                {/each}
              {:else if menu === "audio"}
                {#each audioItems as item (item.key)}
                  <button role="menuitemradio" class="two-line" aria-checked={item.active} onclick={() => selectAudio(item)}>
                    <Icon name="check" size={16} class="tick" />
                    <span class="stack">
                      <span>{item.name}</span>
                      {#if item.detail}<span class="detail">{item.detail}</span>{/if}
                    </span>
                  </button>
                {/each}
              {:else if menu === "text"}
                <button role="menuitemradio" aria-checked={!textVisible} onclick={() => selectText(null)}>
                  <Icon name="check" size={16} class="tick" /><span>Off</span>
                </button>
                {#each textTracks as t (t.id)}
                  <button role="menuitemradio" aria-checked={textVisible && activeText?.id === t.id} onclick={() => selectText(t)}>
                    <Icon name="check" size={16} class="tick" /><span>{t.label || languageLabel(t.language) || "Subtitles"}</span>
                  </button>
                {/each}
              {:else if menu === "speed"}
                {#each [0.5, 0.75, 1, 1.25, 1.5, 2] as r}
                  <button role="menuitemradio" aria-checked={rate === r} onclick={() => selectRate(r)}>
                    <Icon name="check" size={16} class="tick" /><span class="num">{r === 1 ? "Normal" : `${r}×`}</span>
                  </button>
                {/each}
              {/if}
            {/if}
          </div>
        {/if}
      </div>

      {#if typeof document !== "undefined" && document.pictureInPictureEnabled}
        <button class="ctl" onclick={togglePip} aria-label="Picture in picture" title="Picture in picture">
          <Icon name="pip" size={20} />
        </button>
      {/if}

      <button
        class="ctl"
        onclick={toggleFullscreen}
        aria-label={player.fullscreen ? "Exit fullscreen" : "Fullscreen"}
        title={player.fullscreen ? "Exit fullscreen (F or Esc)" : "Fullscreen (F)"}
      >
        <Icon name={player.fullscreen ? "fullscreen-exit" : "fullscreen"} size={20} />
      </button>
    </div>
  </div>
</div>

<style>
  /* The stage always uses dark chrome, whatever the app theme. */
  .stage {
    --c-ink: #f3f1ea;
    --c-dim: rgb(243 241 234 / 0.66);
    --c-hover: rgb(255 255 255 / 0.12);
    position: fixed;
    inset: var(--titlebar-h) 0 0 0;
    z-index: 50;
    background: #000;
    color: var(--c-ink);
    overflow: hidden;
    user-select: none;
    isolation: isolate;
  }

  /* Covers the whole window. In the desktop app the window itself is fullscreen. */
  .stage.fullscreen {
    inset: 0;
    z-index: 1000;
  }

  .stage:fullscreen {
    inset: 0;
  }

  .stage.idle {
    cursor: none;
  }

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    display: block;
  }

  video::cue {
    font-family: var(--font);
    background: rgb(0 0 0 / 0.72);
  }

  .surface {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  /* ---------- Chrome (auto-hiding bars) ---------- */
  .chrome {
    z-index: 3;
    transition: opacity 260ms var(--ease-out), transform 260ms var(--ease-out);
  }

  .stage.idle .chrome {
    opacity: 0;
    pointer-events: none;
  }

  .stage.idle .top {
    transform: translateY(-8px);
  }

  .stage.idle .bottom {
    transform: translateY(8px);
  }

  .top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 18px 18px 48px 24px;
    background: linear-gradient(to bottom, rgb(0 0 0 / 0.72), rgb(0 0 0 / 0.32) 60%, transparent);
  }

  .logo {
    width: 44px;
    height: 44px;
    object-fit: contain;
    border-radius: 8px;
    background: rgb(255 255 255 / 0.06);
    padding: 4px;
    flex: none;
  }

  .title-block {
    flex: 1;
    min-width: 0;
    padding-top: 2px;
  }

  .title {
    font-size: 19px;
    line-height: 1.2;
    font-weight: 640;
    font-variation-settings: "wdth" 118;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin-top: 6px;
    font-size: 12.5px;
    color: var(--c-dim);
  }

  .chip {
    height: 19px;
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    border-radius: 4px;
    border: 1px solid rgb(255 255 255 / 0.22);
    font-size: 11px;
    font-weight: 640;
    font-variation-settings: "wdth" 88;
    color: var(--c-ink);
  }

  .bottom {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 56px 16px 12px;
    background: linear-gradient(to top, rgb(0 0 0 / 0.8), rgb(0 0 0 / 0.4) 55%, transparent);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 44px;
  }

  .spacer {
    flex: 1;
  }

  .ctl {
    width: 40px;
    height: 40px;
    display: inline-grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--c-ink);
    flex: none;
    transition: background-color 120ms ease, color 120ms ease;
  }

  .ctl:hover {
    background: var(--c-hover);
  }

  .ctl.on {
    color: var(--accent);
  }

  .close {
    background: rgb(0 0 0 / 0.3);
  }

  /* ---------- Seek ---------- */
  .seek {
    position: relative;
    height: 20px;
    margin: 0 8px 4px;
    display: flex;
    align-items: center;
  }

  .track {
    position: relative;
    width: 100%;
    height: 4px;
    border-radius: 4px;
    background: rgb(255 255 255 / 0.2);
    transition: height 140ms var(--ease-out);
  }

  .seek:hover .track {
    height: 6px;
  }

  .buffered,
  .played {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    border-radius: inherit;
  }

  .buffered {
    background: rgb(255 255 255 / 0.32);
  }

  .played {
    background: var(--accent);
  }

  .thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 4px rgb(255 210 63 / 0.25);
    transform: scale(0);
    transition: transform 140ms var(--ease-out);
  }

  .seek:hover .thumb,
  .seek:focus-within .thumb {
    transform: scale(1);
  }

  .seek input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .seek:focus-within .track {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }

  .tip {
    position: absolute;
    bottom: 22px;
    transform: translateX(-50%);
    padding: 3px 7px;
    border-radius: 5px;
    background: rgb(0 0 0 / 0.9);
    font-size: 12px;
    font-weight: 600;
    pointer-events: none;
    white-space: nowrap;
  }

  /* ---------- Volume ---------- */
  .volume {
    display: flex;
    align-items: center;
    margin-left: 4px;
  }

  .volume-range {
    appearance: none;
    width: 84px;
    height: 20px;
    margin: 0 10px 0 2px;
    background: transparent;
    cursor: pointer;
  }

  .volume-range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--c-ink) var(--fill), rgb(255 255 255 / 0.25) var(--fill));
  }

  .volume-range::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--c-ink);
  }

  .volume-range::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--c-ink) var(--fill), rgb(255 255 255 / 0.25) var(--fill));
  }

  .volume-range::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 0;
    border-radius: 50%;
    background: var(--c-ink);
  }

  /* ---------- Time / live ---------- */
  .time {
    margin-left: 6px;
    font-size: 13.5px;
    font-weight: 560;
  }

  .dim {
    color: var(--c-dim);
  }

  .live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-left: 8px;
    padding: 0 9px;
    height: 24px;
    border-radius: 3px;
    background: var(--red);
    color: #fff;
    font-size: 12px;
    font-weight: 720;
    font-variation-settings: "wdth" 110;
    letter-spacing: 0.02em;
  }

  .live i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #fff;
    animation: pulse 1.6s ease-in-out infinite;
  }

  .go-live {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-left: 8px;
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid rgb(255 255 255 / 0.3);
    background: transparent;
    color: var(--c-ink);
    font-size: 12.5px;
    font-weight: 600;
  }

  .go-live:hover {
    border-color: var(--red);
    background: rgb(229 72 77 / 0.2);
  }

  .go-live .num {
    color: var(--c-dim);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  /* ---------- Menu ---------- */
  .menu-anchor {
    position: relative;
  }

  .menu {
    position: absolute;
    right: -44px;
    bottom: 50px;
    min-width: 260px;
    max-height: min(60vh, 420px);
    overflow-y: auto;
    padding: 6px;
    border-radius: 8px;
    background: rgb(8 8 9 / 0.97);
    border: 1px solid rgb(255 255 255 / 0.1);
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.5);
    backdrop-filter: blur(12px);
  }

  .menu button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    height: 38px;
    padding: 0 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--c-ink);
    font-size: 13.5px;
    text-align: left;
  }

  .menu button:hover {
    background: var(--c-hover);
  }

  .menu .fps {
    color: var(--c-dim);
    font-size: 12.5px;
  }

  .menu .val {
    margin-left: auto;
    color: var(--c-dim);
    font-size: 12.5px;
  }

  .menu :global(.tick) {
    opacity: 0;
    color: var(--accent);
    flex: none;
  }

  .menu [aria-checked="true"] :global(.tick) {
    opacity: 1;
  }

  .menu button.two-line {
    height: auto;
    min-height: 38px;
    padding-block: 7px;
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .stack .detail {
    color: var(--c-dim);
    font-size: 12px;
  }

  .notice {
    position: absolute;
    z-index: 4;
    top: 92px;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 48px);
    padding: 8px 14px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.72);
    font-size: 14px;
    font-weight: 560;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  .menu-back {
    color: var(--c-dim) !important;
    border-bottom: 1px solid rgb(255 255 255 / 0.08) !important;
    border-radius: 5px 5px 0 0 !important;
    margin-bottom: 4px;
  }

  .kbd {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid rgb(255 255 255 / 0.2);
    color: var(--c-dim);
  }

  /* ---------- Stats ---------- */
  .stats {
    position: absolute;
    top: 96px;
    left: 24px;
    display: grid;
    grid-template-columns: auto auto;
    gap: 3px 18px;
    margin: 0;
    padding: 12px 14px;
    border-radius: 8px;
    background: rgb(0 0 0 / 0.78);
    border: 1px solid rgb(255 255 255 / 0.08);
    font-size: 12.5px;
    max-width: calc(100% - 48px);
  }

  .stats dt {
    color: var(--c-dim);
  }

  .stats dd {
    margin: 0;
    font-weight: 560;
    overflow-wrap: anywhere;
  }

  /* ---------- Center states ---------- */
  .big-play {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    width: 76px;
    height: 76px;
    margin: -38px 0 0 -38px;
    display: grid;
    place-items: center;
    padding-left: 4px;
    border: 0;
    border-radius: 10px;
    background: rgb(0 0 0 / 0.6);
    color: #fff;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.2);
    transition: background-color 140ms ease, transform 140ms var(--ease-out);
  }

  .big-play:hover {
    background: var(--accent);
    color: var(--accent-ink);
    transform: scale(1.04);
  }

  .tuning {
    position: absolute;
    z-index: 2;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    font-size: 13.5px;
    color: var(--c-dim);
    pointer-events: none;
  }

  .meter {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 28px;
  }

  .meter i {
    width: 5px;
    border-radius: 2px;
    background: var(--accent);
    transform-origin: bottom;
    animation: level 900ms ease-in-out infinite;
  }

  .meter i:nth-child(1) { height: 30%; animation-delay: 0ms; }
  .meter i:nth-child(2) { height: 60%; animation-delay: 120ms; }
  .meter i:nth-child(3) { height: 90%; animation-delay: 240ms; }
  .meter i:nth-child(4) { height: 50%; animation-delay: 360ms; }

  @keyframes level {
    0%,
    100% {
      transform: scaleY(0.35);
      opacity: 0.6;
    }
    50% {
      transform: scaleY(1);
      opacity: 1;
    }
  }

  .error {
    position: absolute;
    z-index: 4;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100% - 40px));
    text-align: center;
  }

  .error :global(.error-icon) {
    color: var(--accent);
    margin-bottom: 10px;
  }

  .error h2 {
    font-size: 20px;
    font-weight: 640;
    font-variation-settings: "wdth" 112;
  }

  .error p {
    margin-top: 8px;
    color: var(--c-dim);
    line-height: 1.55;
  }

  .error .error-code {
    font-size: 12px;
    color: rgb(243 241 234 / 0.42);
  }

  .error-actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 20px;
  }

  .error-actions :global(.btn:not(.primary)) {
    background: rgb(255 255 255 / 0.08);
    border-color: rgb(255 255 255 / 0.16);
    color: var(--c-ink);
  }

  @media (max-width: 640px) {
    .volume-range {
      display: none;
    }
    .top {
      padding: 12px 10px 40px 14px;
    }
    .bottom {
      padding: 40px 6px 6px;
    }
  }
</style>
