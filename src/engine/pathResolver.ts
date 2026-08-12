import type { JsonPath, JsonSchema, JsonSchemaRoot } from "./types";
import { getAtPath, isPlainObject } from "./types";
import type { ClassRegistry } from "./classRegistry";
import { deref, effectiveSchema } from "./refResolver";

// Rules A–E from PLAN.md §5.3: locate the subschema governing `segment`
// within the flattened schema `eff`.
function findChild(
  root: JsonSchemaRoot,
  eff: JsonSchema,
  segment: string | number,
  docNode: unknown,
  depth = 0
): JsonSchema | undefined {
  if (depth > 6) return undefined;

  if (typeof segment === "string") {
    // A. explicit property
    const prop = eff.properties?.[segment];
    if (prop) return prop;
    // B. patternProperties
    for (const [pattern, schema] of Object.entries(eff.patternProperties ?? {})) {
      try {
        if (new RegExp(pattern).test(segment)) return schema;
      } catch {
        /* bad pattern in schema; ignore */
      }
    }
    // C. additionalProperties as a schema
    if (isPlainObject(eff.additionalProperties)) return eff.additionalProperties;
  } else {
    // E. array index
    if (eff.items) {
      if (Array.isArray(eff.items)) return eff.items[segment] ?? eff.items[0];
      return eff.items;
    }
  }

  // D. union: discriminate by the document's class, else first branch that works
  const union = eff.anyOf ?? eff.oneOf;
  if (union) {
    if (isPlainObject(docNode) && typeof docNode.class === "string") {
      // class discrimination is handled by the caller's registry override;
      // here just fall through to branch trial
    }
    for (const branch of union) {
      const branchEff = effectiveSchema(root, branch, docNode);
      const hit = findChild(root, branchEff, segment, docNode, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

// Walk from the schema root along `path`, returning the raw subschema
// governing the node at `path` (undefined when the path can't be resolved).
// Callers flatten the result with effectiveSchema as needed.
export function resolveSchemaForPath(
  root: JsonSchemaRoot,
  registry: ClassRegistry,
  doc: unknown,
  path: JsonPath
): JsonSchema | undefined {
  let cur: JsonSchema = root;
  let docCur: unknown = doc;

  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const docChild = getAtPath(docCur, [segment]);

    // Class override rule: an object node that names a registered class is
    // governed by that class's definition, regardless of how we got here.
    if (isPlainObject(docChild) && typeof docChild.class === "string") {
      const info = registry.get(docChild.class);
      if (info) {
        cur = info.schema;
        docCur = docChild;
        continue;
      }
    }

    const eff = effectiveSchema(root, cur, docCur);
    const child = findChild(root, eff, segment, docCur);
    if (!child) return undefined;
    cur = deref(root, child);
    docCur = docChild;
  }
  return cur;
}
