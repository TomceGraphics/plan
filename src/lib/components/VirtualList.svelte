<script lang="ts" generics="T extends { key: string; h: number }">
  import type { Snippet } from 'svelte';

  let { items, row, label }: { items: T[]; row: Snippet<[T]>; label: string } = $props();

  let top = $state(0);
  let vh = $state(400);

  const offsets = $derived.by(() => {
    const o = new Array<number>(items.length + 1);
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      o[i] = acc;
      acc += items[i].h;
    }
    o[items.length] = acc;
    return o;
  });
  const total = $derived(offsets[items.length] ?? 0);
  const win = $derived.by(() => {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= top) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 4);
    let end = lo;
    while (end < items.length && offsets[end] < top + vh) end++;
    return { start, end: Math.min(items.length, end + 4) };
  });
</script>

<div
  class="vl"
  role="list"
  aria-label={label}
  bind:clientHeight={vh}
  onscroll={(e) => (top = e.currentTarget.scrollTop)}
>
  <div class="inner" style="height:{total}px">
    {#each items.slice(win.start, win.end) as it, i (it.key)}
      <div class="r" role="listitem" style="height:{it.h}px;transform:translateY({offsets[win.start + i]}px)">
        {@render row(it)}
      </div>
    {/each}
  </div>
</div>

<style>
  .vl { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; position: relative; }
  .inner { position: relative; width: 100%; }
  .r { position: absolute; left: 0; right: 0; top: 0; }
</style>
