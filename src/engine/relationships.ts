import type { JsonPath } from "./types";
import { isPlainObject } from "./types";

/** Stable key for a path — the same encoding the views use for identity. */
export function pathKey(path: JsonPath): string {
  return path.map(String).join("\u0000");
}

//
// AS3 objects reference each other by name within an application: a service's
// `pool` names a Pool, `serverTLS.use` names a TLS_Server, `monitors[i].use`
// names a Monitor. Selecting either end lights up the other, so the link is
// visible instead of something you hold in your head.

/** Keys whose string value is prose, never a reference. */
const NON_POINTER_KEYS = new Set(["class", "label", "remark", "name"]);

/** Members of the application: name → true, for objects that carry a class. */
function appMembers(app: unknown): Set<string> {
  const out = new Set<string>();
  if (!isPlainObject(app)) return out;
  for (const [key, value] of Object.entries(app))
    if (isPlainObject(value) && typeof value.class === "string") out.add(key);
  return out;
}

/** Every path under `app` whose value names `target`. */
function pathsPointingAt(
  app: unknown,
  appKey: string | number,
  target: string,
  out: string[] = [],
  path: JsonPath = []
): string[] {
  if (Array.isArray(app)) {
    app.forEach((item, i) => pathsPointingAt(item, appKey, target, out, [...path, i]));
    return out;
  }
  if (!isPlainObject(app)) return out;
  for (const [key, value] of Object.entries(app)) {
    if (typeof value === "string") {
      if (value === target && !NON_POINTER_KEYS.has(key))
        out.push(pathKey([appKey, ...path, key]));
    } else if (typeof value === "object" && value !== null) {
      pathsPointingAt(value, appKey, target, out, [...path, key]);
    }
  }
  return out;
}

/** Every member name referenced anywhere inside `node`. */
function pointersWithin(
  node: unknown,
  members: Set<string>,
  out: Set<string> = new Set()
): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) pointersWithin(item, members, out);
    return out;
  }
  if (!isPlainObject(node)) return out;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      if (members.has(value) && !NON_POINTER_KEYS.has(key)) out.add(value);
    } else if (typeof value === "object" && value !== null) {
      pointersWithin(value, members, out);
    }
  }
  return out;
}

/**
 * Paths to highlight for the current selection — both directions of the
 * relationship, since either end is a reasonable place to start:
 *
 * - what the selection points AT (the TLS_Server a serverTLS names, the Pool
 *   a service uses). Selection normalises to the containing object, so this
 *   looks through the whole selected subtree, not just a scalar row.
 * - what points AT the selection, when an application member is selected.
 */
export function relatedPaths(doc: unknown, cursorPath: JsonPath): Set<string> {
  const related = new Set<string>();
  // [app] alone is the whole application — every member would light up.
  if (cursorPath.length < 2 || !isPlainObject(doc)) return related;
  const appKey = cursorPath[0];
  const app = (doc as Record<string, unknown>)[String(appKey)];
  if (!isPlainObject(app)) return related;
  const members = appMembers(app);

  const selected = getAt(doc, cursorPath);
  const leafKey = cursorPath[cursorPath.length - 1];
  if (typeof selected === "string") {
    if (
      members.has(selected) &&
      !(typeof leafKey === "string" && NON_POINTER_KEYS.has(leafKey))
    )
      related.add(pathKey([appKey, selected]));
  } else {
    for (const name of pointersWithin(selected, members))
      related.add(pathKey([appKey, name]));
  }

  // Reverse: the selected object is itself a target.
  if (cursorPath.length === 2 && members.has(String(cursorPath[1]))) {
    for (const p of pathsPointingAt(app, appKey, String(cursorPath[1])))
      related.add(p);
  }
  // Never mark the selection as its own relation.
  related.delete(pathKey(cursorPath));
  return related;
}

function getAt(doc: unknown, path: JsonPath): unknown {
  let cur: unknown = doc;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}
