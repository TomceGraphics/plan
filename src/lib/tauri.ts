import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inTauri } from './db';

export async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!inTauri) return undefined;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    console.warn(`invoke ${cmd} failed`, e);
    return undefined;
  }
}

/** Fires when `plan --quick-add` is run (or the tray menu entry is used). */
export async function onQuickAdd(cb: () => void): Promise<() => void> {
  if (!inTauri) return () => {};
  return listen('quick-add', cb);
}
