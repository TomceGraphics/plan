<script lang="ts">
  import { addDays, addMonths, format, startOfMonth, startOfWeek } from 'date-fns';
  import { store } from '../store.svelte';
  import { dayStart } from '../time';
  import Icon from './Icon.svelte';

  let {
    value, onpick, range
  }: {
    value: Date;
    onpick: (d: Date) => void;
    /** highlighted [start, end) in ms (the visible week, for example) */
    range?: { start: number; end: number };
  } = $props();

  let month = $derived(startOfMonth(value));
  const weekStart = $derived(store.settings.weekStart);
  const cells = $derived.by(() => {
    const s = startOfWeek(month, { weekStartsOn: weekStart });
    return Array.from({ length: 42 }, (_, i) => addDays(s, i));
  });
  const todayMs = $derived(dayStart(store.now));
  const sel = $derived(dayStart(value));
</script>

<div class="mm">
  <div class="top">
    <span class="ml">{format(month, 'MMMM yyyy')}</span>
    <span class="nav">
      <button class="icon-btn sm" aria-label="Previous month" onclick={() => (month = addMonths(month, -1))}>
        <Icon name="chev-left" size={14} />
      </button>
      <button class="icon-btn sm" aria-label="Next month" onclick={() => (month = addMonths(month, 1))}>
        <Icon name="chev-right" size={14} />
      </button>
    </span>
  </div>
  <div class="g" role="grid" aria-label={format(month, 'MMMM yyyy')}>
    {#each cells.slice(0, 7) as d (d.getTime())}
      <span class="wd" role="columnheader">{format(d, 'EEEEE')}</span>
    {/each}
    {#each cells as d (d.getTime())}
      {@const ms = dayStart(d)}
      <button
        class="d num"
        class:out={d.getMonth() !== month.getMonth()}
        class:today={ms === todayMs}
        class:sel={ms === sel}
        class:inr={range && ms >= range.start && ms < range.end}
        aria-label={format(d, 'EEEE d MMMM yyyy')}
        onclick={() => onpick(d)}>{d.getDate()}</button
      >
    {/each}
  </div>
</div>

<style>
  .mm { user-select: none; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 0 2px var(--s1) var(--s2); }
  .ml { font-weight: 600; }
  .nav { display: flex; }
  .g { display: grid; grid-template-columns: repeat(7, 1fr); row-gap: 1px; }
  .wd { text-align: center; font-size: 10px; font-weight: 600; color: var(--text-3); padding: 3px 0; text-transform: uppercase; }
  .d {
    height: 28px; border: 0; background: transparent; border-radius: 14px; color: var(--text); font-size: 12px; padding: 0;
  }
  .d:hover { background: var(--hover); }
  .d.out { color: var(--text-3); }
  .d.inr { background: var(--accent-soft); border-radius: 0; }
  .d.today { color: var(--accent); font-weight: 700; box-shadow: inset 0 0 0 1.5px var(--accent); border-radius: 14px; }
  .d.sel { background: var(--accent); color: var(--accent-fg); font-weight: 700; border-radius: 14px; }
</style>
