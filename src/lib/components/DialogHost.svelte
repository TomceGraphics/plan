<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '../ui.svelte';

  const d = $derived(ui.dialog);
  let last: HTMLButtonElement | undefined = $state();
  onMount(() => last?.focus());
</script>

{#if d}
  <div class="scrim" role="presentation" onpointerdown={() => ui.answer(null)}></div>
  <div class="dlg card" role="alertdialog" aria-label={d.title} aria-modal="true">
    <h2>{d.title}</h2>
    {#if d.message}<p>{d.message}</p>{/if}
    <div class="btns">
      {#each d.buttons as b, i (b.value)}
        <button
          class="btn"
          class:primary={b.kind === 'primary'}
          class:danger={b.kind === 'danger'}
          class:solid={b.kind === 'danger'}
          bind:this={last}
          onclick={() => ui.answer(b.value)}
          data-last={i === d.buttons.length - 1}>{b.label}</button
        >
      {/each}
    </div>
  </div>
{/if}

<style>
  .dlg { position: fixed; z-index: 80; inset: 0; margin: auto; height: fit-content; width: 380px; max-width: calc(100vw - 32px); padding: var(--s5); animation: pop 100ms ease-out; }
  .scrim { z-index: 79; }
  h2 { font-size: 15px; margin-bottom: var(--s2); }
  p { color: var(--text-2); margin-bottom: var(--s3); }
  .btns { display: flex; justify-content: flex-end; gap: var(--s2); margin-top: var(--s4); }
</style>
