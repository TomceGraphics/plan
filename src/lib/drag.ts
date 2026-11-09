import { ui } from './ui.svelte';

export interface TrackOpts {
  /** pixels before a press becomes a drag */
  threshold?: number;
  onStart?: (e: PointerEvent) => void;
  onMove: (e: PointerEvent, dx: number, dy: number) => void;
  onEnd: (e: PointerEvent, moved: boolean) => void;
  onCancel?: () => void;
  /** element that should auto-scroll when the pointer nears its top/bottom edge */
  scroller?: () => HTMLElement | null;
}

/** Pointer-driven drag helper (window-level listeners, Esc to cancel, edge auto-scroll). */
export function track(e: PointerEvent, o: TrackOpts): void {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const th = o.threshold ?? 4;
  let moved = false;
  let last = e;
  let raf = 0;

  const edge = () => {
    const el = o.scroller?.();
    if (el && moved) {
      const r = el.getBoundingClientRect();
      const zone = 40;
      let v = 0;
      if (last.clientY < r.top + zone) v = -Math.ceil(((r.top + zone - last.clientY) / zone) * 14);
      else if (last.clientY > r.bottom - zone) v = Math.ceil(((last.clientY - (r.bottom - zone)) / zone) * 14);
      if (v) {
        const before = el.scrollTop;
        el.scrollTop += v;
        if (el.scrollTop !== before) o.onMove(last, last.clientX - x0, last.clientY - y0);
      }
    }
    raf = requestAnimationFrame(edge);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    cancelAnimationFrame(raf);
    document.body.classList.remove('dragging-global');
    ui.dragging = false;
  };
  const move = (ev: PointerEvent) => {
    last = ev;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!moved) {
      if (Math.hypot(dx, dy) < th) return;
      moved = true;
      document.body.classList.add('dragging-global');
      ui.dragging = true;
      o.onStart?.(ev);
      if (o.scroller) raf = requestAnimationFrame(edge);
    }
    o.onMove(ev, dx, dy);
  };
  const up = (ev: PointerEvent) => {
    cleanup();
    o.onEnd(ev, moved);
  };
  const cancel = () => {
    cleanup();
    o.onCancel?.();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      cancel();
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

export const anchorOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
