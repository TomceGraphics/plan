<script lang="ts">
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  const groups: { title: string; rows: [string, string[]][] }[] = [
    {
      title: 'Navigate',
      rows: [
        ['Previous / next period', ['←', '→']],
        ['Scroll the time grid', ['↑', '↓']],
        ['Go to today', ['T']],
        ['Day / Week / Month', ['1', '2', '3']],
        ['Toggle sidebar', ['[']]
      ]
    },
    {
      title: 'Create & edit',
      rows: [
        ['Quick add (event or task)', ['Q']],
        ['New event', ['N']],
        ['New task', ['A']],
        ['Open selected event', ['Enter']],
        ['Delete selected event', ['Del']],
        ['Undo', ['Ctrl', 'Z']]
      ]
    },
    {
      title: 'Calendar mouse',
      rows: [
        ['Create event', ['drag on grid']],
        ['Move event', ['drag']],
        ['Resize event', ['drag top / bottom edge']],
        ['Time-block a task', ['drag task onto grid']],
        ['Zoom hours', ['Ctrl', 'wheel']]
      ]
    },
    {
      title: 'General',
      rows: [
        ['Command palette', ['Ctrl', 'K']],
        ['Settings', ['Ctrl', ',']],
        ['This cheat sheet', ['?']],
        ['Close popover / dialog', ['Esc']]
      ]
    }
  ];
</script>

<div class="scrim" role="presentation" onpointerdown={() => (ui.shortcuts = false)}></div>
<div class="sh card" role="dialog" aria-label="Keyboard shortcuts" aria-modal="true">
  <div class="hd">
    <h2>Keyboard shortcuts</h2>
    <button class="icon-btn sm" aria-label="Close" onclick={() => (ui.shortcuts = false)}><Icon name="x" /></button>
  </div>
  <div class="grid">
    {#each groups as g (g.title)}
      <section>
        <h3>{g.title}</h3>
        {#each g.rows as [label, keys] (label)}
          <div class="r">
            <span>{label}</span>
            <span class="k">{#each keys as k (k)}<span class="kbd">{k}</span>{/each}</span>
          </div>
        {/each}
      </section>
    {/each}
  </div>
</div>

<style>
  .sh { position: fixed; z-index: 60; inset: 0; margin: auto; height: fit-content; width: 700px; max-width: calc(100vw - 32px); padding: var(--s5) var(--s6) var(--s6); animation: fade 100ms ease-out; max-height: calc(100vh - 32px); overflow-y: auto; }
  .hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s4); }
  h2 { font-size: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s6) var(--s8); }
  h3 { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); margin-bottom: var(--s2); }
  .r { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); height: 30px; color: var(--text-2); }
  .k { display: flex; gap: 4px; }
</style>
