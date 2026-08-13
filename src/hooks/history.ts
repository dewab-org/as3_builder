/** Undo/redo stack for the document text, kept pure so it is testable. */

export interface History {
  entries: string[];
  index: number;
}

export const MAX_HISTORY = 200;
/** Consecutive keystrokes inside this window collapse into one undo step. */
export const COALESCE_MS = 600;

export function initHistory(text: string): History {
  return { entries: [text], index: 0 };
}

export function current(h: History): string {
  return h.entries[h.index];
}

export function canUndo(h: History): boolean {
  return h.index > 0;
}

export function canRedo(h: History): boolean {
  return h.index < h.entries.length - 1;
}

/**
 * Add `next` as the newest entry. `coalesce` replaces the newest entry instead
 * of appending — used for runs of typing so a sentence isn't 40 undo steps.
 * The very first entry is never coalesced into, so the document as loaded
 * always stays reachable.
 */
export function push(h: History, next: string, coalesce: boolean): History {
  if (next === h.entries[h.index]) return h;
  // Editing after an undo drops the redo tail, as in any editor.
  const kept = h.entries.slice(0, h.index + 1);
  if (coalesce && kept.length > 1) {
    kept[kept.length - 1] = next;
    return { entries: kept, index: kept.length - 1 };
  }
  kept.push(next);
  if (kept.length > MAX_HISTORY) kept.shift();
  return { entries: kept, index: kept.length - 1 };
}

export function undo(h: History): History {
  return canUndo(h) ? { ...h, index: h.index - 1 } : h;
}

export function redo(h: History): History {
  return canRedo(h) ? { ...h, index: h.index + 1 } : h;
}
