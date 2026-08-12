import type { JsonPath } from "./types";
import { isPlainObject } from "./types";

export interface ClassInstance {
  name: string;
  className: string;
  path: JsonPath;
}

// Every object in the document carrying a string `class`, with the key it
// sits under. Used by cross-reference pickers.
export function indexClassInstances(doc: unknown): ClassInstance[] {
  const out: ClassInstance[] = [];

  function walk(node: unknown, path: JsonPath): void {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (!isPlainObject(node)) return;
    if (typeof node.class === "string" && path.length > 0) {
      out.push({
        name: String(path[path.length - 1]),
        className: node.class,
        path,
      });
    }
    for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
  }

  walk(doc, []);
  return out;
}
