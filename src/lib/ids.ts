const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short random id. crypto.getRandomValues works in non-secure contexts too. */
export function uid(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let s = Date.now().toString(36);
  for (const x of b) s += ALPHABET[x % 36];
  return s;
}
