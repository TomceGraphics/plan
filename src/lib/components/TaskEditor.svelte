<script lang="ts">
  import { format } from 'date-fns';
  import { store } from '../store.svelte';
  import { addDays, dayKey, dayStart, fmtTime, parseDay } from '../time';
  import type { Priority } from '../types';
  import { ui, type Anchor } from '../ui.svelte';
  import DateField from './DateField.svelte';
  import Icon from './Icon.svelte';
  import Popover from './Popover.svelte';
  import { onMount } from 'svelte';

  let { id, anchor }: { id: string; anchor: Anchor } = $props();

  const task = $derived(store.taskMap.get(id));
  const kids = $derived(store.childrenByTask.get(id) ?? []);
  const blocks = $derived((store.eventsByTask.get(id) ?? []).slice().sort((a, b) => a.start - b.start));
  const hour24 = $derived(store.settings.hour24);
  let titleEl: HTMLInputElement | undefined = $state();
  let sub = $state('');

  onMount(() => {
    titleEl?.focus();
    titleEl?.select();
  });

  $effect(() => {
    if (!task) ui.taskEditor = null;
  });

  const PRIOS: { v: Priority; label: string; color: string }[] = [
    { v: 0, label: 'None', color: 'var(--text-3)' },
    { v: 1, label: 'Low', color: 'var(--p1)' },
    { v: 2, label: 'Medium', color: 'var(--p2)' },
    { v: 3, label: 'High', color: 'var(--p3)' }
  ];
  const ESTIMATES = [null, 15, 30, 45, 60, 90, 120, 180];

  function addSub() {
    const t = sub.trim();
    if (!t || !task) return;
    store.createTask({ title: t, parentId: task.id, due: task.due }, { checkpoint: false });
    sub = '';
  }
  function setDue(key: string | null) {
    store.updateTask(id, { due: key });
  }
  async function remove() {
    store.removeTask(id);
    ui.taskEditor = null;
  }
</script>

