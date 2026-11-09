<script lang="ts">
  import { ui } from '../ui.svelte';
</script>

<div class="ts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="t">
      <span>{t.message}</span>
      {#if t.action}
        <button
          class="a"
          onclick={() => {
            t.action?.run();
            ui.dismissToast(t.id);
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .ts { position: fixed; z-index: 100; left: 0; right: 0; bottom: var(--s6); display: flex; flex-direction: column; gap: var(--s2); align-items: center; pointer-events: none; }
  .t {
    pointer-events: auto; display: flex; align-items: center; gap: var(--s4); padding: 8px 8px 8px 16px; border-radius: var(--r);
    background: #22242c; color: #f1f2f6; box-shadow: var(--sh-2); animation: pop 100ms ease-out; max-width: 520px;
  }
  :global(:root[data-theme='dark']) .t { background: #eceef5; color: #14151a; }
  .a { height: 26px; padding: 0 10px; border: 0; border-radius: 6px; background: rgb(255 255 255 / 0.14); color: inherit; font-weight: 700; }
  :global(:root[data-theme='dark']) .a { background: rgb(0 0 0 / 0.1); }
  .a:hover { background: rgb(255 255 255 / 0.24); }
</style>
