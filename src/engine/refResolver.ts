import type { JsonSchema, JsonSchemaRoot } from "./types";
import { isPlainObject } from "./types";

const derefCaches = new WeakMap<JsonSchemaRoot, Map<string, JsonSchema>>();

// Resolve $ref chains against root.definitions. Returns references into the
// original schema object — never mutate the result.
export function deref(root: JsonSchemaRoot, schema: JsonSchema): JsonSchema {
  let cur = schema;
  const seen = new Set<string>();
  while (cur && typeof cur.$ref === "string") {
    const ref = cur.$ref;
    if (seen.has(ref)) throw new Error(`Circular $ref chain at ${ref}`);
    seen.add(ref);
    let cache = derefCaches.get(root);
    if (!cache) {
      cache = new Map();
      derefCaches.set(root, cache);
    }
    const cached = cache.get(ref);
    if (cached) {
      cur = cached;
      continue;
    }
    const m = /^#\/definitions\/(.+)$/.exec(ref);
    if (!m) throw new Error(`Unsupported $ref format: ${ref}`);
    const target = root.definitions?.[m[1]];
    if (!target) throw new Error(`Unknown $ref: ${ref}`);
    cache.set(ref, target);
    cur = target;
  }
  return cur;
}

// Pragmatic `if` matcher covering the subset this schema's conditionals use:
// type / required / not / properties-with-const-enum-type. Follows draft-07
// semantics: a property MISSING from the document passes the `properties`
// check — presence is gated by `required`. (The AS3 schema relies on this,
// e.g. Address_Discovery_Common's "static" branch matches members that omit
// addressDiscovery entirely.)
function matchesIf(root: JsonSchemaRoot, cond: JsonSchema, docNode: unknown): boolean {
  const c = deref(root, cond);
  if (c.type === "string" && typeof docNode !== "string") return false;
  if (c.type === "object" && !isPlainObject(docNode)) return false;
  if (c.type === "array" && !Array.isArray(docNode)) return false;
  if (c.type === "integer" || c.type === "number") {
    if (typeof docNode !== "number") return false;
  }
  if (c.not && matchesIf(root, c.not, docNode)) return false;
  // Combinators inside a condition (GSLB_Pool gates several branches on
  // "resourceRecordType is A or AAAA" this way). Without these the condition
  // silently passes and the branch's properties get offered everywhere.
  if (c.anyOf && !c.anyOf.some((b) => matchesIf(root, b, docNode))) return false;
  if (c.oneOf) {
    const hits = c.oneOf.filter((b) => matchesIf(root, b, docNode)).length;
    if (hits !== 1) return false;
  }
  if (c.allOf && !c.allOf.every((b) => matchesIf(root, b, docNode))) return false;
  if (c.const !== undefined && JSON.stringify(docNode) !== JSON.stringify(c.const))
    return false;
  if (c.enum && !c.enum.some((v) => JSON.stringify(v) === JSON.stringify(docNode)))
    return false;
  if (c.required) {
    if (!isPlainObject(docNode)) return false;
    for (const key of c.required) if (!(key in docNode)) return false;
  }
  if (c.properties && isPlainObject(docNode)) {
    for (const [key, propSchema] of Object.entries(c.properties)) {
      if (!(key in docNode)) continue; // draft-07: missing property passes
      const p = deref(root, propSchema);
      const value = docNode[key];
      if (p.const !== undefined && value !== p.const) return false;
      if (p.enum && !p.enum.includes(value)) return false;
      if (p.type === "string" && typeof value !== "string") return false;
      if (p.type === "array" && !Array.isArray(value)) return false;
    }
  }
  return true;
}

const MERGE_SKIP_KEYS = new Set(["allOf", "if", "then", "else", "$ref"]);

function mergeInto(target: JsonSchema, branch: JsonSchema): void {
  for (const [key, value] of Object.entries(branch)) {
    if (MERGE_SKIP_KEYS.has(key) || value === undefined) continue;
    if (key === "properties") {
      const props = (target.properties ??= {});
      for (const [name, propSchema] of Object.entries(
        value as Record<string, JsonSchema>
      )) {
        if (!(name in props)) props[name] = propSchema;
      }
    } else if (key === "required") {
      const req = new Set([...(target.required ?? []), ...(value as string[])]);
      target.required = [...req];
    } else if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

// Flatten a schema into one object: deref, merge allOf branches (recursively),
// and apply if/then/else using docNode. anyOf/oneOf are left intact for the
// path resolver to discriminate. Result is a fresh object; nested subschemas
// still reference the original tree.
export function effectiveSchema(
  root: JsonSchemaRoot,
  schema: JsonSchema,
  docNode?: unknown
): JsonSchema {
  const out: JsonSchema = {};
  const seen = new Set<JsonSchema>();

  function absorb(s: JsonSchema): void {
    const d = deref(root, s);
    if (seen.has(d)) return;
    seen.add(d);
    mergeInto(out, d);
    if (d.if) {
      if (docNode !== undefined) {
        const branch = matchesIf(root, d.if, docNode) ? d.then : d.else;
        if (branch) absorb(branch);
      }
    }
    if (d.allOf) {
      for (const b of d.allOf) absorb(b);
    }
  }

  absorb(schema);

  // Discriminate a top-level union against the document: disqualify branches
  // whose `required` keys the doc lacks or whose fixed properties conflict,
  // then absorb the branch with the best property overlap. This surfaces
  // properties hidden inside then/oneOf constructs (e.g. Pool_Member's
  // serverAddresses) without auto-picking unions when no doc is available.
  if (docNode !== undefined) {
    const union = out.anyOf ?? out.oneOf;
    if (union) {
      let best: JsonSchema | undefined;
      let bestScore = -1;
      for (const branch of union) {
        let b: JsonSchema;
        try {
          b = deref(root, branch);
        } catch {
          continue;
        }
        if (!matchesIf(root, b, docNode)) continue;
        let score = 0;
        if (isPlainObject(docNode)) {
          score += (b.required ?? []).length * 2;
          for (const name of Object.keys(b.properties ?? {})) {
            if (name in docNode) score += 1;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = branch;
        }
      }
      if (best) absorb(best);
    }
  }
  return out;
}
