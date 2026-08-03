// THE drag primitive. Every gesture in the studio — joint drags, ruler scrubs,
// keyframe drags, and (M5+) every canvas tool — runs through this one path:
// window-level listeners with pointer capture, an optional pending→dragging
// travel threshold, and Esc-cancel.

import { onScopeDispose } from 'vue';

export interface DragHandler {
  onMove: (event: PointerEvent) => void;
  onUp?: (event: PointerEvent) => void;
  onCancel?: () => void;
}

export interface DragOptions {
  /** Pixels of travel before onMove starts firing. Defaults to 3; pass 0 for gestures that must track immediately (scrubs). */
  threshold?: number;
}

export function usePointerDrag() {
  interface Active {
    handler: DragHandler;
    startX: number;
    startY: number;
    threshold: number;
    dragging: boolean;
  }
  let active: Active | null = null;

  const onMove = (event: PointerEvent) => {
    if (!active) {
      return;
    }
    if (!active.dragging) {
      const travel = Math.hypot(event.clientX - active.startX, event.clientY - active.startY);
      if (travel < active.threshold) {
        return;
      }
      active.dragging = true;
    }
    active.handler.onMove(event);
  };

  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('keydown', onKey, true);
    active = null;
  };

  const onUp = (event: PointerEvent) => {
    const current = active;
    detach();
    current?.handler.onUp?.(event);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return;
    }
    event.stopPropagation();
    const current = active;
    detach();
    current?.handler.onCancel?.();
  };

  const start = (event: PointerEvent, handler: DragHandler, { threshold = 3 }: DragOptions = {}) => {
    detach();
    active = { handler, startX: event.clientX, startY: event.clientY, threshold, dragging: false };
    // Capture keeps the stream when the pointer leaves the window; captured
    // events still bubble, so the window listeners below keep receiving them.
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  const cancel = () => {
    const current = active;
    detach();
    current?.handler.onCancel?.();
  };

  onScopeDispose(detach);

  return {
    start,
    cancel,
    get dragging() {
      return active?.dragging ?? false;
    },
  };
}
