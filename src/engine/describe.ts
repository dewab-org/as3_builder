// Everything the schema knows about a (property) schema, structured for the
// detail cards. The AS3 schema is the authoritative source — the F5
// clouddocs reference is generated from these same descriptions.

import type { JsonSchema, JsonSchemaRoot } from "./types";
import { isPlainObject } from "./types";
import { deref, effectiveSchema } from "./refResolver";
import type { FieldDocumentation, TmshEquivalency } from "./documentation";

export interface SchemaBranch {
  type: string;
  summary?: string;
}

export interface SchemaDocs {
  description?: string;
  /** Expanded operational behavior supplied by the generated F5 docs index. */
  behavior?: string;
  type: string;
  constraints: string[];
  defaultValue?: unknown;
  enumValues?: (string | number)[];
  /** oneOf/anyOf alternatives ("integer" OR "Firewall_Port_List reference"). */
  branches?: SchemaBranch[];
  tmsh?: TmshEquivalency;
}

const FORMAT_HINTS: Record<string, string> = {
  f5ip: "IP address (IPv4/IPv6, optional %routedomain and /prefix)",
  f5bigip: "absolute BIG-IP path (/Common/…)",
  f5pointer: "AS3 pointer",
  hostname: "hostname",
  uri: "URI",
  email: "email address",
  "date-time": "date-time",
};

function typeName(s: JsonSchema): string {
  if (s.enum && s.enum.length > 0) return "enum";
  if (typeof s.type === "string") return s.type;
  if (Array.isArray(s.type) && s.type.length > 0) return s.type.join(" | ");
  if (s.properties || isPlainObject(s.additionalProperties)) return "object";
  if (s.items) return "array";
  if (s.const !== undefined) return `constant ${JSON.stringify(s.const)}`;
  return "any";
}

function constraintsOf(s: JsonSchema): string[] {
  const out: string[] = [];
  if (s.minimum !== undefined && s.maximum !== undefined)
    out.push(`range ${s.minimum}–${s.maximum}`);
  else if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`);
  else if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`);
  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`);
  if (s.exclusiveMaximum !== undefined) out.push(`< ${s.exclusiveMaximum}`);
  if (s.multipleOf !== undefined) out.push(`multiple of ${s.multipleOf}`);
  if (s.minLength !== undefined || s.maxLength !== undefined) {
    const min = s.minLength ?? 0;
    out.push(
      s.maxLength !== undefined
        ? `${min}–${s.maxLength} characters`
        : `≥ ${min} characters`
    );
  }
  if (s.pattern) out.push(`pattern ${s.pattern}`);
  if (typeof s.format === "string")
    out.push(FORMAT_HINTS[s.format] ?? `format ${s.format}`);
  if (s.minItems !== undefined || s.maxItems !== undefined) {
    const min = s.minItems ?? 0;
    out.push(
      s.maxItems !== undefined
        ? `${min}–${s.maxItems} items`
        : `≥ ${min} item${min === 1 ? "" : "s"}`
    );
  }
  return out;
}

function branchSummary(root: JsonSchemaRoot, branch: JsonSchema): SchemaBranch {
  let b: JsonSchema;
  try {
    b = effectiveSchema(root, branch);
  } catch {
    b = branch;
  }
  const parts: string[] = [];
  const d = (b.title ?? b.description) as string | undefined;
  if (d) parts.push(String(d).slice(0, 90));
  const cons = constraintsOf(b);
  if (cons.length > 0) parts.push(cons.join(", "));
  if (b.properties?.use || b.properties?.bigip)
    parts.push("reference ({use: name} or {bigip: path})");
  return { type: typeName(b), summary: parts.join(" — ") || undefined };
}

// Full documentation for one (property) schema, unions included. Pass the
// current document value when available: many properties hide their real
// enum/constraints inside an if/then branch keyed on that value (a Pool
// member's addressDiscovery, for one).
export function describeSchema(
  root: JsonSchemaRoot,
  schema: JsonSchema,
  docValue?: unknown,
  augmentation?: FieldDocumentation
): SchemaDocs {
  let eff: JsonSchema;
  try {
    eff = effectiveSchema(root, schema, docValue);
  } catch {
    eff = schema;
  }
  const docs: SchemaDocs = {
    description: (eff.description ?? eff.title) as string | undefined,
    behavior: augmentation?.behavior,
    type: typeName(eff),
    constraints: constraintsOf(eff),
    tmsh: augmentation?.tmsh,
  };
  if (eff.default !== undefined) docs.defaultValue = eff.default;
  if (eff.enum)
    docs.enumValues = eff.enum.filter(
      (v): v is string | number =>
        typeof v === "string" || typeof v === "number"
    );
  const union = eff.oneOf ?? eff.anyOf;
  if (union && union.length > 1) {
    docs.branches = union.map((b) => branchSummary(root, deref(root, b)));
  }
  // Array items: surface the item type's constraints too.
  if (!docs.branches && eff.items && !Array.isArray(eff.items)) {
    const item = branchSummary(root, eff.items);
    if (item.summary || item.type !== "any")
      docs.constraints.push(
        `items: ${item.type}${item.summary ? ` (${item.summary})` : ""}`
      );
  }
  return docs;
}
