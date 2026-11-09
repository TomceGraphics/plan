<script lang="ts">
  import { onMount } from 'svelte';
  import { parseEventText, parseTaskText } from '../quickparse';
  import { store } from '../store.svelte';
  import { ui } from '../ui.svelte';
  import { format } from 'date-fns';
  import Icon from './Icon.svelte';

  let mode = $state<'event' | 'task'>('event');
  let text = $state('');
  let calId = $state(store.defaultCalendarId());
  let inputEl: HTMLInputElement | undefined = $state();

  const evParsed = $derived(parseEventText(text, new Date(store.now), store.settings.defaultLen));
  const taskParsed = $derived(parseTaskText(text, new Date(store.now)));
  const chips = $derived(text.trim() ? (mode === 'event' ? evParsed.chips : taskParsed.chips) : []);
  const title = $derived(mode === 'event' ? evParsed.title : taskParsed.title);

  onMount(() => inputEl?.focus());

  function submit() {
    if (!title) return;
    if (mode === 'event') {
      const p = evParsed;
      const ev = store.createEvent({ title: p.title, start: p.start, end: p.end, allDay: p.allDay, calendarId: calId });
      store.goTo(new Date(p.start));
      store.selectedKey = ev.id;
      ui.toast(`Added “${p.title}” · ${format(p.start, p.allDay ? 'EEE d MMM' : 'EEE d MMM, HH:mm')}`, {
        label: 'Undo',
        run: () => void store.undo()
      });
    } else {
      const p = taskParsed;
      store.createTask({ title: p.title, due: p.due, priority: p.priority, estimate: p.estimate });
      ui.toast(`Task added: “${p.title}”`, { label: 'Undo', run: () => void store.undo() });
    }
    ui.quickAdd = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      mode = mode === 'event' ? 'task' : 'event';
    }
  }
</script>

<div class="scrim" role="presentation" onpointerdown={() => (ui.quickAdd = false)}></div>
<div class="qa card" role="dialog" aria-label="Quick add" aria-modal="true">
  <div class="top">
    <div class="seg" role="group" aria-label="Type">
      <button aria-pressed={mode === 'event'} onclick={() => { mode = 'event'; inputEl?.focus(); }}>Event</button>
      <button aria-pressed={mode === 'task'} onclick={() => { mode = 'task'; inputEl?.focus(); }}>Task</button>
    </div>
    <span class="hint">Tab switches type</span>
    {#if mode === 'event'}
      <div class="calsel">
        <span class="dot" style="background:{store.calMap.get(calId)?.color}"></span>
        <select aria-label="Calendar" bind:value={calId}>
          {#each store.calendars as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </div>
    {/if}
  </div>
  <div class="in">
    <Icon name={mode === 'event' ? 'calendar' : 'tasks'} size={18} />
    <input
      bind:this={inputEl}
      bind:value={text}
      aria-label="Quick add text"
      placeholder={mode === 'event' ? 'Lunch with Ana tomorrow 12:30 for 1h' : 'Send invoice friday !2 ~30m'}
      spellcheck="false"
      autocomplete="off"
      onkeydown={onKey}
    />
  </div>
  <div class="foot">
    <div class="chips">
      {#each chips as c (c)}<span class="pc">{c}</span>{/each}
      {#if !chips.length}<span class="muted">{mode === 'event' ? 'Understands today, tomorrow, fri, 3pm, 14:00-15:30, for 45m, 30 oct' : 'Understands dates, !1 !2 !3 priority, ~30m estimate'}</span>{/if}
    </div>
    <button class="btn primary sm" disabled={!title} onclick={submit}>Add <span class="kbd">↵</span></button>
  </div>
</div>

<style>
  .qa { position: fixed; z-index: 60; top: 18vh; left: 0; right: 0; margin: 0 auto; width: 580px; max-width: calc(100vw - 32px); animation: pop 100ms ease-out; }
  .top { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4) 0; }
  .hint { color: var(--text-3); font-size: 12px; margin-right: auto; }
  .calsel { display: flex; align-items: center; gap: 6px; position: relative; }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  .calsel select { border: 0; background: transparent; color: var(--text-2); font-weight: 500; height: 28px; }
  .in { display: flex; align-items: center; gap: var(--s3); padding: 0 var(--s4); height: 56px; color: var(--text-3); }
  .in input { flex: 1; height: 100%; border: 0; outline: none; background: transparent; font-size: 17px; color: var(--text); }
  .foot { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4) var(--s3); border-top: 1px solid var(--border); min-height: 48px; }
  .chips { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-width: 0; }
  .pc { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
  .muted { color: var(--text-3); font-size: 12px; }
  .btn:disabled { opacity: 0.45; pointer-events: none; }
  .btn .kbd { background: transparent; border-color: color-mix(in srgb, var(--accent-fg) 40%, transparent); color: var(--accent-fg); }
</style>
