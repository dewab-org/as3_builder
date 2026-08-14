import { useLayoutEffect, useRef, useState } from "react";
import type {
  ClassRegistry,
  DocumentationIndex,
  JsonPath,
  JsonSchemaRoot,
} from "../engine";
import HoverDetail from "./HoverDetail";

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
 * It never takes the pointer: a card that could be hovered would change what
 * is hovered, and chasing the cursor while it moves would flicker. The same
 * card is available, clickable, from the ⓘ button in the property picker.
 */
export default function HoverCard({
  anchor,
  doc,
  schemaRoot,
  registry,
  documentation,
}: {
  anchor: HoverAnchor;
  doc: unknown;
  schemaRoot: JsonSchemaRoot;
  registry: ClassRegistry;
  documentation: DocumentationIndex | undefined;
}) {
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
    if (!el) return;
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
  }, [anchor.x, anchor.y, anchor.path]);

  return (
    <div
      ref={ref}
      className="hover-card"
      style={{ left: placement.left, top: placement.top }}
      role="tooltip"
    >
      <HoverDetail
        path={anchor.path}
        doc={doc}
        schemaRoot={schemaRoot}
        registry={registry}
        documentation={documentation}
      />
    </div>
  );
}
