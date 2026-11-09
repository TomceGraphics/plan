<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { PRESETS, presetOf, describeRule } from '../recur';
  import { store, shiftWall } from '../store.svelte';
  import { addDays, DAY, dayStart, minutesOfDay, msAt, MIN } from '../time';
  import type { Ev, Occ } from '../types';
  import { ui, type Draft, type EditorState } from '../ui.svelte';
  import DateField from './DateField.svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import TimeField from './TimeField.svelte';

  let { st }: { st: EditorState } = $props();

  let occ = $state.raw<Occ | null>(untrack(() => st.occ));
  let draft = $state.raw<Draft | null>(untrack(() => st.draft));
  let scope = $state<'this' | 'all'>('this');
  let titleEl: HTMLInputElement | undefined = $state();
  let checkpointed = false;

  const hour24 = $derived(store.settings.hour24);
  /** live view of the thing being edited */
  const cur = $derived.by((): Draft | Ev => {
    if (draft) return draft;
    const id = occ!.ev.id;
    const ev = store.events.find((e) => e.id === id);
    return ev ? { ...ev, start: occ!.start, end: occ!.end } : { ...occ!.ev, start: occ!.start, end: occ!.end };
  });
  const isRecurring = $derived(!draft && !!occ && (occ.recurring || !!occ.ev.rrule));
  const rrule = $derived(('rrule' in cur ? cur.rrule : null) ?? null);
  const calId = $derived(cur.calendarId ?? store.defaultCalendarId());
  const linkedTask = $derived(!draft && occ?.ev.taskId ? store.taskMap.get(occ.ev.taskId) : undefined);
  const lastDay = $derived(cur.allDay ? dayStart(cur.end - 1) : dayStart(cur.end));

  onMount(() => {
    titleEl?.focus();
    if (!draft) titleEl?.select();
  });

  function patch(p: Partial<Ev>) {
    if (draft) {
      draft = { ...draft, ...p } as Draft;
      ui.editor = { ...st, draft, occ: null };
      return;
    }
    if (!occ) return;
    if (store.isReadOnly(occ.ev)) {
      ui.toast('This Google calendar is read-only.');
      return;
    }
    if (!checkpointed) {
      store.checkpoint('edit event');
      checkpointed = true;
    }
    const useScope = p.rrule !== undefined ? 'all' : scope;
    occ = store.editOccurrence(occ, p, useScope);
    store.selectedKey = occ.key;
    ui.editor = { ...st, occ, draft: null };
  }

  const curStart = () => cur.start;
  const curEnd = () => cur.end;

  function setStartDay(dayMs: number) {
    const dd = Math.round((dayMs - dayStart(curStart())) / DAY);
    if (!dd) return;
    patch({ start: shiftWall(curStart(), dd, 0), end: shiftWall(curEnd(), dd, 0) });
  }
  function setEndDay(dayMs: number) {
    if (cur.allDay) {
      const end = addDays(dayMs, 1).getTime();
      patch(end <= curStart() ? { start: dayMs, end } : { end });
    } else {
      const endMin = minutesOfDay(curEnd());
      const end = msAt(dayMs, endMin);
      patch(end <= curStart() ? { start: msAt(dayMs, minutesOfDay(curStart())), end: msAt(dayMs, minutesOfDay(curStart())) + 15 * MIN } : { end });
    }
  }
  function setStartTime(min: number) {
    const dur = curEnd() - curStart();
    const start = msAt(dayStart(curStart()), min);
    patch({ start, end: start + dur });
  }
  function setEndTime(min: number) {
    let end = msAt(dayStart(curStart()), min);
    if (end <= curStart()) end = msAt(addDays(dayStart(curStart()), 1), min);
    patch({ end });
  }
  function toggleAllDay() {
    if (cur.allDay) {
      const day = dayStart(curStart());
      const start = msAt(day, 9 * 60);
      patch({ allDay: false, start, end: start + store.settings.defaultLen * MIN });
    } else {
      const s = dayStart(curStart());
      const e = Math.max(addDays(dayStart(curEnd() - 1), 1).getTime(), addDays(s, 1).getTime());
      patch({ allDay: true, start: s, end: e });
    }
  }

  function commitDraft() {
    if (!draft) return;
    const title = (draft.title ?? '').trim() || 'New event';
    const ev = store.createEvent({ ...draft, title });
    store.selectedKey = ev.rrule ? `${ev.id}@${ev.start}` : ev.id;
    ui.editor = null;
  }
  /** click outside: keep what was typed, drop untouched empty drafts */
  function dismiss() {
    if (draft && (draft.title ?? '').trim()) commitDraft();
    else ui.editor = null;
  }
  async function remove() {
    if (draft) {
      ui.editor = null;
      return;
    }
    if (occ && (await store.deleteOccurrence(occ))) ui.editor = null;
  }
  function onTitleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (draft) commitDraft();
      else ui.editor = null;
    }
  }