{#if task}
  <Popover {anchor} label="Task editor" onclose={() => (ui.taskEditor = null)}>
    <div class="te">
      <div class="title-row">
        <button
          class="cbx"
          class:on={task.done}
          aria-label={task.done ? 'Mark not done' : 'Mark done'}
          onclick={() => store.toggleTask(id)}
        >
          {#if task.done}<Icon name="check" size={12} />{/if}
        </button>
        <input
          class="title"
          bind:this={titleEl}
          aria-label="Task title"
          placeholder="Task title"
          value={task.title}
          oninput={(e) => store.updateTask(id, { title: e.currentTarget.value })}
          onkeydown={(e) => e.key === 'Enter' && (ui.taskEditor = null)}
        />
      </div>

      <div class="row">
        <span class="ic"><Icon name="calendar" /></span>
        <div class="due">
          {#if task.due}
            <DateField label="Due date" value={parseDay(task.due).getTime()} onchange={(ms) => setDue(dayKey(ms))} />
            <button class="icon-btn sm" aria-label="Clear due date" onclick={() => setDue(null)}><Icon name="x" size={14} /></button>
          {:else}
            <button class="btn sm" onclick={() => setDue(dayKey(new Date()))}>Today</button>
            <button class="btn sm" onclick={() => setDue(dayKey(addDays(new Date(), 1)))}>Tomorrow</button>
            <button class="btn sm" onclick={() => setDue(dayKey(addDays(new Date(), 7)))}>Next week</button>
          {/if}
        </div>
      </div>

      <div class="row">
        <span class="ic"><Icon name="flag" /></span>
        <div class="seg" role="radiogroup" aria-label="Priority">
          {#each PRIOS as p (p.v)}
            <button role="radio" aria-checked={task.priority === p.v} onclick={() => store.updateTask(id, { priority: p.v })}>
              <span class="pd" style="background:{p.color}"></span>{p.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="row">
        <span class="ic"><Icon name="clock" /></span>
        <div class="est">
          <select
            class="field"
            aria-label="Estimate"
            value={String(task.estimate ?? '')}
            onchange={(e) => store.updateTask(id, { estimate: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
          >
            {#each ESTIMATES as m (m)}
              <option value={String(m ?? '')}>{m === null ? `Default length (${store.settings.defaultLen} min)` : m >= 60 ? `${m / 60} h` : `${m} min`}</option>
            {/each}
          </select>
          <span class="caret"><Icon name="chev-down" size={14} /></span>
        </div>
      </div>

      <div class="row top">
        <span class="ic"><Icon name="subtask" /></span>
        <div class="subs">
          {#each kids as k (k.id)}
            <div class="sr">
              <button
                class="cbx sm"
                class:on={k.done}
                aria-label={k.done ? 'Mark not done' : 'Mark done'}
                onclick={() => store.toggleTask(k.id)}
              >
                {#if k.done}<Icon name="check" size={10} />{/if}
              </button>
              <input
                class="sin"
                class:done={k.done}
                aria-label="Subtask title"
                value={k.title}
                oninput={(e) => store.updateTask(k.id, { title: e.currentTarget.value })}
              />
              <button class="icon-btn sm" aria-label="Delete subtask" onclick={() => store.removeTask(k.id)}><Icon name="x" size={13} /></button>
            </div>
          {/each}
          <input
            class="field"
            placeholder="Add subtask"
            aria-label="Add subtask"
            bind:value={sub}
            onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addSub())}
          />
        </div>
      </div>

      <div class="row top">
        <span class="ic"><Icon name="note" /></span>
        <textarea
          class="field"
          rows="3"
          placeholder="Notes"
          aria-label="Notes"
          value={task.notes}
          oninput={(e) => store.updateTask(id, { notes: e.currentTarget.value })}
        ></textarea>
      </div>

      {#if blocks.length}
        <div class="row top">
          <span class="ic"><Icon name="link" /></span>
          <div class="subs">
            <span class="lbl">Scheduled on the calendar</span>
            {#each blocks as b (b.id)}
              <div class="blk">
                <button
                  class="bgo"
                  onclick={() => {
                    store.goTo(new Date(dayStart(b.start)));
                    ui.taskEditor = null;
                  }}
                >
                  {format(b.start, 'EEE d MMM')}{b.allDay ? ' · all day' : ` · ${fmtTime(b.start, hour24)}–${fmtTime(b.end, hour24)}`}
                </button>
                <button
                  class="icon-btn sm"
                  aria-label="Remove time block"
                  onclick={() => {
                    store.checkpoint('remove time block');
                    store.removeEvent(b.id);
                  }}><Icon name="x" size={13} /></button
                >
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="foot">
        <button class="btn ghost danger sm" onclick={remove}><Icon name="trash" size={15} />Delete</button>
        <span class="sp"></span>
        <button class="btn sm" onclick={() => (ui.taskEditor = null)}>Done</button>
      </div>
    </div>
  </Popover>
{/if}

<style>
  .te { padding: var(--s3) var(--s4); display: flex; flex-direction: column; gap: var(--s3); }
  .title-row { display: flex; align-items: center; gap: var(--s3); }
  .title {
    flex: 1; min-width: 0; height: 32px; border: 0; border-bottom: 2px solid transparent; background: transparent;
    font-size: 16px; font-weight: 600; padding: 0 2px; outline: none; border-radius: 0;
  }
  .title:hover { border-bottom-color: var(--border); }
  .title:focus { border-bottom-color: var(--accent); }
  .row { display: flex; align-items: center; gap: var(--s3); }
  .row.top { align-items: flex-start; }
  .row.top .ic { padding-top: 7px; }
  .ic { width: 16px; color: var(--text-3); display: grid; place-items: center; flex: none; }
  .due { display: flex; align-items: center; gap: var(--s2); flex: 1; }
  .est { position: relative; flex: 1; }
  .caret { position: absolute; right: 8px; top: 9px; pointer-events: none; color: var(--text-3); }
  .seg button { display: inline-flex; align-items: center; gap: 6px; padding: 0 var(--s2); }
  .pd { width: 8px; height: 8px; border-radius: 50%; }
  .subs { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .sr, .blk { display: flex; align-items: center; gap: var(--s2); }
  .sin { flex: 1; min-width: 0; height: 28px; border: 0; background: transparent; outline: none; border-bottom: 1px solid transparent; }
  .sin:hover { border-bottom-color: var(--border); }
  .sin:focus { border-bottom-color: var(--accent); }
  .sin.done { text-decoration: line-through; color: var(--text-3); }
  .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
  .bgo { flex: 1; text-align: left; border: 0; background: transparent; color: var(--accent); padding: 2px 0; font-weight: 500; }
  .bgo:hover { text-decoration: underline; }
  .cbx {
    flex: none; width: 20px; height: 20px; padding: 0; display: grid; place-items: center; border-radius: 50%;
    border: 1.75px solid var(--text-3); background: transparent; color: var(--accent-fg);
  }
  .cbx.sm { width: 16px; height: 16px; }
  .cbx:hover { border-color: var(--accent); }
  .cbx.on { background: var(--accent); border-color: var(--accent); }
  .foot { display: flex; align-items: center; gap: var(--s2); border-top: 1px solid var(--border); padding-top: var(--s3); }
  .sp { flex: 1; }
</style>
