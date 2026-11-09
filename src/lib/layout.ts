export interface Placed<T> {
  item: T;
  col: number;
  cols: number;
  span: number;
}

/**
 * Overlap layout for one day column. Items are grouped into clusters of transitively
 * overlapping events; inside a cluster each item gets the first free column, then
 * expands rightwards over columns that are free for its whole duration.
 * `minLen` (ms) is the visual minimum height so very short events still count as overlapping.
 */
export function layoutDay<T extends { start: number; end: number }>(items: T[], minLen = 20 * 60_000): Placed<T>[] {
  const sorted = items
    .map((item) => ({ item, s: item.start, e: Math.max(item.end, item.start + minLen) }))
    .sort((a, b) => a.s - b.s || b.e - a.e);

  const out: Placed<T>[] = [];
  let cluster: { item: T; s: number; e: number; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const cols = colEnds.length;
    for (const c of cluster) {
      let span = 1;
      while (c.col + span < cols) {
        const col = c.col + span;
        if (cluster.some((o) => o.col === col && o.s < c.e && o.e > c.s)) break;
        span++;
      }
      out.push({ item: c.item, col: c.col, cols, span });
    }
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    if (it.s >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.s);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(it.e);
    } else colEnds[col] = it.e;
    cluster.push({ ...it, col });
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
  return out;
}
