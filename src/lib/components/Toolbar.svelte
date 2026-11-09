<script lang="ts">
  import { store } from '../store.svelte';
  import { titleFor } from '../time';
  import type { ViewMode } from '../types';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  const title = $derived(titleFor(store.settings.view, store.range, store.cursor));
  const views: { id: ViewMode; label: string; key: string }[] = [
    { id: 'day', label: 'Day', key: '1' },
    { id: 'week', label: 'Week', key: '2' },
    { id: 'month', label: 'Month', key: '3' }
  ];
</script>

<header class="tb">
  <button
    class="icon-btn"
    class:on={store.settings.sidebar}
    aria-label="Toggle sidebar"
    aria-pressed={store.settings.sidebar}
    title="Toggle sidebar  ["
    onclick={() => store.setSetting('sidebar', !store.settings.sidebar)}><Icon name="sidebar" size={18} /></button
  >
  <button class="btn" onclick={() => store.today()} title="Go to today  T">Today</button>
  <div class="nav">
    <button class="icon-btn" aria-label="Previous" title="Previous  ←" onclick={() => store.step(-1)}><Icon name="chev-left" size={18} /></button>
    <button class="icon-btn" aria-label="Next" title="Next  →" onclick={() => store.step(1)}><Icon name="chev-right" size={18} /></button>
  </div>
  <h1 class="num">{title}</h1>
  <span class="sp"></span>
  <button class="search" onclick={() => (ui.palette = true)} aria-label="Open command palette">
    <Icon name="search" size={15} /><span>Search or run a command</span><span class="kbd">Ctrl</span><span class="kbd">K</span>
  </button>
  <div class="seg" role="group" aria-label="View">
    {#each views as v (v.id)}
      <button aria-pressed={store.settings.view === v.id} title="{v.label}  {v.key}" onclick={() => store.setView(v.id)}>{v.label}</button>
    {/each}
  </div>
  <button class="btn primary" onclick={() => (ui.quickAdd = true)} title="Quick add  Q"><Icon name="plus" size={15} />Add</button>
</header>

<style>
  .tb { display: flex; align-items: center; gap: var(--s2); padding: var(--s2) var(--s3); height: 52px; border-bottom: 1px solid var(--border); background: var(--surface); flex: none; }
  .nav { display: flex; }
  h1 { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; margin-left: var(--s2); white-space: nowrap; }
  .sp { flex: 1; }
  .search {
    display: flex; align-items: center; gap: var(--s2); height: 32px; padding: 0 var(--s2) 0 var(--s3); min-width: 230px;
    border-radius: var(--r); border: 1px solid var(--border-strong); background: var(--surface-2); color: var(--text-3);
  }
  .search:hover { border-color: var(--text-3); }
  .search span:nth-child(2) { flex: 1; text-align: left; }
</style>
