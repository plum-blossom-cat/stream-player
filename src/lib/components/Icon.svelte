<script>
  /** @type {{ name: string, size?: number, class?: string }} */
  let { name, size = 18, class: className = "" } = $props();

  // 24px stroke icons. Entries starting with "fill:" are drawn filled.
  const icons = {
    play: "fill:M7.5 4.6v14.8c0 .5.5.8.9.5l11.1-7.4a.6.6 0 0 0 0-1L8.4 4.1c-.4-.3-.9 0-.9.5z",
    pause: "fill:M6 5.2c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v13.6c0 .4-.3.7-.7.7H6.7a.7.7 0 0 1-.7-.7zm8 0c0-.4.3-.7.7-.7h2.6c.4 0 .7.3.7.7v13.6c0 .4-.3.7-.7.7h-2.6a.7.7 0 0 1-.7-.7z",
    close: "M18 6 6 18M6 6l12 12",
    "win-min": "M5 12h14",
    "win-max": "M5.5 5.5h13v13h-13z",
    "win-restore": "M8.5 8.5V5.5h10v10h-3M5.5 8.5h10v10h-10z",
    fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
    "fullscreen-exit": "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
    "volume-high": "M11 5 6.5 9H3.5v6h3l4.5 4zM15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.4 6a8.5 8.5 0 0 1 0 12",
    "volume-low": "M11 5 6.5 9H3.5v6h3l4.5 4zM15.5 8.8a4.5 4.5 0 0 1 0 6.4",
    "volume-mute": "M11 5 6.5 9H3.5v6h3l4.5 4zM16 9.5l5 5m0-5-5 5",
    sliders: "M20 7h-9M14 17H4M17 20a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    pip: "M20 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M13 14h8v6h-8z",
    prev: "M18 18.5 9.5 12 18 5.5zM6 5.5v13",
    next: "M6 5.5 14.5 12 6 18.5zM18 5.5v13",
    "chevron-right": "m9.5 6 6 6-6 6",
    "chevron-left": "m14.5 6-6 6 6 6",
    "chevron-down": "m6 9.5 6 6 6-6",
    check: "m5 12.5 4.5 4.5L19.5 7",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
    edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
    link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
    refresh: "M20 12a8 8 0 1 1-2.4-5.7L20 8.5M20 4v4.5h-4.5",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2",
    alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01",
    audio: "M4 15.5V12a8 8 0 0 1 16 0v3.5M4 15.5A2.5 2.5 0 0 1 6.5 13H8v7H6.5A2.5 2.5 0 0 1 4 17.5zm16 0a2.5 2.5 0 0 0-2.5-2.5H16v7h1.5a2.5 2.5 0 0 0 2.5-2.5z",
    captions: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10.5 10.2a2 2 0 1 0 0 3.6M17 10.2a2 2 0 1 0 0 3.6",
    stats: "M3 12h4l3-8 4 16 3-8h4",
    "arrow-left": "M19 12H5M11 6l-6 6 6 6",
    list: "M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01",
    bookmark: "M6.5 4h11v16.5L12 16.8l-5.5 3.7z",
    upload: "M12 15V4M7 9l5-5 5 5M5 20h14",
    copy: "M9 9h11v11H9zM5 15V5a1 1 0 0 1 1-1h10",
    back10: "M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5",
  };

  const def = $derived(icons[name] ?? "");
  const filled = $derived(def.startsWith("fill:"));
  const d = $derived(filled ? def.slice(5) : def);
</script>

<svg
  class={className}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? "currentColor" : "none"}
  stroke={filled ? "none" : "currentColor"}
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  <path {d} />
</svg>
