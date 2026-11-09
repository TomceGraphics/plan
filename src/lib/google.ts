import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inTauri } from './db';
import { AuthError, type GApi } from './sync';

export interface GoogleStatus {
  connected: boolean;
  /** true when the build ships its own OAuth client (PLAN_GOOGLE_CLIENT_ID at build time) */
  builtinClient: boolean;
}

export async function googleStatus(): Promise<GoogleStatus> {
  if (!inTauri) return { connected: false, builtinClient: false };
  try {
    return await invoke<GoogleStatus>('google_status');
  } catch {
    return { connected: false, builtinClient: false };
  }
}

export const googleSignIn = (clientId?: string, clientSecret?: string): Promise<void> =>
  invoke('google_sign_in', { clientId: clientId || null, clientSecret: clientSecret || null });
export const googleCancel = (): Promise<void> => invoke('google_cancel');
export const googleSignOut = (): Promise<void> => invoke('google_sign_out');

/** The authorisation URL, emitted so the UI can offer it if the browser did not open. */
export function onAuthUrl(cb: (url: string) => void): Promise<() => void> {
  if (!inTauri) return Promise.resolve(() => {});
  return listen<string>('google-auth-url', (e) => cb(e.payload));
}

/** All Google traffic goes through Rust: tokens never reach the webview, no CORS/CSP exceptions needed. */
export const gApi: GApi = {
  async request(method, path, query, body) {
    try {
      const r = await invoke<{ status: number; body: string }>('google_request', {
        method, path, query: query ?? null, body: body === undefined ? null : JSON.stringify(body)
      });
      let parsed: unknown = null;
      try {
        parsed = r.body ? JSON.parse(r.body) : null;
      } catch {
        /* non-JSON body (e.g. 204) */
      }
      return { status: r.status, body: parsed };
    } catch (e) {
      const msg = String(e);
      if (msg.includes('not_connected') || msg.includes('auth_expired')) throw new AuthError();
      throw new Error(msg);
    }
  }
};
