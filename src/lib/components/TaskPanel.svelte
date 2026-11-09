<script lang="ts">
  import { format } from 'date-fns';
  import { anchorOf, track } from '../drag';
  import { parseTaskText } from '../quickparse';
  import { store } from '../store.svelte';
  import { addDays, clamp, dayKey, dayStart, minutesOfDay, msAt, parseDay, relDayLabel, MIN } from '../time';
  import type { Task } from '../types';
  import { ui, type DropHover } from '../ui.svelte';
  import Icon from './Icon.svelte';
  import VirtualList from './VirtualList.svelte';

  type Row =
    | { key: string; h: number; kind: 'head'; label: string; count: number }
    | { key: string; h: number; kind: 'task'; task: Task; kids: Task[] }
    | { key: string; h: number; kind: 'sub'; task: Task }
    | { key: string; h: number; kind: 'empty' };

  let input = $state('');
  /** tasks completed during this session stay visible (struck through) so a mis-click is easy to revert */
  let session = $state.raw<Set<string>>(new Set());

  const todayKey = $derived(dayKey(store.now));
  const tomorrowKey = $derived(dayKey(addDays(store.now, 1)));
  const weekKey = $derived(dayKey(addDays(store.now, 7)));
  const filter = $derived(store.settings.taskFilter);
  const parsed = $derived(input.trim() ? parseTaskText(input, new Date(store.now)) : null);

  const rows = $derived.by((): Row[] => {
    const showDone = store.settings.showDone;
    const groups: Record<string, Task[]> = {};
    const push = (g: string, t: Task) => (groups[g] ??= []).push(t);
    for (const t of store.tasks) {
      if (t.parentId) continue;
      if (t.done && !showDone && !session.has(t.id)) continue;
      if (t.done) {
        push('Completed', t);
        continue;
      }
      const d = t.due;
      if (filter === 'today' && !(d && d <= todayKey)) continue;
      if (filter === 'upcoming' && !(d && d > todayKey)) continue;
      push(!d ? 'No date' : d < todayKey ? 'Overdue' : d === todayKey ? 'Today' : d === tomorrowKey ? 'Tomorrow' : d <= weekKey ? 'Next 7 days' : 'Later', t);
    }
    const order = ['Overdue', 'Today', 'Tomorrow', 'Next 7 days', 'Later', 'No date', 'Completed'];
    const out: Row[] = [];
    for (const g of order) {
      const list = groups[g];
      if (!list?.length) continue;
      list.sort((a, b) =>
        g === 'Completed'
          ? (b.doneAt ?? 0) - (a.doneAt ?? 0)
          : b.priority - a.priority || (a.due ?? '9').localeCompare(b.due ?? '9') || a.sort - b.sort
      );
      if (filter !== 'today' || g === 'Overdue' || list.length) out.push({ key: `h:${g}`, h: 30, kind: 'head', label: g, count: list.length });
      for (const t of list) {
        const kids = store.childrenByTask.get(t.id) ?? [];
        out.push({ key: t.id, h: 38, kind: 'task', task: t, kids });
        for (const k of kids) out.push({ key: k.id, h: 32, kind: 'sub', task: k });
      }
    }
    if (!out.length) out.push({ key: 'empty', h: 120, kind: 'empty' });
    return out;
  });

  function add() {
    const p = parseTaskText(input, new Date());
    if (!p.title) return;
    store.createTask({ title: p.title, due: p.due, priority: p.priority, estimate: p.estimate });
    input = '';
  }

  function toggle(t: Task) {
    if (!t.done) session = new Set(session).add(t.id);
    store.toggleTask(t.id);
  }

  const prioColor = (p: number): string => (p === 3 ? 'var(--p3)' : p === 2 ? 'var(--p2)' : p === 1 ? 'var(--p1)' : 'var(--text-3)');

  function blockLabel(t: Task): string | null {
    const evs = store.eventsByTask.get(t.id);
    if (!evs?.length) return null;
    const upcoming = evs.filter((e) => e.end > store.now).sort((a, b) => a.start - b.start)[0] ?? evs[evs.length - 1];
    const d = dayStart(upcoming.start);
    const prefix = d === dayStart(store.now) ? 'Today' : format(upcoming.start, 'EEE');
    return upcoming.allDay ? prefix : `${prefix} ${format(upcoming.start, store.settings.hour24 ? 'HH:mm' : 'h:mm a')}`;
  }

  // ── drag a task onto the calendar ─────────────────────────────
  function hit(x: number, y: number, task: Task): DropHover | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    if (!el) return null;
    const dayMs = Number(el.dataset.day);
    const kind = el.dataset.drop;
    if (kind === 'time') {
      const r = el.getBoundingClientRect();
      const min = clamp((y - r.top) / (store.settings.hourPx / 60), 0, 1440 - 15);
      const start = msAt(dayMs, Math.floor(min / 15) * 15);
      const end = Math.min(start + store.blockLength(task), msAt(dayMs, 1440));
      return { kind: 'time', dayMs, start, end };
    }
    if (kind === 'allday') return { kind: 'allday', dayMs };
    if (kind === 'month') return { kind: 'month', dayMs };
    return null;
  }

  function rowDown(e: PointerEvent, t: Task) {
    if (e.button !== 0) return;
    const rowEl = e.currentTarget as HTMLElement;
    track(e, {
      threshold: 5,
      scroller: () => document.querySelector<HTMLElement>('.tg-scroll'),
      onStart: () => ui.closeEditors(),
      onMove: (ev) => {
        ui.taskDrag = { task: t, x: ev.clientX, y: ev.clientY, hover: hit(ev.clientX, ev.clientY, t) };
      },
      onEnd: (ev, moved) => {
        if (!moved) {
          ui.editor = null;
          ui.taskEditor = { id: t.id, anchor: anchorOf(rowEl) };
          return;
        }
        const h = hit(ev.clientX, ev.clientY, t);
        ui.taskDrag = null;
        if (!h) return;
        if (h.kind === 'time') store.timeBlock(t, h.start, Math.max(h.end, h.start + 15 * MIN), false);
        else store.timeBlock(t, h.dayMs, addDays(h.dayMs, 1).getTime(), true);
        const when = h.kind === 'time' ? format(h.start, 'EEE d MMM, HH:mm') : format(h.dayMs, 'EEE d MMM');
        ui.toast(`Time-blocked “${t.title}” · ${when}`, { label: 'Undo', run: () => void store.undo() });
        if (h.kind !== 'time' && store.settings.view === 'month') return;
        store.selectedKey = null;
      },
      onCancel: () => (ui.taskDrag = null)
    });
  }

  function rowKey(e: KeyboardEvent, t: Task, el: HTMLElement) {
    if (e.key === 'Enter') {
      e.preventDefault();
      ui.editor = null;
      ui.taskEditor = { id: t.id, anchor: anchorOf(el) };
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(t);
    }
  }
  void minutesOfDay;
