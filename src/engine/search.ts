import type { JsonPath } from "./types";
import { pathKey } from "./relationships";

/**
 * Find-in-document for the panes: which paths match `query`, by key or by
 * scalar value, case-insensitively.
 *
 * The result contains the matches AND their ancestors, so a view can dim
 * everything else while keeping the route to each match visible — a match
 * deep in a pool is no use if the pool it sits in is dimmed away.
 *
 * Returns null for a blank query: "not searching" and "searching with no
 * hits" need to look different.
 */
export function searchMatches(
  doc: unknown,
  query: string
): Set<string> | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  const out = new Set<string>();

  const visit = (node: unknown, path: JsonPath): boolean => {
    let hit = false;
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        // The item's own index is part of the route to a hit inside it —
        // without it, a matching pool member renders dimmed.
        if (visit(item, [...path, i])) {
          out.add(pathKey([...path, i]));
          hit = true;
        }
      });
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        const child = [...path, key];
        let childHit = key.toLowerCase().includes(needle);
        if (visit(value, child)) childHit = true;
        if (childHit) {
          out.add(pathKey(child));
          hit = true;
        }
      }
    } else if (
      String(node ?? "")
        .toLowerCase()
        .includes(needle)
    ) {
      out.add(pathKey(path));
      hit = true;
    }
    return hit;
  };

  visit(doc, []);
  return out;
}
