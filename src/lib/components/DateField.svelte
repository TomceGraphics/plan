<script lang="ts">
  import { format } from 'date-fns';
  import { dayStart } from '../time';
  import MiniMonth from './MiniMonth.svelte';

  let { value, onchange, label }: { value: number; onchange: (dayMs: number) => void; label: string } = $props();
  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        open = false;
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  });
</script>

<div class="df" bind:this={root}>
  <button class="btn-d field" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onclick={() => (open = !open)}>
    {format(value, 'EEE, d MMM yyyy')}
  </button>
  {#if open}
    <div class="dd card">
      <MiniMonth
        value={new Date(value)}
        onpick={(d) => {
          onchange(dayStart(d));
          open = false;
        }}
      />
    </div>
  {/if}
</div>

<style>
  .df { position: relative; flex: 1; min-width: 0; }
  .btn-d { text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dd { position: absolute; z-index: 60; top: 36px; left: 0; width: 236px; padding: var(--s2); animation: pop 90ms ease-out; }
</style>
