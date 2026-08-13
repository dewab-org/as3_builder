// Drag-and-drop insertion (PLAN.md §8): given the drop location and the
// dragged payload, find the nearest valid ancestor object to insert into.

import type { JsonPath, JsonSchemaRoot } from "./types";
import { getAtPath, isPlainObject } from "./types";
import type { ClassRegistry } from "./classRegistry";
import { effectiveSchema } from "./refResolver";
import { resolveSchemaForPath } from "./pathResolver";
import { stubValue } from "./stubber";
import { sanitizeKey } from "./netboxAs3";

export interface DropPayload {
  name: string;
  isClassObject?: boolean;
  className?: string;
}

export type DropResolution =
  | { ok: true; parentPath: JsonPath; key: string; value: unknown }
  | { ok: false; reason: string };

// Ancestor chain of object nodes containing the drop point, deepest first.
function objectAncestors(doc: unknown, dropPath: JsonPath): JsonPath[] {
  const chain: JsonPath[] = [];
  for (let len = dropPath.length; len >= 0; len--) {
    const path = dropPath.slice(0, len);
    if (isPlainObject(getAtPath(doc, path))) chain.push(path);
  }
  return chain;
}

export function resolveDrop(
  root: JsonSchemaRoot,
  registry: ClassRegistry,
  doc: unknown,
  dropPath: JsonPath,
  payload: DropPayload
): DropResolution {
  const ancestors = objectAncestors(doc, dropPath);

  if (payload.isClassObject && payload.className) {
    const info = registry.get(payload.className);
    if (!info) return { ok: false, reason: `Unknown class ${payload.className}` };
    // New named objects go into the nearest enclosing Application.
    for (const path of ancestors) {
      const node = getAtPath(doc, path) as Record<string, unknown>;
      if (node.class !== "Application") continue;
      let n = 1;
      const base = `new${payload.className.replace(/^Service_/, "Service")}`;
      let key = sanitizeKey(`${base}${n}`);
      while (key in node) {
        n += 1;
        key = sanitizeKey(`${base}${n}`);
      }
      return {
        ok: true,
        parentPath: path,
        key,
        value: stubValue(root, info.schema),
      };
    }
    return {
      ok: false,
      reason: `"${payload.className}" objects can only be dropped inside an Application`,
    };
  }

  // Property drop: deepest ancestor where the schema allows the property and
  // the object doesn't already have it.
  for (const path of ancestors) {
    const node = getAtPath(doc, path) as Record<string, unknown>;
    if (payload.name in node) continue;
    const schema = resolveSchemaForPath(root, registry, doc, path);
    if (!schema) continue;
    let eff;
    try {
      eff = effectiveSchema(root, schema, node);
    } catch {
      continue;
    }
    const propSchema = eff.properties?.[payload.name];
    if (!propSchema) continue;
    return {
      ok: true,
      parentPath: path,
      key: payload.name,
      value: stubValue(root, propSchema),
    };
  }
  return {
    ok: false,
    reason: `"${payload.name}" is not valid at (or above) the drop location`,
  };
}
