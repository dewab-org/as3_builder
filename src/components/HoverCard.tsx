import { useLayoutEffect, useRef, useState } from "react";
import type {
  ClassRegistry,
  DocumentationIndex,
  JsonPath,
  JsonSchemaRoot,
} from "../engine";
import { DetailCard } from "./AddableList";
import { hoverDetail } from "./hoverDetail";

export interface HoverAnchor {
  path: JsonPath;
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
}

const GAP = 14; // clear of the cursor, close enough to read as attached
const MARGIN = 8; // keep this far from the viewport edge

/**
 * The detail card, floating next to the pointer instead of parked in the info
 * pane — hovering is a question about *this* thing, so the answer belongs
 * where you are looking.
 *
 * The card can be moved into and clicked — the doc links are the point of it.
 * That works because leaving a row schedules the close rather than doing it
 * immediately, and entering the card cancels that: the pointer can cross the
 * gap without the card vanishing underneath it.
 *
 * Clicking it pins it: the card stops following the pointer, so it can be read
 * at length while you hover other things. Escape, the ✕, or a click anywhere
 * else lets it go.
 */
export default function HoverCard({
  anchor,
  doc,
  schemaRoot,
  registry,
  documentation,
  onPointerEnter,
  onPointerLeave,
  pinned,
  onPin,
  onUnpin,
}: {
  anchor: HoverAnchor;
  doc: unknown;
  schemaRoot: JsonSchemaRoot;
  registry: ClassRegistry;
  documentation: DocumentationIndex | undefined;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const detail = hoverDetail(
    anchor.path,
    doc,
    schemaRoot,
    registry,
    documentation
  );
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({
    left: anchor.x + GAP,
    top: anchor.y + GAP,
  });

  // Measure after render: flip to the other side of the cursor rather than
  // spilling off screen, which is how a card near the right edge or low in a
  // long declaration would otherwise land.
  useLayoutEffect(() => {
    const el = ref.current;
    // A pinned card keeps where it was pinned, so it never hops mid-read.
    if (!el || pinned) return;
    const { width, height } = el.getBoundingClientRect();
    // Some embedded/headless viewports report 0; flipping against that would
    // pin every card to the corner, so trust the measurement only when there
    // is one.
    const viewWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewHeight =
      document.documentElement.clientHeight || window.innerHeight;
    let left = anchor.x + GAP;
    let top = anchor.y + GAP;
    if (viewWidth > 0 && left + width > viewWidth - MARGIN)
      left = Math.max(MARGIN, anchor.x - GAP - width);
    if (viewHeight > 0 && top + height > viewHeight - MARGIN)
      top = Math.max(MARGIN, anchor.y - GAP - height);
    setPlacement({ left, top });
  }, [anchor.x, anchor.y, anchor.path, pinned]);

  // Nothing to say about this node: no empty card.
  if (!detail) return null;

  return (
    <div
      ref={ref}
      className={`hover-card${pinned ? " pinned" : ""}`}
      style={{ left: placement.left, top: placement.top }}
      role="tooltip"
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onClick={() => {
        if (!pinned) onPin();
      }}
    >
      <div className="hover-card-bar">
        <span className="hover-card-hint">
          {pinned ? "pinned — Esc to dismiss" : "click to pin"}
        </span>
        {pinned && (
          <button
            className="hover-card-close"
            title="Dismiss (Esc)"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onUnpin();
            }}
          >
            ✕
          </button>
        )}
      </div>
      <DetailCard label={detail.label} detail={detail.detail} />
    </div>
  );
}
