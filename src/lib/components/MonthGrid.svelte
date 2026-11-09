<script lang="ts">
  import { onMount } from 'svelte';
  import { format } from 'date-fns';
  import { anchorOf, track } from '../drag';
  import { store, shiftWall } from '../store.svelte';
  import { addDays, DAY, dayStart, fmtTime } from '../time';
  import type { Occ } from '../types';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  const days = $derived(store.range.days);
  const hour24 = $derived(store.settings.hour24);
  const todayMs = $derived(dayStart(store.now));
  const curMonth = $derived(store.cursor.getMonth());
  const taskHover = $derived(ui.taskDrag?.hover ?? null);

  let gridEl: HTMLDivElement | undefined = $state();
  let maxChips = $state(3);
  let drag = $state.raw<{ occ: Occ; x: number; y: number; over: number | null } | null>(null);

  const byDay = $derived.by(() => {
    const m = new Map<number, Occ[]>();
    for (const d of days) m.set(dayStart(d), []);
    for (const o of store.occs) {
      let t = dayStart(o.start);
      const last = o.end > o.start ? o.end - 1 : o.start;
      while (t <= last) {
        m.get(t)?.push(o);
        t = dayStart(addDays(t, 1));
      }
    }
    for (const list of m.values()) {
      list.sort((a, b) => Number(b.ev.allDay) - Number(a.ev.allDay) || a.start - b.start);
    }
    return m;
  });

  onMount(() => {
    if (!gridEl) return;
    const ro = new ResizeObserver(() => {
      if (!gridEl) return;
      const cellH = gridEl.clientHeight / 6;
      maxChips = Math.max(1, Math.floor((cellH - 30) / 20));
    });
    ro.observe(gridEl);
    return () => ro.disconnect();
  });

  const colorOf = (id: string): string => store.calMap.get(id)?.color ?? '#4a5be8';
  const dayAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop="month"]');
    return el ? Number(el.dataset.day) : null;
  };

  function cellDown(e: PointerEvent, dayMs: number) {
    if (e.button !== 0) return;
    ui.closeEditors();
    store.selectedKey = null;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    track(e, {
      threshold: 99999,
      onMove: () => {},
      onEnd: () => {
        ui.editor = {
          occ: null,
          draft: { start: dayMs, end: addDays(dayMs, 1).getTime(), allDay: true, calendarId: store.defaultCalendarId() },
          anchor: { x: r.left, y: r.top, w: r.width, h: r.height }
        };
      }
    });
  }

  function chipDown(e: PointerEvent, occ: Occ, grabDay: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.selectedKey = occ.key;
    const anchor = anchorOf(e.currentTarget as Element);
    track(e, {
      threshold: 4,
      onMove: (ev) => {
        drag = { occ, x: ev.clientX, y: ev.clientY, over: dayAt(ev.clientX, ev.clientY) };
      },
      onEnd: (ev, moved) => {
        const over = dayAt(ev.clientX, ev.clientY);
        drag = null;
        if (!moved) {
          ui.editor = { occ, draft: null, anchor };
          return;
        }
        if (over === null) return;
        const dd = Math.round((over - grabDay) / DAY);
        if (dd === 0) return;
        ui.closeEditors();
        void store.moveOccurrence(occ, shiftWall(occ.start, dd, 0), shiftWall(occ.end, dd, 0));
      },
      onCancel: () => (drag = null)
    });
  }

  function chipKey(e: KeyboardEvent, occ: Occ) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      store.selectedKey = occ.key;
      ui.editor = { occ, draft: null, anchor: anchorOf(e.currentTarget as Element) };
    }
  }
</script>

