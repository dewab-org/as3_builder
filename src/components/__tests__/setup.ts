// Runs before every suite, including the node-environment engine ones — so
// everything DOM-specific is guarded rather than assumed.
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

const hasDom = typeof document !== "undefined";

if (hasDom) {
  afterEach(cleanup);
  // jsdom has no layout, so it implements neither of these. The app calls
  // scrollIntoView to bring a highlighted node into view; which node, and
  // whether anything was already visible, is unit-tested separately.
  Element.prototype.scrollIntoView = vi.fn();
}