</script>

<section class="tp" aria-label="Tasks">
  <div class="hd">
    <h2>Tasks</h2>
    <div class="seg" role="group" aria-label="Task filter">
      {#each [['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']] as [id, label] (id)}
        <button aria-pressed={filter === id} onclick={() => store.setSetting('taskFilter', id as 'today' | 'upcoming' | 'all')}>{label}</button>
      {/each}
    </div>
    <button
      class="icon-btn sm"
      class:on={store.settings.showDone}
      aria-pressed={store.settings.showDone}
      aria-label="Show completed tasks"
      title="Show completed"
      onclick={() => {
        session = new Set();
        store.setSetting('showDone', !store.settings.showDone);
      }}><Icon name="check" size={15} /></button
    >
  </div>

  <div class="add">
    <Icon name="plus" size={15} />
    <input
      id="task-input"
      placeholder="Add task…  e.g. “Send invoice fri !2 ~30m”"
      aria-label="Add task"
      autocomplete="off"
      spellcheck="false"
      bind:value={input}
      onkeydown={(e) => {
        if (e.key === 'Enter') add();
        else if (e.key === 'Escape') {
          input = '';
          e.currentTarget.blur();
        }
      }}
    />
  </div>
  {#if parsed && parsed.chips.length}
    <div class="chips">
      {#each parsed.chips as c (c)}<span class="pc">{c}</span>{/each}
    </div>
  {/if}

  <VirtualList items={rows} label="Task list">
    {#snippet row(r)}
      {#if r.kind === 'head'}
        <div class="gh" class:od={r.label === 'Overdue'}><span>{r.label}</span><span class="n num">{r.count}</span></div>
      {:else if r.kind === 'empty'}
        <div class="empty">
          <Icon name="tasks" size={22} />
          <p>{filter === 'today' ? 'Nothing due today' : filter === 'upcoming' ? 'Nothing upcoming' : 'No tasks yet'}</p>
          <p class="sub">Drag a task onto the calendar to time-block it.</p>
        </div>
      {:else}
        {@const t = r.task}
        {@const bl = blockLabel(t)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="tr"
          class:sub={r.kind === 'sub'}
          class:done={t.done}
          role="button"
          tabindex="0"
          aria-label={t.title}
          onpointerdown={(e) => rowDown(e, t)}
          onkeydown={(e) => rowKey(e, t, e.currentTarget)}
        >
          <button
            class="cbx"
            class:on={t.done}
            style="--pc:{prioColor(t.priority)}"
            aria-label={t.done ? 'Mark not done' : 'Mark done'}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              toggle(t);
            }}
          >
            {#if t.done}<Icon name="check" size={11} />{/if}
          </button>
          <span class="tt">{t.title}</span>
          {#if r.kind === 'task' && r.kids.length}
            <span class="meta num" title="Subtasks">{r.kids.filter((k) => k.done).length}/{r.kids.length}</span>
          {/if}
          {#if bl}
            <span class="meta sched num"><Icon name="clock" size={11} />{bl}</span>
          {/if}
          {#if t.due && !t.done}
            <span class="meta num" class:od={t.due < todayKey} class:td={t.due === todayKey}>{relDayLabel(parseDay(t.due), new Date(store.now))}</span>
          {/if}
        </div>
      {/if}
    {/snippet}
  </VirtualList>
</section>

<style>
  .tp { flex: 1; min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); }
  .hd { display: flex; align-items: center; gap: var(--s2); padding: var(--s3) var(--s3) var(--s2) var(--s4); }
  h2 { font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); margin-right: auto; }
  .hd .seg button { padding: 0 var(--s2); font-size: 12px; height: 24px; }
  .add {
    display: flex; align-items: center; gap: var(--s2); margin: 0 var(--s3) var(--s1); padding: 0 var(--s2); height: 32px;
    border-radius: var(--r); background: var(--surface); border: 1px solid var(--border-strong); color: var(--text-3);
  }
  .add:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); color: var(--accent); }
  .add input { flex: 1; min-width: 0; height: 30px; border: 0; outline: none; background: transparent; color: var(--text); }
  .add input::placeholder { color: var(--text-3); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 2px var(--s3) var(--s1); }
  .pc { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }

  .gh {
    display: flex; align-items: center; justify-content: space-between; padding: 10px var(--s4) 0 var(--s4); height: 100%;
    font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3);
  }
  .gh.od { color: var(--danger); }
  .n { font-weight: 600; }
  .tr {
    display: flex; align-items: center; gap: var(--s2); height: 100%; margin: 0 var(--s2); padding: 0 var(--s2) 0 var(--s2);
    border-radius: var(--r-sm); cursor: grab;
  }
  .tr:hover { background: var(--hover); }
  .tr.sub { padding-left: 30px; }
  .tt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tr.sub .tt { font-size: 12.5px; color: var(--text-2); }
  .tr.done .tt { text-decoration: line-through; color: var(--text-3); }
  .cbx {
    flex: none; width: 18px; height: 18px; padding: 0; display: grid; place-items: center; border-radius: 50%;
    border: 1.75px solid var(--pc); background: transparent; color: var(--accent-fg);
  }
  .cbx:hover { background: color-mix(in srgb, var(--pc) 22%, transparent); }
  .cbx.on { background: var(--pc); }
  .tr.sub .cbx { width: 16px; height: 16px; }
  .meta { flex: none; font-size: 11px; color: var(--text-3); display: inline-flex; align-items: center; gap: 3px; }
  .meta.td { color: var(--accent); font-weight: 600; }
  .meta.od { color: var(--danger); font-weight: 600; }
  .meta.sched { color: var(--accent); }
  .empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-top: 28px; color: var(--text-3); text-align: center; }
  .empty p { color: var(--text-2); font-weight: 600; margin-top: 4px; }
  .empty .sub { font-weight: 400; font-size: 12px; color: var(--text-3); max-width: 200px; margin-top: 0; }
</style>