<div class="mg">
  <div class="wk">
    {#each days.slice(0, 7) as d (d.getTime())}
      <div class="wd">{format(d, 'EEE')}</div>
    {/each}
  </div>
  <div class="grid" bind:this={gridEl}>
    {#each days as d (d.getTime())}
      {@const ds = dayStart(d)}
      {@const list = byDay.get(ds) ?? []}
      {@const over = drag?.over === ds || (taskHover?.kind === 'month' && taskHover.dayMs === ds)}
      {@const shown = list.length > maxChips ? maxChips - 1 : list.length}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="cell"
        class:out={d.getMonth() !== curMonth}
        class:today={ds === todayMs}
        class:over
        data-drop="month"
        data-day={ds}
        onpointerdown={(e) => cellDown(e, ds)}
      >
        <button
          class="dn num"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => {
            store.goTo(d);
            store.setView('day');
          }}
          aria-label={format(d, 'EEEE d MMMM')}
        >
          {d.getDate() === 1 ? format(d, 'd MMM') : format(d, 'd')}
        </button>
        {#each list.slice(0, shown) as o (o.key)}
          {@const ev = o.ev}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="chip"
            class:allday={ev.allDay || o.end - o.start >= DAY}
            class:sel={store.selectedKey === o.key}
            class:done={ev.done}
            class:ghost={drag?.occ.key === o.key}
            style="--c:{colorOf(ev.calendarId)}"
            role="button"
            tabindex="0"
            onpointerdown={(e) => chipDown(e, o, ds)}
            onkeydown={(e) => chipKey(e, o)}
          >
            {#if ev.taskId}
              <button
                class="cb"
                class:on={ev.done}
                aria-label={ev.done ? 'Mark task not done' : 'Mark task done'}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  store.toggleEventDone(ev);
                }}
              >
                {#if ev.done}<Icon name="check" size={9} />{/if}
              </button>
            {:else if !ev.allDay && o.end - o.start < DAY}
              <span class="dot"></span>
            {/if}
            {#if !ev.allDay && o.end - o.start < DAY}<span class="tm num">{fmtTime(o.start, hour24)}</span>{/if}
            <span class="t">{ev.title || 'Untitled'}</span>
          </div>
        {/each}
        {#if list.length > shown}
          <button
            class="more"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => {
              store.goTo(d);
              store.setView('day');
            }}>+{list.length - shown} more</button
          >
        {/if}
      </div>
    {/each}
  </div>
</div>

{#if drag}
  <div class="ghost-label" style="transform:translate({drag.x + 12}px,{drag.y + 8}px);--c:{colorOf(drag.occ.ev.calendarId)}">
    {drag.occ.ev.title || 'Untitled'}
  </div>
{/if}

<style>
  .mg { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--surface); }
  .wk { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--border); }
  .wd {
    padding: var(--s2) var(--s3); font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
    text-transform: uppercase; color: var(--text-3);
  }
  .grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(6, minmax(0, 1fr)); }
  .cell {
    min-width: 0; min-height: 0; overflow: hidden; padding: 2px 4px 0; border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 2px;
  }
  .cell:nth-child(7n) { border-right: 0; }
  .cell.out { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
  .cell.out .dn { color: var(--text-3); }
  .cell.over { background: var(--accent-soft); }
  .dn {
    align-self: flex-start; height: 22px; min-width: 22px; padding: 0 5px; margin: 2px 0 0 0; border: 0;
    border-radius: 11px; background: transparent; font-weight: 600; color: var(--text-2); font-size: 12px;
  }
  .dn:hover { background: var(--hover); }
  .cell.today .dn { background: var(--accent); color: var(--accent-fg); }
  .chip {
    display: flex; align-items: center; gap: 4px; height: 18px; flex: none; padding: 0 6px; border-radius: 4px;
    color: var(--text); font-size: 12px; min-width: 0;
  }
  .chip:hover { background: var(--hover); }
  .chip.allday {
    background: color-mix(in srgb, var(--c) 22%, var(--surface)); color: color-mix(in srgb, var(--c) 60%, var(--text)); font-weight: 600;
  }
  .chip.allday:hover { background: color-mix(in srgb, var(--c) 30%, var(--surface)); }
  .chip.sel { box-shadow: 0 0 0 2px var(--c); }
  .chip.ghost { opacity: 0.35; }
  .chip.done .t { text-decoration: line-through; opacity: 0.6; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c); flex: none; }
  .tm { color: var(--text-2); font-size: 11px; flex: none; }
  .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .more { align-self: flex-start; border: 0; background: transparent; color: var(--text-2); font-size: 11px; font-weight: 600; padding: 0 6px; height: 16px; border-radius: 4px; }
  .more:hover { background: var(--hover); color: var(--text); }
  .cb {
    flex: none; width: 12px; height: 12px; padding: 0; display: grid; place-items: center; border-radius: 50%;
    border: 1.5px solid var(--c); background: transparent; color: var(--accent-fg);
  }
  .cb.on { background: var(--c); }
  .ghost-label {
    position: fixed; left: 0; top: 0; z-index: 90; pointer-events: none; padding: 3px 10px; border-radius: 6px;
    background: color-mix(in srgb, var(--c) 28%, var(--surface)); color: color-mix(in srgb, var(--c) 60%, var(--text));
    font-weight: 600; box-shadow: var(--sh-drag); will-change: transform; max-width: 240px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
