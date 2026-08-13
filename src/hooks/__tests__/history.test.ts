import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  current,
  initHistory,
  push,
  redo,
  undo,
} from "../history";

describe("document history", () => {
  it("starts with nothing to undo or redo", () => {
    const h = initHistory("a");
    expect(current(h)).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("walks back and forward through discrete edits", () => {
    let h = push(push(initHistory("a"), "b", false), "c", false);
    expect(current(h)).toBe("c");
    h = undo(h);
    expect(current(h)).toBe("b");
    h = undo(h);
    expect(current(h)).toBe("a");
    expect(canUndo(h)).toBe(false);
    h = redo(redo(h));
    expect(current(h)).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("collapses a coalesced run into one step", () => {
    let h = push(initHistory("a"), "ab", true);
    h = push(h, "abc", true);
    h = push(h, "abcd", true);
    expect(current(h)).toBe("abcd");
    expect(current(undo(h))).toBe("a");
  });

  it("never coalesces into the initial entry", () => {
    const h = push(initHistory("a"), "ab", true);
    expect(h.entries).toEqual(["a", "ab"]);
    expect(current(undo(h))).toBe("a");
  });

  it("ignores a no-op push", () => {
    const h = initHistory("a");
    expect(push(h, "a", false)).toBe(h);
  });

  it("drops the redo tail when editing after an undo", () => {
    let h = push(push(initHistory("a"), "b", false), "c", false);
    h = push(undo(h), "b2", false);
    expect(h.entries).toEqual(["a", "b", "b2"]);
    expect(canRedo(h)).toBe(false);
  });

  it("caps the stack, keeping the newest entries", () => {
    let h = initHistory("0");
    for (let i = 1; i <= MAX_HISTORY + 10; i++) h = push(h, String(i), false);
    expect(h.entries.length).toBe(MAX_HISTORY);
    expect(current(h)).toBe(String(MAX_HISTORY + 10));
    expect(h.index).toBe(MAX_HISTORY - 1);
  });
});
