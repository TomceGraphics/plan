<script lang="ts">
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { clamp } from '../time';
  import type { Anchor } from '../ui.svelte';

  let {
    anchor, width = 348, label, onclose, children
  }: { anchor: Anchor; width?: number; label: string; onclose: () => void; children: Snippet } = $props();

  let el: HTMLDivElement | undefined = $state();
  let x = $state(-9999);
  let y = $state(-9999);
  let shown = $state(false);

  function place() {
    if (!el) return;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 10;
    let nx = anchor.x + anchor.w + gap;
    if (nx + width > vw - 8) nx = anchor.x - width - gap;
    if (nx < 8) nx = clamp(anchor.x + anchor.w / 2 - width / 2, 8, vw - width - 8);
    // whole pixels only: fractional offsets make WebKitGTK resample the text (blur)
    x = Math.round(nx);
    y = Math.round(clamp(anchor.y - 8, 8, Math.max(8, vh - h - 8)));
    shown = true;
  }

  onMount(() => {
    place();
    const ro = new ResizeObserver(place);
    if (el) ro.observe(el);
    const down = (e: PointerEvent) => {
      if (el && !el.contains(e.target as Node)) onclose();
    };
    window.addEventListener('pointerdown', down, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('pointerdown', down, true);
    };
  });
</script>

<div
  bind:this={el}
  class="pop card"
  class:shown
  role="dialog"
  aria-label={label}
  style="width:{width}px;left:{x}px;top:{y}px"
>
  {@render children()}
</div>

<style>
  .pop {
    position: fixed; z-index: 40; opacity: 0;
    max-height: calc(100vh - 16px);
  }
  .pop.shown { opacity: 1; transition: opacity 90ms ease-out; }
</style>