</script>

<Popover anchor={st.anchor} label="Event editor" onclose={dismiss}>
  <div class="ed" style="--c:{store.calMap.get(calId)?.color ?? 'var(--accent)'}">
    <div class="title-row">
      <span class="bar"></span>
      <input
        class="title"
        bind:this={titleEl}
        placeholder="Event title"
        aria-label="Title"
        autocomplete="off"
        spellcheck="false"
        value={cur.title ?? ''}
        oninput={(e) => patch({ title: e.currentTarget.value })}
        onkeydown={onTitleKey}
      />
    </div>

    {#if isRecurring}
      <div class="scope" role="group" aria-label="Apply changes to">
        <span class="lbl">Changes apply to</span>
        <div class="seg">
          <button aria-pressed={scope === 'this'} onclick={() => (scope = 'this')}>This event</button>
          <button aria-pressed={scope === 'all'} onclick={() => (scope = 'all')}>All events</button>
        </div>
      </div>
    {/if}

    <div class="row">
      <span class="ic"><Icon name="clock" /></span>
      <div class="when">
        <div class="line">
          <DateField label="Start date" value={dayStart(cur.start)} onchange={setStartDay} />
          {#if !cur.allDay}
            <TimeField label="Start time" value={cur.start} {hour24} onchange={setStartTime} />
          {/if}
        </div>
        <div class="line">
          {#if cur.allDay}
            <DateField label="End date" value={lastDay} onchange={setEndDay} />
          {:else}
            <TimeField label="End time" value={cur.end} {hour24} base={cur.start} onchange={setEndTime} />
            {#if dayStart(cur.end) !== dayStart(cur.start)}
              <DateField label="End date" value={dayStart(cur.end)} onchange={setEndDay} />
            {/if}
          {/if}
          <label class="sw">
            <input type="checkbox" checked={cur.allDay} onchange={toggleAllDay} />
            <span>All-day</span>
          </label>
        </div>
      </div>
    </div>

    <div class="row">
      <span class="ic"><Icon name="repeat" /></span>
      <div class="sel-wrap">
        <select
          class="field"
          aria-label="Repeat"
          value={presetOf(rrule)}
          onchange={(e) => {
            const v = e.currentTarget.value;
            const p = PRESETS.find((x) => x.id === v);
            if (p) patch({ rrule: p.rule });
          }}
        >
          {#each PRESETS as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
          {#if presetOf(rrule) === 'custom'}
            <option value="custom">{describeRule(rrule)}</option>
          {/if}
        </select>
        <span class="caret"><Icon name="chev-down" size={14} /></span>
      </div>
    </div>

    <div class="row">
      <span class="ic"><Icon name="calendar" /></span>
      <div class="cals" role="radiogroup" aria-label="Calendar">
        {#each store.calendars.filter((x) => !x.readOnly || x.id === calId) as c (c.id)}
          <button
            class="cal-pill"
            role="radio"
            aria-checked={c.id === calId}
            style="--c:{c.color}"
            onclick={() => patch({ calendarId: c.id })}
          >
            <span class="dot"></span>{c.name}
          </button>
        {/each}
      </div>
    </div>

    <div class="row">
      <span class="ic"><Icon name="pin" /></span>
      <input
        class="field"
        placeholder="Add location"
        aria-label="Location"
        value={cur.location ?? ''}
        oninput={(e) => patch({ location: e.currentTarget.value })}
        onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), draft ? commitDraft() : (ui.editor = null))}
      />
    </div>

    <div class="row top">
      <span class="ic"><Icon name="note" /></span>
      <textarea
        class="field"
        rows="3"
        placeholder="Add notes"
        aria-label="Notes"
        value={cur.notes ?? ''}
        oninput={(e) => patch({ notes: e.currentTarget.value })}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (draft) commitDraft();
            else ui.editor = null;
          }
        }}
      ></textarea>
    </div>

    {#if linkedTask}
      <div class="linked">
        <button
          class="lcb"
          class:on={linkedTask.done}
          aria-label={linkedTask.done ? 'Mark task not done' : 'Mark task done'}
          onclick={() => store.toggleTask(linkedTask.id)}
        >
          {#if linkedTask.done}<Icon name="check" size={11} />{/if}
        </button>
        <span class="ltxt">Time block for task <b>{linkedTask.title}</b></span>
        <button
          class="btn ghost sm"
          onclick={() => {
            const a = st.anchor;
            ui.editor = null;
            ui.taskEditor = { id: linkedTask.id, anchor: a };
          }}>Open</button
        >
      </div>
    {/if}

    <div class="foot">
      <button class="btn ghost danger sm" onclick={remove} aria-label={draft ? 'Discard' : 'Delete event'}>
        <Icon name="trash" size={15} />{draft ? 'Discard' : 'Delete'}
      </button>
      <span class="sp"></span>
      {#if draft}
        <button class="btn primary sm" onclick={commitDraft}>Save</button>
      {:else}
        <button class="btn sm" onclick={() => (ui.editor = null)}>Done</button>
      {/if}
    </div>
  </div>
</Popover>

<style>
  .ed { padding: var(--s3) var(--s4) var(--s3); display: flex; flex-direction: column; gap: var(--s3); }
  .title-row { display: flex; align-items: center; gap: var(--s3); }
  .bar { width: 4px; height: 28px; border-radius: 2px; background: var(--c); flex: none; }
  .title {
    flex: 1; min-width: 0; height: 32px; border: 0; border-bottom: 2px solid transparent; background: transparent;
    font-size: 17px; font-weight: 600; padding: 0 2px; outline: none; border-radius: 0;
  }
  .title:hover { border-bottom-color: var(--border); }
  .title:focus { border-bottom-color: var(--c); }
  .title::placeholder { color: var(--text-3); }
  .scope { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); }
  .lbl { color: var(--text-2); font-size: 12px; }
  .row { display: flex; align-items: center; gap: var(--s3); }
  .row.top { align-items: flex-start; }
  .row.top .ic { padding-top: 7px; }
  .ic { width: 16px; color: var(--text-3); display: grid; place-items: center; flex: none; }
  .when { flex: 1; display: flex; flex-direction: column; gap: var(--s2); min-width: 0; }
  .line { display: flex; align-items: center; gap: var(--s2); }
  .sw { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--text-2); white-space: nowrap; }
  .sw input { accent-color: var(--accent); width: 14px; height: 14px; margin: 0; }
  .sel-wrap { position: relative; flex: 1; }
  .caret { position: absolute; right: 8px; top: 9px; pointer-events: none; color: var(--text-3); }
  .cals { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
  .cal-pill {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 13px;
    border: 1px solid var(--border-strong); background: transparent; color: var(--text-2);
  }
  .cal-pill:hover { background: var(--hover); }
  .cal-pill[aria-checked='true'] {
    border-color: var(--c); background: color-mix(in srgb, var(--c) 14%, var(--surface)); color: var(--text); font-weight: 600;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .linked {
    display: flex; align-items: center; gap: var(--s2); padding: var(--s2) var(--s2) var(--s2) var(--s3);
    border-radius: var(--r); background: var(--surface-2); border: 1px solid var(--border);
  }
  .ltxt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .ltxt b { color: var(--text); font-weight: 600; }
  .lcb {
    flex: none; width: 18px; height: 18px; padding: 0; display: grid; place-items: center; border-radius: 50%;
    border: 1.5px solid var(--c); background: transparent; color: var(--accent-fg);
  }
  .lcb.on { background: var(--c); }
  .foot { display: flex; align-items: center; gap: var(--s2); padding-top: var(--s1); border-top: 1px solid var(--border); margin-top: var(--s1); padding-top: var(--s3); }
  .sp { flex: 1; }
</style>
