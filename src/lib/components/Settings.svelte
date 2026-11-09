<script lang="ts">
  import { onMount } from 'svelte';
  import { format } from 'date-fns';
  import { inTauri } from '../db';
  import type { GCalendar } from '../sync';
  import { call } from '../tauri';
  import { store } from '../store.svelte';
  import { CAL_COLORS, type ThemeSetting } from '../types';
  import { ui } from '../ui.svelte';
  import Icon from './Icon.svelte';

  let trayOk = $state<boolean | null>(null);
  let newName = $state('');
  let colorFor = $state<string | null>(null);
  let clientId = $state('');
  let clientSecret = $state('');
  let gcals = $state.raw<GCalendar[]>([]);
  let gErr = $state<string | null>(null);

  async function loadGoogleCalendars() {
    if (!store.google.connected) return;
    try {
      gcals = await store.googleCalendarList();
      gErr = null;
    } catch (e) {
      gErr = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    if (store.google.connected) void loadGoogleCalendars();
  });
  const linkedTo = (g: GCalendar): string => store.calendars.find((c) => c.gId === g.id)?.id ?? 'none';
  function onLink(g: GCalendar, value: string) {
    const cur = store.calendars.find((c) => c.gId === g.id);
    if (cur) store.unlinkCalendar(cur.id);
    if (value === 'none') return;
    store.linkCalendar(g, value === 'new' ? 'new' : value);
  }
  async function connect() {
    if (await store.googleConnect(clientId, clientSecret)) {
      clientSecret = '';
      void store.syncGoogle();
    }
  }

  onMount(async () => {
    trayOk = (await call<boolean>('tray_registered')) ?? false;
  });

  const themes: [ThemeSetting, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const weekStarts: [0 | 1 | 6, string][] = [[1, 'Monday'], [0, 'Sunday'], [6, 'Saturday']];

  function addCal() {
    const n = newName.trim();
    if (!n) return;
    store.addCalendar(n);
    newName = '';
  }
</script>

<div class="scrim" role="presentation" onpointerdown={() => (ui.settings = false)}></div>
<div class="st card" role="dialog" aria-label="Settings" aria-modal="true">
  <div class="hd">
    <h2>Settings</h2>
    <button class="icon-btn sm" aria-label="Close" onclick={() => (ui.settings = false)}><Icon name="x" /></button>
  </div>
  <div class="body">
    <section>
      <h3>Appearance</h3>
      <div class="r"><span>Theme</span>
        <div class="seg" role="radiogroup" aria-label="Theme">
          {#each themes as [v, l] (v)}
            <button role="radio" aria-checked={store.settings.theme === v} onclick={() => store.setSetting('theme', v)}>{l}</button>
          {/each}
        </div>
      </div>
    </section>

    <section>
      <h3>Calendar</h3>
      <div class="r"><span>Week starts on</span>
        <div class="seg" role="radiogroup" aria-label="Week starts on">
          {#each weekStarts as [v, l] (v)}
            <button role="radio" aria-checked={store.settings.weekStart === v} onclick={() => store.setSetting('weekStart', v)}>{l}</button>
          {/each}
        </div>
      </div>
      <div class="r"><span>Time format</span>
        <div class="seg" role="radiogroup" aria-label="Time format">
          <button role="radio" aria-checked={store.settings.hour24} onclick={() => store.setSetting('hour24', true)}>24-hour</button>
          <button role="radio" aria-checked={!store.settings.hour24} onclick={() => store.setSetting('hour24', false)}>12-hour</button>
        </div>
      </div>
      <div class="r"><span>Default event length</span>
        <select class="field w" aria-label="Default event length" value={String(store.settings.defaultLen)} onchange={(e) => store.setSetting('defaultLen', Number(e.currentTarget.value))}>
          {#each [15, 30, 45, 60, 90, 120] as m (m)}<option value={String(m)}>{m} min</option>{/each}
        </select>
      </div>
      <label class="r"><span>Show weekends</span>
        <input type="checkbox" role="switch" checked={store.settings.showWeekends} onchange={(e) => store.setSetting('showWeekends', e.currentTarget.checked)} />
      </label>
    </section>

    <section>
      <h3>Calendars</h3>
      {#each store.calendars as c (c.id)}
        <div class="cal">
          <button class="sw" style="background:{c.color}" aria-label="Change color of {c.name}" onclick={() => (colorFor = colorFor === c.id ? null : c.id)}></button>
          <input class="field" aria-label="Calendar name" value={c.name} oninput={(e) => store.updateCalendar(c.id, { name: e.currentTarget.value })} />
          <button class="icon-btn sm" aria-label="Make {c.name} the default calendar" title="Default for new events" class:on={store.defaultCalendarId() === c.id} onclick={() => store.setSetting('defaultCalendar', c.id)}>
            <Icon name="check" size={14} />
          </button>
          <button class="icon-btn sm" aria-label="Delete {c.name}" onclick={() => store.deleteCalendar(c.id)}><Icon name="trash" size={14} /></button>
        </div>
        {#if colorFor === c.id}
          <div class="pal">
            {#each CAL_COLORS as col (col)}
              <button class="sw" class:cur={col === c.color} style="background:{col}" aria-label={col} onclick={() => { store.updateCalendar(c.id, { color: col }); colorFor = null; }}></button>
            {/each}
          </div>
        {/if}
      {/each}
      <div class="cal">
        <span class="plus"><Icon name="plus" size={14} /></span>
        <input class="field" placeholder="New calendar" aria-label="New calendar name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && addCal()} />
        <button class="btn sm" onclick={addCal} disabled={!newName.trim()}>Add</button>
      </div>
    </section>

    <section>
      <h3>Google Calendar</h3>
      {#if !inTauri}
        <p class="note">Google sync is available in the desktop app.</p>
      {:else if !store.google.connected}
        <p class="note">Optional two-way sync. Plan keeps working fully offline; Google is only contacted while this is connected.</p>
        {#if !store.google.builtinClient}
          <input class="field g" placeholder="OAuth client ID" aria-label="OAuth client ID" autocomplete="off" spellcheck="false" bind:value={clientId} />
          <input class="field g" type="password" placeholder="OAuth client secret" aria-label="OAuth client secret" autocomplete="off" bind:value={clientSecret} />
          <p class="note">Create a free “Desktop app” OAuth client in Google Cloud Console — step by step in the README under <b>Google Calendar</b>.</p>
        {/if}
        {#if store.google.connecting}
          <p class="note">Waiting for you to approve access in the browser…</p>
          {#if store.google.authUrl}
            <input class="field g" readonly aria-label="Sign-in link" value={store.google.authUrl} onfocus={(e) => e.currentTarget.select()} />
          {/if}
          <button class="btn" onclick={() => store.googleAbort()}>Cancel</button>
        {:else}
          <button class="btn primary" disabled={!store.google.builtinClient && (!clientId.trim() || !clientSecret.trim())} onclick={connect}>Connect Google account</button>
        {/if}
        {#if store.google.error}<p class="err">{store.google.error}</p>{/if}
      {:else}
        <div class="r">
          <span>{store.settings.googleEmail ?? 'Google account'}
            <small>{store.google.busy ? 'Syncing…' : store.settings.googleLastSync ? `Last synced ${format(store.settings.googleLastSync, 'd MMM, HH:mm')}` : 'Not synced yet'}</small></span>
          <span class="gbtn">
            <button class="btn sm" disabled={store.google.busy} onclick={() => void store.syncGoogle()}>Sync now</button>
            <button class="btn sm" onclick={() => void store.googleDisconnect()}>Disconnect</button>
          </span>
        </div>
        {#if store.google.error}<p class="err">{store.google.error}</p>{/if}
        {#if gErr}<p class="err">{gErr}</p>{/if}
        <p class="note">Choose which Google calendars to sync and which Plan calendar each one uses.</p>
        {#each gcals as g (g.id)}
          <div class="cal">
            <span class="sw" style="background:{g.color}"></span>
            <span class="gname">{g.name}{g.readOnly ? ' (read-only)' : ''}</span>
            <select class="field w" aria-label="Sync {g.name} with" value={linkedTo(g)} onchange={(e) => onLink(g, e.currentTarget.value)}>
              <option value="none">Don’t sync</option>
              <option value="new">New Plan calendar</option>
              {#each store.calendars.filter((c) => !c.gId || c.gId === g.id) as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>
        {/each}
      {/if}
    </section>

    <section>
      <h3>System</h3>
      <label class="r"><span>Keep running in the tray when the window is closed
        <small>{trayOk === false ? 'Tray icon could not be registered here, so closing will quit.' : 'Needs a tray host: on GNOME install the AppIndicator extension.'}</small></span>
        <input type="checkbox" role="switch" checked={store.settings.closeToTray} disabled={trayOk === false} onchange={(e) => store.setSetting('closeToTray', e.currentTarget.checked)} />
      </label>
      <div class="r"><span>Quick add from anywhere
        <small>Bind a GNOME custom shortcut to <code>plan --quick-add</code></small></span></div>
      <div class="r"><span>Data
        <small>Stored locally in SQLite (plan.db) in your user data directory. Nothing leaves your machine.</small></span></div>
    </section>
  </div>
</div>

<style>
  .st { position: fixed; z-index: 60; inset: 0; margin: auto; height: fit-content; width: 560px; max-width: calc(100vw - 32px); max-height: calc(100vh - 48px); display: flex; flex-direction: column; animation: fade 100ms ease-out; }
  .hd { display: flex; align-items: center; justify-content: space-between; padding: var(--s4) var(--s5) var(--s2); }
  h2 { font-size: 16px; }
  .body { overflow-y: auto; padding: 0 var(--s5) var(--s5); display: flex; flex-direction: column; gap: var(--s5); }
  h3 { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); margin: var(--s2) 0; }
  .r { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); min-height: 40px; }
  .r > span { display: flex; flex-direction: column; }
  small { color: var(--text-3); font-size: 12px; max-width: 340px; }
  code { font-family: ui-monospace, monospace; background: var(--surface-3); padding: 0 4px; border-radius: 4px; }
    input[type='checkbox'] { accent-color: var(--accent); width: 16px; height: 16px; }
  .cal { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s2); }
  .sw { width: 22px; height: 22px; border-radius: 6px; border: 0; flex: none; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.12); }
  .sw.cur { outline: 2px solid var(--text); outline-offset: 2px; }
  .pal { display: flex; gap: var(--s2); padding: 0 0 var(--s2) 30px; }
  .plus { width: 22px; display: grid; place-items: center; color: var(--text-3); }
  .btn:disabled { opacity: 0.45; pointer-events: none; }
  .note { color: var(--text-2); font-size: 12.5px; margin-bottom: var(--s2); max-width: 470px; }
  .err { color: var(--danger); font-size: 12.5px; margin: var(--s2) 0; }
  .g { margin-bottom: var(--s2); }
  .gbtn { flex-direction: row !important; gap: var(--s2); }
  .gname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .w { width: 170px; }
</style>
