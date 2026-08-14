import { describe, expect, it } from "vitest";
import { isDocumentHoverTarget } from "../../components/editorHover";

// Monaco's MouseTargetType, by name — the numbers are its business.
const KINDS = {
  UNKNOWN: 0,
  TEXTAREA: 1,
  GUTTER_GLYPH_MARGIN: 2,
  GUTTER_LINE_NUMBERS: 3,
  GUTTER_LINE_DECORATIONS: 4,
  GUTTER_VIEW_ZONE: 5,
  CONTENT_TEXT: 6,
  CONTENT_EMPTY: 7,
  CONTENT_VIEW_ZONE: 8,
  CONTENT_WIDGET: 9,
  OVERVIEW_RULER: 10,
  SCROLLBAR: 11,
  OVERLAY_WIDGET: 12,
};

describe("which editor targets describe a document node", () => {
  it("takes the content area, text and the space past the line's end", () => {
    expect(isDocumentHoverTarget(KINDS.CONTENT_TEXT, KINDS)).toBe(true);
    // Drifting right of the closing quote is still pointing at that row.
    expect(isDocumentHoverTarget(KINDS.CONTENT_EMPTY, KINDS)).toBe(true);
  });

  it("ignores the chrome beside the content", () => {
    for (const kind of [
      KINDS.GUTTER_GLYPH_MARGIN,
      KINDS.GUTTER_LINE_NUMBERS,
      KINDS.GUTTER_LINE_DECORATIONS,
      KINDS.SCROLLBAR,
      KINDS.OVERVIEW_RULER,
      KINDS.OVERLAY_WIDGET,
      KINDS.CONTENT_WIDGET,
      KINDS.TEXTAREA,
      KINDS.UNKNOWN,
    ])
      expect(isDocumentHoverTarget(kind, KINDS)).toBe(false);
  });
});
