import type { JsonSchema, JsonSchemaRoot } from "./types";
import { isPlainObject } from "./types";
import { deref, effectiveSchema } from "./refResolver";

const MAX_DEPTH = 4;

function schemaType(eff: JsonSchema): string | undefined {
  const t = eff.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t[0];
  if (eff.properties || isPlainObject(eff.additionalProperties)) return "object";
  if (eff.items) return "array";
  return undefined;
}

// Placeholder value for a schema, used when inserting properties/objects.
// Rules per PLAN.md §5.5, first match wins.
// An empty string is the natural placeholder, but it is *invalid* whenever
// the schema constrains the string (policy rule names must match
// ^[a-zA-Z0-9_\-.:%]+$, for instance). Offer the first candidate that
// actually satisfies the constraint so a freshly inserted object doesn't
// start out schema-invalid.
function stringStub(eff: JsonSchema, hint?: string): string {
  const minLength = eff.minLength ?? 0;
  let pattern: RegExp | undefined;
  if (eff.pattern) {
    try {
      pattern = new RegExp(eff.pattern);
    } catch {
      pattern = undefined;
    }
  }
  if (!pattern && minLength === 0) return "";
  const candidates = [
    ...(hint ? [`new_${hint}`, hint] : []),
    "new_item",
    "item1",
    "x",
  ];
  for (const candidate of candidates) {
    if (candidate.length < minLength) continue;
    if (pattern && !pattern.test(candidate)) continue;
    return candidate;
  }
  return "";
}

export function stubValue(
  root: JsonSchemaRoot,
  schema: JsonSchema,
  depth = 0,
  hint?: string
): unknown {
  let eff = effectiveSchema(root, schema);
  // For objects, re-evaluate conditionals as they apply to a fresh empty
  // value; this activates requirements like Service_Core's "virtualAddresses
  // is required unless virtualType is internal".
  if (schemaType(eff) === "object") eff = effectiveSchema(root, schema, {});

  if (eff.default !== undefined) return eff.default;
  if (eff.const !== undefined) return eff.const;
  if (eff.enum && eff.enum.length > 0) return eff.enum[0];

  const type = schemaType(eff);
  if (!type) {
    const union = eff.anyOf ?? eff.oneOf;
    const first = union?.[0];
    if (first) return depth > MAX_DEPTH ? "" : stubValue(root, first, depth + 1);
    return "";
  }

  switch (type) {
    case "string":
      return stringStub(eff, hint);
    case "number":
    case "integer":
      return eff.minimum ?? 0;
    case "boolean":
      return false;
    case "array": {
      if (depth >= MAX_DEPTH || !eff.minItems || !eff.items) return [];
      const itemSchema = Array.isArray(eff.items) ? eff.items[0] : eff.items;
      return itemSchema ? [stubValue(root, itemSchema, depth + 1)] : [];
    }
    case "object": {
      const out: Record<string, unknown> = {};
      if (depth >= MAX_DEPTH) return out;
      // A class object always carries its discriminator, required or not.
      const classProp = eff.properties?.class;
      if (classProp) {
        const c = deref(root, classProp);
        if (typeof c.const === "string") out.class = c.const;
      }
      for (const name of eff.required ?? []) {
        if (name in out) continue;
        const propSchema = eff.properties?.[name];
        out[name] = propSchema ? stubValue(root, propSchema, depth + 1, name) : "";
      }
      return out;
    }
    default:
      return "";
  }
}
