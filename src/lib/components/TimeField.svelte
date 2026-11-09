<script lang="ts">
  import { fmtTime, MIN, minutesOfDay, msAt, parseTimeInput } from '../time';

  let {
    value, hour24, onchange, label, base
  }: {
    value: number;
    hour24: boolean;
    onchange: (minutes: number) => void;
    label: string;
    /** when set, options show the duration from this instant (used for the end field) */
    base?: number;
  } = $props();

  let open = $state(false);
  let text = $state('');
  let editing = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  const shown = $derived(editing ? text : fmtTime(value, hour24));
  const options = $derived.by(() => {
    const day = new Date(base ?? value);
    const startMin = base !== undefined ? minutesOfDay(base) : 0;
    const out: { min: number; label: string; hint: string }[] = [];
    for (let m = base !== undefined ? startMin + 15 : 0; m < (base !== undefined ? startMin + 24 * 60 : 24 * 60); m += 15) {
      const ms = msAt(day, m);
      const dur = base !== undefined ? Math.round((ms - base) / MIN) : 0;
      const hint = base === undefined ? '' : dur < 60 ? `${dur} min` : `${+(dur / 60).toFixed(2).replace(/0+$/, '')} h`;
      out.push({ min: m % 1440, label: fmtTime(ms, hour24), hint });
    }
    return out;
  });

  function commit() {
    editing = false;
    const m = parseTimeInput(text);
    if (m !== null) onchange(m);
  }

  $effect(() => {
    if (!open) return;
    const cur = minutesOfDay(value);
    queueMicrotask(() => {
      const idx = options.findIndex((o) => o.min === cur);
      const row = listEl?.children[Math.max(0, idx)] as HTMLElement | undefined;
      if (row && listEl) listEl.scrollTop = row.offsetTop - 64;
    });
    const down = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) open = false;
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  });
</script>

<div class="tf" bind:this={root}>
  <input
    class="field num"
    value={shown}
    aria-label={label}
    spellcheck="false"
    autocomplete="off"
    onfocus={(e) => {
      editing = true;
      text = fmtTime(value, hour24);
      open = true;
      e.currentTarget.select();
    }}
    oninput={(e) => (text = e.currentTarget.value)}
    onblur={() => {
      if (editing) commit();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
        open = false;
        e.currentTarget.blur();
      } else if (e.key === 'Escape' && open) {
        e.stopPropagation();
        editing = false;
        open = false;
        e.currentTarget.blur();
      } else if (e.key === 'ArrowDown') open = true;
    }}
  />
  {#if open}
    <div class="list card" bind:this={listEl} role="listbox" aria-label={label}>
      {#each options as o (o.min + o.label)}
        <button
          class="opt num"
          class:cur={o.min === minutesOfDay(value)}
          role="option"
          aria-selected={o.min === minutesOfDay(value)}
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => {
            editing = false;
            open = false;
            onchange(o.min);
          }}
        >
          <span>{o.label}</span><span class="h">{o.hint}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tf { position: relative; width: 84px; flex: none; }
  .tf input { text-align: center; }
  .list {
    position: absolute; z-index: 60; top: 36px; left: 0; width: 148px; max-height: 220px; overflow-y: auto; padding: var(--s1);
    animation: pop 90ms ease-out;
  }
  .opt {
    display: flex; justify-content: space-between; width: 100%; padding: 5px var(--s2); border: 0; border-radius: var(--r-sm);
    background: transparent; text-align: left;
  }
  .opt:hover { background: var(--hover); }
  .opt.cur { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .h { color: var(--text-3); font-size: 11px; }
</style>
