import type { Ev, Occ, Task } from './types';

export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Draft = Partial<Ev> & { start: number; end: number; allDay: boolean };

export interface EditorState {
  /** identifies one editing session (assigned automatically when the editor is opened) */
  seq?: number;
  /** existing occurrence being edited (null for a new draft) */
  occ: Occ | null;
  draft: Draft | null;
  anchor: Anchor;
}

export type DropHover =
  | { kind: 'time'; dayMs: number; start: number; end: number }
  | { kind: 'allday'; dayMs: number }
  | { kind: 'month'; dayMs: number };

export interface TaskDrag {
  task: Task;
  x: number;
  y: number;
  hover: DropHover | null;
}

export interface DialogButton {
  label: string;
  value: string;
  kind?: 'primary' | 'danger' | 'default';
}

export interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
  resolve: (v: string | null) => void;
}

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let toastId = 1;
let editorSeq = 0;

class UI {
  private _editor = $state.raw<EditorState | null>(null);
  get editor(): EditorState | null {
    return this._editor;
  }
  /** Re-assigning with a state that carries the current `seq` keeps the session; anything else starts a new one. */
  set editor(v: EditorState | null) {
    this._editor = v ? { ...v, seq: v.seq ?? ++editorSeq } : null;
  }
  taskEditor = $state.raw<{ id: string; anchor: Anchor } | null>(null);
  palette = $state(false);
  shortcuts = $state(false);
  settings = $state(false);
  quickAdd = $state(false);
  dialog = $state.raw<DialogState | null>(null);
  toasts = $state.raw<Toast[]>([]);
  taskDrag = $state.raw<TaskDrag | null>(null);
  /** pointer-driven drag in progress (used to suppress hover effects / text selection) */
  dragging = $state(false);

  get modalOpen(): boolean {
    return this.palette || this.shortcuts || this.settings || this.quickAdd || this.dialog !== null;
  }

  toast(message: string, action?: Toast['action']): void {
    const id = toastId++;
    this.toasts = [...this.toasts.slice(-3), { id, message, action }];
    setTimeout(() => this.dismissToast(id), action ? 6000 : 3500);
  }
  dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }

  ask(opts: Omit<DialogState, 'resolve'>): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialog = { ...opts, resolve };
    });
  }
  answer(v: string | null): void {
    const d = this.dialog;
    this.dialog = null;
    d?.resolve(v);
  }

  closeEditors(): void {
    this.editor = null;
    this.taskEditor = null;
  }
}

export const ui = new UI();
