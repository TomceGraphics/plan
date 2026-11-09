<script lang="ts">
  import { format } from 'date-fns';
  import { store } from '../store.svelte';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import MiniMonth from './MiniMonth.svelte';
  import TaskPanel from './TaskPanel.svelte';

  const week = $derived({ start: store.range.start.getTime(), end: store.range.end.getTime() });
  const counts = $derived.by(() => {
    const m = new Map<string, number>();
    for (const e of store.events) m.set(e.calendarId, (m.get(e.calendarId) ?? 0) + 1);
    return m;
  });
</script>

<aside class="sb" aria-label="Sidebar">
  <div class="brand">
    <Logo size={22} />
    <span class="name">Plan</span>
    {#if store.google.connected}
      <button
        class="icon-btn sm"
        class:err={!!store.google.error}
        aria-label="Sync Google Calendar"
        title={store.google.error ?? (store.google.busy ? 'Syncing…' : store.settings.googleLastSync ? `Synced ${format(store.settings.googleLastSync, 'HH:mm')} — click to sync now` : 'Sync Google Calendar')}
        disabled={store.google.busy}
        onclick={() => void store.syncGoogle()}
      >
        <Icon name="repeat" size={16} />
      </button>
    {/if}
    <button class="icon-btn sm" aria-label="Settings" title="Settings" onclick={() => (ui.settings = true)}>
      <Icon name="sliders" size={16} />
    </button>
  </div>

  <div class="mm"><MiniMonth value={store.cursor} range={store.settings.view === 'month' ? undefined : week} onpick={(d) => store.goTo(d)} /></div>

  <div class="cals" role="group" aria-label="Calendars">
    {#each store.calendars as c (c.id)}
      <button
        class="cal"
        style="--c:{c.color}"
        role="checkbox"
        aria-checked={c.visible}
        onclick={() => store.updateCalendar(c.id, { visible: !c.visible })}
      >
        <span class="box" class:on={c.visible}>{#if c.visible}<Icon name="check" size={11} />{/if}</span>
        <span class="cn">{c.name}</span>
        <span class="cc num">{counts.get(c.id) ?? 0}</span>
      </button>
    {/each}
  </div>

  <TaskPanel />
</aside>

<style>
  .sb { width: 288px; flex: none; display: flex; flex-direction: column; background: var(--surface-2); border-right: 1px solid var(--border); min-height: 0; }
  .brand { display: flex; align-items: center; gap: var(--s2); padding: var(--s3) var(--s3) var(--s2) var(--s4); }
  .icon-btn.err { color: var(--danger); }
  .icon-btn:disabled { opacity: 0.5; }
  .name { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; margin-right: auto; }
  .mm { padding: 0 var(--s3) var(--s2); }
  .cals { display: flex; flex-direction: column; padding: 0 var(--s2) var(--s2); max-height: 150px; overflow-y: auto; }
  .cal { display: flex; align-items: center; gap: var(--s3); height: 28px; padding: 0 var(--s2); border: 0; border-radius: var(--r-sm); background: transparent; text-align: left; }
  .cal:hover { background: var(--hover); }
  .box { width: 16px; height: 16px; border-radius: 5px; border: 1.75px solid var(--c); display: grid; place-items: center; color: var(--accent-fg); flex: none; }
  .box.on { background: var(--c); }
  .cn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cc { color: var(--text-3); font-size: 11px; }
</style>
