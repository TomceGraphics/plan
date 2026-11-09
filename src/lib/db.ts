import { Q } from './sql';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface Conn {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

let conn: Conn | null = null;
let queue: Promise<unknown> = Promise.resolve();
let onError: (msg: string) => void = (m) => console.error(m);

export function setDbErrorHandler(fn: (msg: string) => void) {
  onError = fn;
}

/** Opens SQLite (migrations run in the Rust plugin). Outside Tauri (plain `vite dev` in a browser) data is in-memory only. */
export async function openDb(): Promise<boolean> {
  if (!inTauri) return false;
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  conn = (await Database.load('sqlite:plan.db')) as unknown as Conn;
  try {
    await conn.execute(Q.walMode);
  } catch {
    /* WAL is an optimisation only */
  }
  return true;
}

export async function select<T>(sql: string): Promise<T[]> {
  if (!conn) return [];
  return (await conn.select<T[]>(sql)) ?? [];
}

/** Fire-and-forget write; writes run strictly in order so the DB mirrors the in-memory state. */
export function write(sql: string, params: unknown[] = []): void {
  if (!conn) return;
  const c = conn;
  queue = queue
    .then(() => c.execute(sql, params))
    .catch((e) => onError(`Could not save: ${e instanceof Error ? e.message : String(e)}`));
}

export function flush(): Promise<unknown> {
  return queue;
}
