/**
 * Which Monaco mouse targets describe a node in the document.
 *
 * The content area counts, including the empty space to the right of a line's
 * text: Monaco reports that as CONTENT_EMPTY with the position at the end of
 * that line, and the row is the unit a reader is pointing at — the card should
 * not blink out because the pointer drifted past the closing quote. The gutter,
 * line numbers, glyph margin, scrollbar and overlay widgets are chrome, not
 * document, and describing whatever line they sit beside is noise.
 */
export function isDocumentHoverTarget(
  type: number,
  kinds: { CONTENT_TEXT: number; CONTENT_EMPTY: number }
): boolean {
  return type === kinds.CONTENT_TEXT || type === kinds.CONTENT_EMPTY;
}
