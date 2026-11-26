<script>
  import { fly, fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Icon from "$lib/components/Icon.svelte";
  import { sheets } from "$lib/viewport.svelte.js";

  /** @type {{ open: boolean, title: string, onclose: () => void, children: any }} */
  let { open, title, onclose, children } = $props();

  // The page scrolls inside a fixed container, which would trap the sheet under
  // the tab bar; render it at the end of <body> instead.
  function portal(node) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // Register with the sheet stack so Android Back closes this sheet first.
  $effect(() => {
    if (!open) return;
    const close = () => onclose();
    sheets.stack.push(close);
    return () => {
      const i = sheets.stack.indexOf(close);
      if (i !== -1) sheets.stack.splice(i, 1);
    };
  });
</script>

{#if open}
<div class="m-sheet-root" use:portal>
  <div class="backdrop" onclick={onclose} aria-hidden="true" transition:fade={{ duration: 160 }}></div>
  <div class="sheet" role="dialog" aria-modal="true" aria-label={title} transition:fly={{ y: 420, duration: 260, easing: cubicOut }}>
    <div class="grip" aria-hidden="true"></div>
    <header>
      <h2>{title}</h2>
      <button class="close" onclick={onclose} aria-label="Close {title}">
        <Icon name="close" size={20} />
      </button>
    </header>
    <div class="body">
      {@render children()}
    </div>
  </div>
</div>
{/if}

<style>
  .backdrop {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 70;
    background: rgb(0 0 0 / 0.66);
  }

  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 71;
    display: flex;
    flex-direction: column;
    max-height: 88%;
    border-radius: 24px 24px 0 0;
    background: var(--m-panel);
    border-top: 1px solid var(--m-line);
    box-shadow: 0 -20px 60px rgb(0 0 0 / 0.6);
  }

  .grip {
    width: 40px;
    height: 4px;
    margin: 10px auto 2px;
    border-radius: 4px;
    background: var(--m-line-strong);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px 6px 20px;
  }

  h2 {
    font-size: 19px;
    font-weight: 700;
    font-variation-settings: "wdth" 118;
  }

  .close {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--m-muted);
  }

  .close:active {
    background: var(--m-raised);
  }

  .body {
    overflow-y: auto;
    padding: 4px 20px calc(24px + env(safe-area-inset-bottom, 0px));
    overscroll-behavior: contain;
  }
</style>
