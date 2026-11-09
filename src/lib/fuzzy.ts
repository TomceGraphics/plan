export interface FuzzyHit {
  score: number;
  /** matched character indices in the haystack */
  idx: number[];
}

/** Subsequence fuzzy match with bonuses for word starts and consecutive runs. null = no match. */
export function fuzzy(query: string, text: string): FuzzyHit | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, idx: [] };
  const t = text.toLowerCase();
  // fast path: exact substring
  const at = t.indexOf(q);
  if (at !== -1) {
    const idx = Array.from({ length: q.length }, (_, i) => at + i);
    const wordStart = at === 0 || /[\s\-_/]/.test(t[at - 1]);
    return { score: 100 + q.length * 4 + (wordStart ? 30 : 0) - at * 0.5, idx };
  }
  const idx: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === q[qi]) {
        found = ti++;
        break;
      }
    }
    if (found === -1) return null;
    idx.push(found);
    score += 1;
    if (found === prev + 1) score += 5;
    if (found === 0 || /[\s\-_/]/.test(t[found - 1])) score += 8;
    prev = found;
  }
  score -= (idx[idx.length - 1] - idx[0]) * 0.2;
  return { score, idx };
}
