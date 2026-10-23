<script>
  import { toasts } from "$lib/toast.svelte.js";
  import { flip } from "svelte/animate";
  import { fade, fly } from "svelte/transition";
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div
      class="toast"
      class:error={toast.tone === "error"}
      in:fly={{ y: 12, duration: 220 }}
      out:fade={{ duration: 160 }}
      animate:flip={{ duration: 200 }}
    >
      {toast.message}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 28px;
    z-index: 2000;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: min(560px, calc(100vw - 32px));
    pointer-events: none;
  }

  .toast {
    max-width: 100%;
    padding: 10px 16px;
    border-radius: 10px;
    background: var(--ink);
    color: var(--bg);
    font-size: 13.5px;
    font-weight: 540;
    line-height: 1.4;
    box-shadow: var(--shadow-pop);
    border-left: 3px solid var(--accent);
    pointer-events: auto;
  }

  .toast.error {
    border-left-color: var(--red);
  }
</style>
