<script lang="ts">
  import { format } from 'date-fns';
  import { onMount } from 'svelte';
  import { fuzzy } from '../fuzzy';
  import { nextOccurrence } from '../recur';
  import { store } from '../store.svelte';
  import { dayStart, fmtTime, relDayLabel, parseDay } from '../time';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  interface Item {
    id: string;
    kind: 'action' | 'event' | 'task';
    label: string;
    hint: string;
    icon: string;
    color?: string;
    keys?: string[];
    run: () => void;
  }

  let query = $state('');
  let sel = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const centerAnchor = () => ({ x: window.innerWidth / 2 - 190, y: 120, w: 0, h: 0 });
  const close = () => (ui.palette = false);
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' } as const;

  const actions = $derived.by((): Item[] => {
    const s = store.settings;
    const a: Item[] = [
      { id: 'a:today', kind: 'action', label: 'Go to today', hint: '', keys: ['T'], icon: 'today', run: () => store.today() },
      { id: 'a:day', kind: 'action', label: 'Day view', hint: '', keys: ['1'], icon: 'calendar', run: () => store.setView('day') },
      { id: 'a:week', kind: 'action', label: 'Week view', hint: '', keys: ['2'], icon: 'calendar', run: () => store.setView('week') },
      { id: 'a:month', kind: 'action', label: 'Month view', hint: '', keys: ['3'], icon: 'calendar', run: () => store.setView('month') },
      { id: 'a:next', kind: 'action', label: 'Next period', hint: '', keys: ['→'], icon: 'chev-right', run: () => store.step(1) },
      { id: 'a:prev', kind: 'action', label: 'Previous period', hint: '', keys: ['←'], icon: 'chev-left', run: () => store.step(-1) },
      {
        id: 'a:newev', kind: 'action', label: 'New event', hint: '', keys: ['N'], icon: 'plus',
        run: () => newEvent()
      },
      {
        id: 'a:newtask', kind: 'action', label: 'New task', hint: '', keys: ['A'], icon: 'tasks',
        run: () => focusTaskInput()
      },
      { id: 'a:quick', kind: 'action', label: 'Quick add…', hint: 'event or task from a sentence', keys: ['Q'], icon: 'bolt', run: () => (ui.quickAdd = true) },
      { id: 'a:sidebar', kind: 'action', label: s.sidebar ? 'Hide sidebar' : 'Show sidebar', hint: '', keys: ['['], icon: 'sidebar', run: () => store.setSetting('sidebar', !s.sidebar) },
      { id: 'a:theme', kind: 'action', label: `Theme: ${s.theme} → ${nextTheme[s.theme]}`, hint: 'cycle system / light / dark', icon: s.theme === 'dark' ? 'sun' : 'moon', run: () => store.setSetting('theme', nextTheme[s.theme]) },
      { id: 'a:weekends', kind: 'action', label: s.showWeekends ? 'Hide weekends' : 'Show weekends', hint: '', icon: 'calendar', run: () => store.setSetting('showWeekends', !s.showWeekends) },
      { id: 'a:24h', kind: 'action', label: s.hour24 ? 'Use 12-hour clock' : 'Use 24-hour clock', hint: '', icon: 'clock', run: () => store.setSetting('hour24', !s.hour24) },
      { id: 'a:done', kind: 'action', label: s.showDone ? 'Hide completed tasks' : 'Show completed tasks', hint: '', icon: 'check', run: () => store.setSetting('showDone', !s.showDone) },
      ...(store.google.connected
        ? [{ id: 'a:gsync', kind: 'action' as const, label: 'Sync Google Calendar now', hint: '', icon: 'repeat', run: () => void store.syncGoogle() }]
        : []),
      { id: 'a:undo', kind: 'action', label: 'Undo last change', hint: '', keys: ['Ctrl', 'Z'], icon: 'repeat', run: () => doUndo() },
      { id: 'a:keys', kind: 'action', label: 'Keyboard shortcuts', hint: '', keys: ['?'], icon: 'keyboard', run: () => (ui.shortcuts = true) },
      { id: 'a:settings', kind: 'action', label: 'Settings', hint: '', keys: ['Ctrl', ','], icon: 'sliders', run: () => (ui.settings = true) }
    ];
    for (const c of store.calendars) {
      a.push({
        id: `a:cal:${c.id}`, kind: 'action', label: `${c.visible ? 'Hide' : 'Show'} calendar “${c.name}”`, hint: '',
        icon: 'calendar', color: c.color, run: () => store.updateCalendar(c.id, { visible: !c.visible })
      });
    }
    return a;
  });

  function doUndo() {
    const l = store.undo();
    ui.toast(l ? `Undid: ${l}` : 'Nothing to undo');
  }
  function newEvent() {
    const d = new Date(store.cursor);
    const now = new Date();
    const h = dayStart(d) === dayStart(now) ? now.getHours() + 1 : 9;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.min(h, 22), 0).getTime();
    ui.editor = {
      occ: null,
      draft: { start, end: start + store.settings.defaultLen * 60_000, allDay: false, calendarId: store.defaultCalendarId() },
      anchor: centerAnchor()
    };
  }
  function focusTaskInput() {
    if (!store.settings.sidebar) store.setSetting('sidebar', true);
    setTimeout(() => document.getElementById('task-input')?.focus(), 30);
  }

  const dataItems = $derived.by((): Item[] => {
    const out: Item[] = [];
    for (const e of store.events) {
      if (!e.title.trim()) continue;
      const next = nextOccurrence(e, 0) ?? e.start;
      const when = e.allDay ? format(next, 'EEE d MMM yyyy') : `${format(next, 'EEE d MMM yyyy')} · ${fmtTime(next, store.settings.hour24)}`;
      out.push({
        id: `e:${e.id}`, kind: 'event', label: e.title, hint: e.rrule ? `${when} · repeats` : when, icon: 'calendar',
        color: store.calMap.get(e.calendarId)?.color,
        run: () => {
          const t = nextOccurrence(e, store.now - (e.end - e.start)) ?? e.start;
          store.goTo(new Date(t));
          const occ = { key: e.rrule ? `${e.id}@${t}` : e.id, ev: e, start: t, end: t + (e.end - e.start), recurring: !!e.rrule, origStart: t };
          store.selectedKey = occ.key;
          ui.editor = { occ, draft: null, anchor: centerAnchor() };
        }
      });
    }
    for (const t of store.tasks) {
      if (!t.title.trim()) continue;
      out.push({
        id: `t:${t.id}`, kind: 'task', label: t.title,
        hint: t.done ? 'completed' : t.due ? relDayLabel(parseDay(t.due), new Date(store.now)) : 'no date',
        icon: t.done ? 'check' : 'tasks',
        run: () => (ui.taskEditor = { id: t.id, anchor: centerAnchor() })
      });
    }
    return out;
  });

  const results = $derived.by((): { item: Item; idx: number[] }[] => {
    const q = query.trim();
    if (!q) {
      const upcoming = store.events
        .filter((e) => e.end > store.now && !e.rrule && e.title.trim())
        .sort((a, b) => a.start - b.start)
        .slice(0, 5)
        .map((e) => `e:${e.id}`);
      const openTasks = store.tasks.filter((t) => !t.done && !t.parentId).slice(0, 5).map((t) => `t:${t.id}`);
      const pick = new Set([...upcoming, ...openTasks]);
      return [...actions, ...dataItems.filter((d) => pick.has(d.id))].map((item) => ({ item, idx: [] }));
    }
    const scored: { item: Item; idx: number[]; score: number }[] = [];
    for (const item of [...actions, ...dataItems]) {
      const h = fuzzy(q, item.label);
      if (h) scored.push({ item, idx: h.idx, score: h.score + (item.kind === 'action' ? 6 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 40);
  });

  $effect(() => {
    void query;
    sel = 0;
  });
  $effect(() => {
    const row = listEl?.querySelector<HTMLElement>(`[data-i="${sel}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  });
  onMount(() => inputEl?.focus());

  function run(i: number) {
    const r = results[i];
    if (!r) return;
    close();
    queueMicrotask(r.item.run);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(results.length - 1, sel + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(sel);
    }
  }
  function parts(label: string, idx: number[]): { t: string; m: boolean }[] {
    if (!idx.length) return [{ t: label, m: false }];
    const set = new Set(idx);
    const out: { t: string; m: boolean }[] = [];
    for (let i = 0; i < label.length; i++) {
      const m = set.has(i);
      const last = out[out.length - 1];
      if (last && last.m === m) last.t += label[i];
      else out.push({ t: label[i], m });
    }
    return out;
  }
  const kindLabel = { action: 'Action', event: 'Event', task: 'Task' } as const;
</script>

<div class="scrim" role="presentation" onpointerdown={close}></div>
<div class="pal card" role="dialog" aria-label="Command palette" aria-modal="true">
  <div class="in">
    <Icon name="search" size={17} />
    <input
      bind:this={inputEl}
      bind:value={query}
      placeholder="Search events, tasks and actions…"
      aria-label="Search"
      spellcheck="false"
      autocomplete="off"
      onkeydown={onKey}
    />
    <span class="kbd">Esc</span>
  </div>
  <div class="list" bind:this={listEl} role="listbox" aria-label="Results">
    {#each results as r, i (r.item.id)}
      <button
        class="it"
        class:sel={i === sel}
        data-i={i}
        role="option"
        aria-selected={i === sel}
        onpointermove={() => (sel = i)}
        onclick={() => run(i)}
      >
        <span class="ico" style={r.item.color ? `color:${r.item.color}` : ''}><Icon name={r.item.icon} size={16} /></span>
        <span class="lb">{#each parts(r.item.label, r.idx) as p, pi (pi)}{#if p.m}<mark>{p.t}</mark>{:else}{p.t}{/if}{/each}</span>
        {#if r.item.hint}<span class="hi">{r.item.hint}</span>{/if}
        {#if r.item.keys}<span class="ks">{#each r.item.keys as k (k)}<span class="kbd">{k}</span>{/each}</span>{:else}<span class="kd">{kindLabel[r.item.kind]}</span>{/if}
      </button>
    {:else}
      <div class="none">No results for “{query}”</div>
    {/each}
  </div>
</div>

<style>
  .pal { position: fixed; z-index: 60; top: 14vh; left: 0; right: 0; margin: 0 auto; width: 600px; max-width: calc(100vw - 32px); overflow: hidden; animation: pop 100ms ease-out; }
  .in { display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s4); height: 52px; border-bottom: 1px solid var(--border); color: var(--text-3); }
  .in input { flex: 1; height: 100%; border: 0; outline: none; background: transparent; font-size: 15px; color: var(--text); }
  .list { max-height: min(420px, 60vh); overflow-y: auto; padding: var(--s2); }
  .it { display: flex; align-items: center; gap: var(--s3); width: 100%; height: 36px; padding: 0 var(--s3); border: 0; border-radius: var(--r); background: transparent; text-align: left; }
  .it.sel { background: var(--accent-soft); }
  .ico { color: var(--text-3); display: grid; place-items: center; }
  .it.sel .ico { color: var(--accent); }
  .lb { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lb mark { background: transparent; color: var(--accent); font-weight: 700; }
  .hi { flex: 1; min-width: 0; color: var(--text-3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ks { display: flex; gap: 4px; margin-left: auto; }
  .kd { margin-left: auto; font-size: 11px; color: var(--text-3); }
  .it > .lb + .ks, .it > .lb + .kd { margin-left: auto; }
  .none { padding: var(--s6); text-align: center; color: var(--text-3); }
</style>
