<script lang="ts">
  import { onMount } from 'svelte';
  import { format } from 'date-fns';
  import { anchorOf, track } from '../drag';
  import { layoutDay, type Placed } from '../layout';
  import { store, shiftWall } from '../store.svelte';
  import { clamp, DAY, dayStart, fmtHourLabel, fmtTime, minutesOfDay, MIN, msAt, snap, addDays } from '../time';
  import type { Occ } from '../types';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  interface Seg {
    occ: Occ;
    start: number;
    end: number;
    first: boolean;
    last: boolean;
  }
  interface Preview {
    start: number;
    end: number;
    key: string | null;
    calendarId: string;
    title: string;
    allDay: boolean;
  }

  const days = $derived(store.range.days);
  const n = $derived(days.length);
  const hourPx = $derived(store.settings.hourPx);
  const ppm = $derived(hourPx / 60);
  const hour24 = $derived(store.settings.hour24);
  const todayMs = $derived(dayStart(store.now));

  let scroller: HTMLDivElement | undefined = $state();
  let colsEl: HTMLDivElement | undefined = $state();
  let adEl: HTMLDivElement | undefined = $state();

  /** live preview during create / move / resize */
  let preview = $state.raw<Preview | null>(null);
  let adShift = $state.raw<{ key: string; dx: number } | null>(null);

  const colorOf = (calendarId: string): string => store.calMap.get(calendarId)?.color ?? '#4a5be8';

  // ── data → segments ───────────────────────────────────────────
  function segsFor(start: number, end: number, dayMs: number, occ: Occ): Seg | null {
    const de = dayStart(addDays(dayMs, 1));
    if (start >= de || end <= dayMs) return null;
    return { occ, start: Math.max(start, dayMs), end: Math.min(end, de), first: start >= dayMs, last: end <= de };
  }

  const timed = $derived.by(() => {
    const out = new Map<number, Placed<Seg>[]>();
    const list = store.occs.filter((o) => !o.ev.allDay);
    for (const d of days) {
      const ds = dayStart(d);
      const segs: Seg[] = [];
      for (const o of list) {
        const s = segsFor(o.start, o.end, ds, o);
        if (s) segs.push(s);
      }
      out.set(ds, layoutDay(segs));
    }
    return out;
  });

  const allDay = $derived.by(() => {
    const first = dayStart(days[0]);
    const idxOf = (ms: number): number => days.findIndex((d) => dayStart(d) <= ms && ms < dayStart(addDays(d, 1)));
    const items: { occ: Occ; s: number; e: number }[] = [];
    for (const o of store.occs) {
      if (!o.ev.allDay) continue;
      let s = idxOf(o.start);
      if (s === -1) s = o.start < first ? 0 : -1;
      let e = idxOf(o.end - 1);
      if (e === -1) e = o.end - 1 >= dayStart(days[n - 1]) ? n - 1 : -1;
      if (s === -1 || e === -1 || e < s) continue;
      items.push({ occ: o, s, e });
    }
    items.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));
    const lanes: number[] = [];
    const placed = items.map((it) => {
      let lane = lanes.findIndex((end) => end < it.s);
      if (lane === -1) lane = lanes.length;
      lanes[lane] = it.e;
      return { ...it, lane };
    });
    return { placed, lanes: Math.max(lanes.length, 1) };
  });

  const draft = $derived(ui.editor?.draft ?? null);
  const taskHover = $derived(ui.taskDrag?.hover ?? null);

  // ── geometry helpers ──────────────────────────────────────────
  function colAt(x: number): number {
    if (!colsEl) return 0;
    const r = colsEl.getBoundingClientRect();
    return clamp(Math.floor(((x - r.left) / r.width) * n), 0, n - 1);
  }
  function minAt(y: number): number {
    if (!colsEl) return 0;
    return clamp((y - colsEl.getBoundingClientRect().top) / ppm, 0, 1440);
  }
  function anchorFor(idx: number, s: number, e: number) {
    const r = colsEl!.getBoundingClientRect();
    const w = r.width / n;
    const sm = minutesOfDay(s);
    const em = e - s >= DAY ? 1440 : Math.max(sm + 15, minutesOfDay(e) || 1440);
    return { x: r.left + idx * w, y: r.top + sm * ppm, w, h: (em - sm) * ppm };
  }
  const dayDiff = (a: Date, b: Date): number => Math.round((dayStart(a) - dayStart(b)) / DAY);

  // ── create by dragging on empty grid ──────────────────────────
  function colDown(e: PointerEvent, idx: number) {
    if (e.button !== 0) return;
    ui.closeEditors();
    store.selectedKey = null;
    const day = days[idx];
    const anchorMin = Math.floor(minAt(e.clientY) / 15) * 15;
    const mk = (a: number, b: number): Preview => ({
      start: msAt(day, a), end: msAt(day, b), key: null, calendarId: store.defaultCalendarId(), title: '', allDay: false
    });
    const range = (y: number): [number, number] => {
      const c = snap(minAt(y), 15);
      let lo = Math.min(anchorMin, c);
      let hi = Math.max(anchorMin, c);
      if (c < anchorMin) hi = anchorMin + 15;
      if (hi - lo < 15) hi = lo + 15;
      return [lo, Math.min(hi, 1440)];
    };
    track(e, {
      threshold: 3,
      scroller: () => scroller ?? null,
      onMove: (ev) => {
        const [a, b] = range(ev.clientY);
        preview = mk(a, b);
      },
      onEnd: (ev, moved) => {
        let a = anchorMin;
        let b = Math.min(anchorMin + store.settings.defaultLen, 1440);
        if (moved) [a, b] = range(ev.clientY);
        preview = null;
        const p = mk(a, b);
        ui.editor = {
          occ: null,
          draft: { start: p.start, end: p.end, allDay: false, calendarId: p.calendarId },
          anchor: anchorFor(idx, p.start, p.end)
        };
      },
      onCancel: () => (preview = null)
    });
  }

  // ── move / resize existing events ─────────────────────────────
  function evDown(e: PointerEvent, seg: Seg) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const occ = seg.occ;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    let zone: 'move' | 'start' | 'end' = 'move';
    if (r.height > 22) {
      if (e.clientY - r.top < 6 && seg.first) zone = 'start';
      else if (r.bottom - e.clientY < 6 && seg.last) zone = 'end';
    }
    const idx0 = colAt(e.clientX);
    const min0 = minAt(e.clientY);
    const dur = occ.end - occ.start;
    store.selectedKey = occ.key;
    const base: Preview = {
      start: occ.start, end: occ.end, key: occ.key, calendarId: occ.ev.calendarId, title: occ.ev.title, allDay: false
    };
    let cur: { start: number; end: number } | null = null;
    const anchor = anchorOf(el);

    track(e, {
      threshold: 4,
      scroller: () => scroller ?? null,
      onMove: (ev) => {
        const p = minAt(ev.clientY);
        if (zone === 'move') {
          const dd = dayDiff(days[colAt(ev.clientX)], days[idx0]);
          const newMin = snap(minutesOfDay(occ.start) + (p - min0), 15);
          const start = shiftWall(occ.start, dd, newMin - minutesOfDay(occ.start));
          cur = { start, end: start + dur };
        } else if (zone === 'end') {
          const day = days[idx0];
          const end = msAt(day, Math.max(snap(p, 15), 15));
          cur = { start: occ.start, end: Math.max(end, occ.start + 15 * MIN) };
        } else {
          const day = days[idx0];
          const start = msAt(day, Math.min(snap(p, 15), 1425));
          cur = { start: Math.min(start, occ.end - 15 * MIN), end: occ.end };
        }
        preview = { ...base, ...cur };
      },
      onEnd: (_ev, moved) => {
        preview = null;
        if (!moved || !cur) {
          ui.taskEditor = null;
          ui.editor = { occ, draft: null, anchor };
          return;
        }
        ui.closeEditors();
        void store.moveOccurrence(occ, cur.start, cur.end);
      },
      onCancel: () => (preview = null)
    });
  }

  // ── all-day chips ─────────────────────────────────────────────
  function adDown(e: PointerEvent, occ: Occ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    store.selectedKey = occ.key;
    const el = e.currentTarget as HTMLElement;
    const anchor = anchorOf(el);
    const w = adEl ? adEl.getBoundingClientRect().width / n : 100;
    let dd = 0;
    track(e, {
      threshold: 4,
      onMove: (ev, dx) => {
        dd = Math.round(dx / w);
        adShift = { key: occ.key, dx: dd * w };
        void ev;
      },
      onEnd: (_ev, moved) => {
        adShift = null;
        if (!moved) {
          ui.editor = { occ, draft: null, anchor };
          return;
        }
        if (dd === 0) return;
        ui.closeEditors();
        const s = shiftWall(occ.start, dd, 0);
        const en = shiftWall(occ.end, dd, 0);
        void store.moveOccurrence(occ, s, en);
      },
      onCancel: () => (adShift = null)
    });
  }
  function adCellDown(e: PointerEvent, idx: number) {
    if (e.button !== 0) return;
    ui.closeEditors();
    store.selectedKey = null;
    const day = dayStart(days[idx]);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    track(e, {
      threshold: 99999,
      onMove: () => {},
      onEnd: () => {
        ui.editor = {
          occ: null,
          draft: { start: day, end: addDays(day, 1).getTime(), allDay: true, calendarId: store.defaultCalendarId() },
          anchor: { x: r.left, y: r.top, w: r.width, h: r.height }
        };
      }
    });
  }

  function evKey(e: KeyboardEvent, occ: Occ, el: HTMLElement) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      store.selectedKey = occ.key;
      ui.editor = { occ, draft: null, anchor: anchorOf(el) };
    }
  }

  // ── geometry for rendering ────────────────────────────────────
  function pos(seg: Seg, ds: number, p?: Placed<Seg>) {
    const sm = minutesOfDay(seg.start);
    const endMin = seg.end >= dayStart(addDays(ds, 1)) ? 1440 : minutesOfDay(seg.end);
    const top = sm * ppm;
    const h = Math.max((endMin - sm) * ppm - 1, 14);
    const left = p ? (p.col / p.cols) * 100 : 0;
    const width = p ? (p.span / p.cols) * 100 : 100;
    return `top:${top}px;height:${h}px;left:calc(${left}% + 1px);width:calc(${width}% - 4px);`;
  }
  const previewSeg = (pv: Preview, ds: number): Seg | null => {
    const stub = {
      id: 'preview', calendarId: pv.calendarId, title: pv.title, notes: '', location: '', start: pv.start, end: pv.end,
      allDay: false, rrule: null, exdates: [], taskId: null, done: false, createdAt: 0, updatedAt: 0,
      gId: null, gEtag: null, dirty: false, gMasterId: null, gOrigStart: null
    };
    const fake: Occ = { key: 'preview', ev: stub, start: pv.start, end: pv.end, recurring: false, origStart: pv.start };
    return segsFor(pv.start, pv.end, ds, fake);
  };

  // ── lifecycle: initial scroll + ctrl-wheel zoom ───────────────
  onMount(() => {
    if (scroller) {
      const showsToday = days.some((d) => dayStart(d) === todayMs);
      const target = showsToday ? Math.max(0, minutesOfDay(Date.now()) - 120) : 7 * 60;
      scroller.scrollTop = target * ppm;
    }
    const el = scroller;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = clamp(store.settings.hourPx + (e.deltaY < 0 ? 6 : -6), 36, 140);
      if (next === store.settings.hourPx) return;
      const r = el.getBoundingClientRect();
      const focusMin = (el.scrollTop + (e.clientY - r.top)) / ppm;
      store.setSetting('hourPx', next);
      el.scrollTop = focusMin * (next / 60) - (e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);
</script>

{#snippet block(seg: Seg, ds: number, p: Placed<Seg> | undefined, pv: Preview | null, isDraft: boolean)}
  {@const occ = seg.occ}
  {@const ev = occ.ev}
  {@const calId = pv ? pv.calendarId : ev.calendarId}
  {@const short = (seg.end - seg.start) / MIN <= 30}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_no_noninteractive_tabindex -->
  <div
    class="ev"
    class:sel={!pv && store.selectedKey === occ.key}
    class:ghost={!pv && !isDraft && preview?.key === occ.key}
    class:preview={!!pv || isDraft}
    class:done={!pv && ev.done}
    class:short
    style="{pos(seg, ds, p)}--c:{colorOf(calId)}"
    role={pv || isDraft ? 'presentation' : 'button'}
    tabindex={pv || isDraft ? -1 : 0}
    aria-label={pv || isDraft ? undefined : `${ev.title || 'Untitled'}, ${fmtTime(occ.start, hour24)}`}
    data-key={occ.key}
    onpointerdown={pv || isDraft ? undefined : (e) => evDown(e, seg)}
    onkeydown={pv || isDraft ? undefined : (e) => evKey(e, occ, e.currentTarget)}
  >
    {#if !pv && !isDraft && ev.taskId}
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
        {#if ev.done}<Icon name="check" size={10} />{/if}
      </button>
    {/if}
    <div class="txt">
      <span class="t">{(pv ? pv.title : ev.title) || (pv || isDraft ? 'New event' : 'Untitled')}</span>
      {#if !short}<span class="tm num">{fmtTime(seg.start, hour24)} – {fmtTime(seg.end === dayStart(addDays(ds, 1)) ? seg.end - 1 : seg.end, hour24)}</span>{/if}
      {#if short}<span class="tm num inline">{fmtTime(seg.start, hour24)}</span>{/if}
      {#if !short && ev.location && !pv && !isDraft}<span class="loc">{ev.location}</span>{/if}
    </div>
    {#if !pv && !isDraft && ev.rrule}<span class="rep"><Icon name="repeat" size={11} /></span>{/if}
  </div>
{/snippet}

<div class="tg" style="--n:{n};--hp:{hourPx}px">
  <div class="tg-scroll" bind:this={scroller}>
    <div class="head">
      <div class="row">
        <div class="gutter"></div>
        <div class="dheads">
          {#each days as d (d.getTime())}
            {@const isToday = dayStart(d) === todayMs}
            <button
              class="dh"
              class:today={isToday}
              onclick={() => {
                store.goTo(d);
                if (store.settings.view !== 'day') store.setView('day');
              }}
              aria-label={format(d, 'EEEE d MMMM')}
            >
              <span class="dn">{format(d, 'EEE')}</span>
              <span class="dd num">{format(d, 'd')}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="row ad">
        <div class="gutter ad-label"><span>all-day</span></div>
        <div
          class="ad-grid"
          bind:this={adEl}
          style="grid-template-columns:repeat({n},1fr);grid-template-rows:repeat({allDay.lanes},26px)"
        >
          {#each days as d, i (d.getTime())}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="ad-cell"
              class:over={taskHover?.kind === 'allday' && taskHover.dayMs === dayStart(d)}
              style="grid-column:{i + 1};grid-row:1 / span {allDay.lanes}"
              data-drop="allday"
              data-day={dayStart(d)}
              onpointerdown={(e) => adCellDown(e, i)}
            ></div>
          {/each}
          {#each allDay.placed as it (it.occ.key)}
            {@const ev = it.occ.ev}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="chip"
              class:sel={store.selectedKey === it.occ.key}
              class:done={ev.done}
              class:lift={adShift?.key === it.occ.key}
              style="grid-column:{it.s + 1} / {it.e + 2};grid-row:{it.lane + 1};--c:{colorOf(ev.calendarId)};{adShift?.key === it.occ.key ? `transform:translateX(${adShift.dx}px)` : ''}"
              role="button"
              tabindex="0"
              onpointerdown={(e) => adDown(e, it.occ)}
              onkeydown={(e) => evKey(e, it.occ, e.currentTarget)}
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
                  {#if ev.done}<Icon name="check" size={10} />{/if}
                </button>
              {/if}
              <span class="t">{ev.title || 'Untitled'}</span>
              {#if ev.rrule}<Icon name="repeat" size={11} />{/if}
            </div>
          {/each}
          {#if draft?.allDay}
            {@const s = days.findIndex((d) => dayStart(d) === dayStart(draft.start))}
            {#if s >= 0}
              <div
                class="chip preview"
                style="grid-column:{s + 1} / {s + 2};grid-row:1;--c:{colorOf(draft.calendarId ?? store.defaultCalendarId())}"
              >
                <span class="t">{draft.title || 'New event'}</span>
              </div>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <div class="body" style="height:{24 * hourPx}px">
      <div class="gutter hours" aria-hidden="true">
        {#each hours as h (h)}
          {#if h > 0}<span class="hl num" style="top:{h * hourPx - 7}px">{fmtHourLabel(h, hour24)}</span>{/if}
        {/each}
      </div>
      <div class="cols" bind:this={colsEl}>
        {#each days as d, i (d.getTime())}
          {@const ds = dayStart(d)}
          {@const isToday = ds === todayMs}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="col"
            class:today={isToday}
            class:weekend={d.getDay() === 0 || d.getDay() === 6}
            data-drop="time"
            data-day={ds}
            onpointerdown={(e) => colDown(e, i)}
          >
            {#each timed.get(ds) ?? [] as p (p.item.occ.key + p.item.start)}
              {@render block(p.item, ds, p, null, false)}
            {/each}

            {#if preview}
              {@const sg = previewSeg(preview, ds)}
              {#if sg}{@render block(sg, ds, undefined, preview, false)}{/if}
            {/if}
            {#if draft && !draft.allDay && !preview}
              {@const sg = previewSeg(
                { start: draft.start, end: draft.end, key: null, calendarId: draft.calendarId ?? store.defaultCalendarId(), title: draft.title ?? '', allDay: false },
                ds
              )}
              {#if sg}
                {@render block(
                  sg, ds, undefined,
                  { start: draft.start, end: draft.end, key: null, calendarId: draft.calendarId ?? store.defaultCalendarId(), title: draft.title ?? '', allDay: false },
                  true
                )}
              {/if}
            {/if}
            {#if taskHover?.kind === 'time' && taskHover.dayMs === ds}
              {@const sg = previewSeg(
                { start: taskHover.start, end: taskHover.end, key: null, calendarId: store.defaultCalendarId(), title: ui.taskDrag?.task.title ?? '', allDay: false },
                ds
              )}
              {#if sg}
                {@render block(
                  sg, ds, undefined,
                  { start: taskHover.start, end: taskHover.end, key: null, calendarId: store.defaultCalendarId(), title: ui.taskDrag?.task.title ?? '', allDay: false },
                  true
                )}
              {/if}
            {/if}

            {#if isToday}
              <div class="now" style="top:{minutesOfDay(store.now) * ppm}px"></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .tg { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--surface); }
  .tg-scroll { flex: 1; overflow-y: auto; overflow-x: hidden; position: relative; scrollbar-gutter: stable; }

  .head { position: sticky; top: 0; z-index: 6; background: var(--surface); box-shadow: 0 1px 0 var(--border); }
  .row { display: grid; grid-template-columns: 56px 1fr; }
  .dheads { display: grid; grid-template-columns: repeat(var(--n), 1fr); }
  .dh {
    display: flex; flex-direction: column; align-items: center; gap: 2px; padding: var(--s2) 0;
    border: 0; border-left: 1px solid var(--border); background: transparent; color: var(--text-2);
  }
  .dh:hover { background: var(--hover); }
  .dn { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .dd { font-size: 18px; font-weight: 600; line-height: 28px; min-width: 28px; border-radius: 14px; color: var(--text); }
  .dh.today .dn { color: var(--accent); }
  .dh.today .dd { background: var(--accent); color: var(--accent-fg); }

  .ad { border-top: 1px solid var(--border); }
  .ad-label { display: flex; align-items: flex-end; justify-content: flex-end; padding: 0 var(--s2) 4px 0; }
  .ad-label span { font-size: 10px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .ad-grid { display: grid; position: relative; row-gap: 0; min-width: 0; }
  .ad-cell { border-left: 1px solid var(--border); min-width: 0; }
  .ad-cell.over { background: var(--accent-soft); }
  .chip {
    --bgc: color-mix(in srgb, var(--c) 22%, var(--surface));
    z-index: 1; margin: 3px 2px 0 2px; height: 20px; display: flex; align-items: center; gap: 6px;
    padding: 0 8px; border-radius: 5px; background: var(--bgc);
    color: color-mix(in srgb, var(--c) 60%, var(--text)); font-size: 12px; font-weight: 600;
    min-width: 0;
  }
  .chip:hover { background: color-mix(in srgb, var(--c) 30%, var(--surface)); }
  .chip.sel { box-shadow: 0 0 0 2px var(--c); }
  .chip.lift { box-shadow: var(--sh-drag); z-index: 4; will-change: transform; }
  .chip.preview { opacity: 0.85; border: 1px dashed var(--c); pointer-events: none; }
  .chip.done .t { text-decoration: line-through; opacity: 0.65; }
  .chip .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

  .body { display: grid; grid-template-columns: 56px 1fr; position: relative; }
  .gutter.hours { position: relative; }
  .hl {
    position: absolute; right: 8px; height: 14px; line-height: 14px; font-size: 11px; color: var(--text-3);
  }
  .cols {
    display: grid; grid-template-columns: repeat(var(--n), 1fr); position: relative;
    background-image:
      linear-gradient(to bottom, var(--border) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px);
    background-size: 100% var(--hp), 100% calc(var(--hp) / 2);
  }
  .col { position: relative; border-left: 1px solid var(--border); min-width: 0; touch-action: none; }
  .col.weekend { background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
  .col.today { background: color-mix(in srgb, var(--accent) 4%, transparent); }

  .now { position: absolute; left: 0; right: 0; height: 2px; background: var(--now); z-index: 5; pointer-events: none; margin-top: -1px; }
  .now::before {
    content: ''; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--now);
  }

  .ev {
    --bgc: color-mix(in srgb, var(--c) 18%, var(--surface));
    position: absolute; z-index: 2; display: flex; gap: 6px; align-items: flex-start;
    padding: 3px 6px 3px 8px; border-radius: 6px; background: var(--bgc); overflow: hidden;
    color: color-mix(in srgb, var(--c) 55%, var(--text)); min-width: 0;
    box-shadow: inset 3px 0 0 var(--c), var(--sh-1);
  }
  .ev:hover { background: color-mix(in srgb, var(--c) 26%, var(--surface)); }
  .ev.sel { box-shadow: inset 3px 0 0 var(--c), 0 0 0 2px var(--c); z-index: 4; }
  .ev.ghost { opacity: 0.3; }
  .ev.preview { z-index: 8; pointer-events: none; box-shadow: inset 3px 0 0 var(--c), var(--sh-drag); background: color-mix(in srgb, var(--c) 28%, var(--surface)); }
  .ev.done { opacity: 0.6; }
  .ev.done .t { text-decoration: line-through; }
  .ev::before, .ev::after { content: ''; position: absolute; left: 0; right: 0; height: 6px; cursor: ns-resize; z-index: 3; }
  .ev::before { top: 0; }
  .ev::after { bottom: 0; }
  .ev { cursor: grab; }
  .ev.short { padding-top: 0; padding-bottom: 0; align-items: center; }
  .txt { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; flex: 1; pointer-events: none; }
  .short .txt { flex-direction: row; gap: 6px; align-items: baseline; white-space: nowrap; }
  .t { font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .tm { font-size: 11px; opacity: 0.8; white-space: nowrap; }
  .tm.inline { opacity: 0.7; }
  .loc { font-size: 11px; opacity: 0.75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rep { margin-left: auto; opacity: 0.7; padding-top: 1px; pointer-events: none; }

  .cb {
    flex: none; width: 14px; height: 14px; margin-top: 1px; padding: 0; display: grid; place-items: center;
    border-radius: 50%; border: 1.5px solid var(--c); background: transparent; color: var(--accent-fg); z-index: 4;
  }
  .cb.on { background: var(--c); }
  .cb:hover { background: color-mix(in srgb, var(--c) 30%, transparent); }
  .cb.on:hover { background: var(--c); }
</style>
