<script lang="ts">
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';
  const d = $derived(ui.taskDrag);
</script>

{#if d}
  <div class="tg" style="transform:translate({d.x + 14}px,{d.y + 10}px)" class:ok={!!d.hover}>
    <Icon name="clock" size={13} />
    <span>{d.task.title}</span>
  </div>
{/if}

<style>
  .tg {
    position: fixed; left: 0; top: 0; z-index: 95; pointer-events: none; display: inline-flex; align-items: center; gap: 6px;
    max-width: 240px; padding: 4px 10px; border-radius: 7px; background: var(--surface); border: 1px solid var(--border-strong);
    box-shadow: var(--sh-drag); font-weight: 600; will-change: transform; opacity: 0.92; color: var(--text-2);
  }
  .tg.ok { border-color: var(--accent); color: var(--accent); }
  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
