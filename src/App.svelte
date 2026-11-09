<script lang="ts">
  import { onMount } from 'svelte';
  import { onQuickAdd, call } from './lib/tauri';
  import { store } from './lib/store.svelte';
  import { ui } from './lib/ui.svelte';
  import CommandPalette from './lib/components/CommandPalette.svelte';
  import DialogHost from './lib/components/DialogHost.svelte';
  import EventEditor from './lib/components/EventEditor.svelte';
  import MonthGrid from './lib/components/MonthGrid.svelte';
  import QuickAdd from './lib/components/QuickAdd.svelte';
  import Settings from './lib/components/Settings.svelte';
  import Shortcuts from './lib/components/Shortcuts.svelte';
  import Sidebar from './lib/components/Sidebar.svelte';
  import TaskEditor from './lib/components/TaskEditor.svelte';
  import TaskGhost from './lib/components/TaskGhost.svelte';
  import TimeGrid from './lib/components/TimeGrid.svelte';
  import Toasts from './lib/components/Toasts.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';

  onMount(() => {
    void store.init().then(async () => {
      if (await call<boolean>('take_pending_quick_add')) ui.quickAdd = true;
    });
    let n = 0;
    const tick = setInterval(() => {
      store.now = Date.now();
      if (++n % 20 === 0) void store.syncGoogle(); // every 5 minutes
    }, 15_000);
    const onFocus = () => {
      const last = store.settings.googleLastSync ?? 0;
      if (Date.now() - last > 60_000) void store.syncGoogle();
    };
    window.addEventListener('focus', onFocus);
    let off = () => {};
    void onQuickAdd(() => {
      ui.closeEditors();
      ui.palette = false;
      ui.quickAdd = true;
    }).then((u) => (off = u));
    return () => {
      clearInterval(tick);
      window.removeEventListener('focus', onFocus);
      off();
    };
  });

  function isTyping(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  }

  function closeTopLayer(): boolean {
    if (ui.dialog) return ui.answer(null), true;
    if (ui.palette) return (ui.palette = false), true;
    if (ui.shortcuts) return (ui.shortcuts = false), true;
    if (ui.settings) return (ui.settings = false), true;
    if (ui.quickAdd) return (ui.quickAdd = false), true;
    if (ui.editor || ui.taskEditor) return ui.closeEditors(), true;
    if (store.selectedKey) return (store.selectedKey = null), true;
    return false;
  }

  function newEventAtNextHour() {
    const d = new Date(store.cursor);
    const now = new Date();
    const same = d.toDateString() === now.toDateString();
    const h = same ? Math.min(now.getHours() + 1, 22) : 9;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0).getTime();
    ui.editor = {
      occ: null,
      draft: { start, end: start + store.settings.defaultLen * 60_000, allDay: false, calendarId: store.defaultCalendarId() },
      anchor: { x: window.innerWidth / 2 - 190, y: 140, w: 0, h: 0 }
    };
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      if (closeTopLayer()) {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      return;
    }
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      ui.palette = !ui.palette;
      return;
    }
    if (mod && e.key === ',') {
      e.preventDefault();
      ui.settings = true;
      return;
    }
    if (isTyping(e.target) || ui.modalOpen) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const l = store.undo();
      ui.toast(l ? `Undid: ${l}` : 'Nothing to undo');
      return;
    }
    if (mod || e.altKey) return;

    const scrollGrid = (dy: number) =>
      document.querySelector('.tg-scroll')?.scrollBy({ top: dy, behavior: 'smooth' });

    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); store.step(-1); break;
      case 'ArrowRight': e.preventDefault(); store.step(1); break;
      case 'ArrowUp': e.preventDefault(); scrollGrid(-160); break;
      case 'ArrowDown': e.preventDefault(); scrollGrid(160); break;
      case 't': case 'T': store.today(); break;
      case '1': store.setView('day'); break;
      case '2': store.setView('week'); break;
      case '3': store.setView('month'); break;
      case '[': store.setSetting('sidebar', !store.settings.sidebar); break;
      case 'q': case 'Q': e.preventDefault(); ui.closeEditors(); ui.quickAdd = true; break;
      case 'n': case 'N': e.preventDefault(); newEventAtNextHour(); break;
      case 'a': case 'A':
        e.preventDefault();
        if (!store.settings.sidebar) store.setSetting('sidebar', true);
        setTimeout(() => document.getElementById('task-input')?.focus(), 30);
        break;
      case '?': ui.shortcuts = true; break;
      case 'Delete': case 'Backspace': {
        const k = store.selectedKey;
        const occ = k ? store.occs.find((o) => o.key === k) : undefined;
        if (occ) {
          e.preventDefault();
          ui.closeEditors();
          void store.deleteOccurrence(occ);
        }
        break;
      }
      case 'Enter': {
        const k = store.selectedKey;
        const occ = k ? store.occs.find((o) => o.key === k) : undefined;
        const el = k ? document.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`) : null;
        if (occ && el && !ui.editor) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          ui.editor = { occ, draft: null, anchor: { x: r.left, y: r.top, w: r.width, h: r.height } };
        }
        break;
      }
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="app" class:busy={ui.dragging}>
  {#if store.settings.sidebar}<Sidebar />{/if}
  <main>
    <Toolbar />
    {#if store.settings.view === 'month'}
      <MonthGrid />
    {:else}
      <TimeGrid />
    {/if}
  </main>
</div>

{#if ui.editor}
  {#key ui.editor.seq}
    <EventEditor st={ui.editor} />
  {/key}
{/if}
{#if ui.taskEditor}
  {#key ui.taskEditor.id}
    <TaskEditor id={ui.taskEditor.id} anchor={ui.taskEditor.anchor} />
  {/key}
{/if}
{#if ui.palette}<CommandPalette />{/if}
{#if ui.shortcuts}<Shortcuts />{/if}
{#if ui.quickAdd}<QuickAdd />{/if}
{#if ui.settings}<Settings />{/if}
<DialogHost />
<TaskGhost />
<Toasts />

<style>
  .app { display: flex; height: 100%; }
  main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .app.busy { cursor: grabbing; }
</style>
