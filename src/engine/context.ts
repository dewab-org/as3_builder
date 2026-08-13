import { getLocation, parse } from "jsonc-parser";
import type { JsonPath, JsonSchema, JsonSchemaRoot } from "./types";
import { getAtPath, isPlainObject } from "./types";
import type { ClassRegistry } from "./classRegistry";
import { deref, effectiveSchema } from "./refResolver";
import { resolveSchemaForPath } from "./pathResolver";
import { indexClassInstances } from "./docIndex";

export interface PropertyInfo {
  name: string;
  schema: JsonSchema; // effective, deref'd
  type: string; // "string" | "number" | "integer" | "boolean" | "object" | "array" | "enum" | "unknown"
  description?: string;
  required: boolean;
  enumValues?: (string | number)[];
  default?: unknown;
  present: boolean;
  // Classes this property may point at (from f5PostProcess pointer tags);
  // set only for cross-reference properties.
  xrefClasses?: string[];
}

export interface UnknownProp {
  name: string;
  /** Rough type of the value present in the document. */
  valueType: string;
}

export interface NodeContext {
  path: JsonPath;
  breadcrumb: string;
  className?: string;
  schema?: JsonSchema;
  presentProps: PropertyInfo[];
  addableProps: PropertyInfo[];
  /** Document keys the current (class) schema does not allow — typically
   * left over after a class change. */
  unknownProps: UnknownProp[];
  isApplication: boolean;
}

function detectType(eff: JsonSchema): string {
  if (eff.enum && eff.enum.length > 0) return "enum";
  const t = eff.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t) && t.length > 0) return t[0];
  if (eff.properties || isPlainObject(eff.additionalProperties)) return "object";
  if (eff.items) return "array";
  const union = eff.anyOf ?? eff.oneOf;
  if (union && union.length > 0) return "unknown";
  return "unknown";
}

// Pull the class list out of an f5PostProcess pointer tag, wherever the AS3
// schema hides it: on the schema itself, a then/else branch, a union branch,
// or the `use` property of a pointer object.
export function extractXrefClasses(
  root: JsonSchemaRoot,
  schema: JsonSchema,
  depth = 0
): string[] | undefined {
  if (depth > 3) return undefined;
  let s: JsonSchema;
  try {
    s = deref(root, schema);
  } catch {
    return undefined;
  }
  const pp = s.f5PostProcess;
  if (pp?.tag === "pointer" && isPlainObject(pp.data)) {
    const classSchema = (pp.data as { properties?: { class?: JsonSchema } })
      .properties?.class;
    if (classSchema) {
      if (typeof classSchema.const === "string") return [classSchema.const];
      if (Array.isArray(classSchema.enum))
        return classSchema.enum.filter((v): v is string => typeof v === "string");
    }
    return []; // pointer with unconstrained target
  }
  const candidates: JsonSchema[] = [
    ...(s.then ? [s.then] : []),
    ...(s.allOf ?? []),
    ...(s.anyOf ?? []),
    ...(s.oneOf ?? []),
    ...(s.properties?.use ? [s.properties.use] : []),
  ];
  for (const c of candidates) {
    const hit = extractXrefClasses(root, c, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function buildPropertyInfo(
  root: JsonSchemaRoot,
  name: string,
  propSchema: JsonSchema,
  required: boolean,
  docValue: unknown
): PropertyInfo {
  let eff: JsonSchema;
  try {
    eff = effectiveSchema(root, propSchema, docValue);
  } catch {
    eff = propSchema;
  }
  const type = detectType(eff);
  const info: PropertyInfo = {
    name,
    schema: eff,
    type,
    description: (eff.description ?? eff.title) as string | undefined,
    required,
    present: docValue !== undefined,
  };
  if (type === "enum")
    info.enumValues = eff.enum!.filter(
      (v): v is string | number => typeof v === "string" || typeof v === "number"
    );
  if (eff.default !== undefined) info.default = eff.default;
  const xref = extractXrefClasses(root, propSchema);
  if (xref) info.xrefClasses = xref;
  return info;
}

// Normalize a cursor path to the enclosing object: trim trailing segments
// that address scalars or arrays so the context is always an object node.
export function normalizeToObjectPath(doc: unknown, path: JsonPath): JsonPath {
  const p = [...path];
  while (p.length > 0 && !isPlainObject(getAtPath(doc, p))) p.pop();
  return p;
}

export interface XrefCandidates {
  /** Names of matching objects defined in the document. */
  names: { name: string; className: string }[];
  /** Text range of the value node the pick list should replace. */
  start: number;
  length: number;
}

// When the offset sits inside a STRING VALUE whose schema is a pointer to
// another object in the declaration (a Service's `pool`, a `use` reference,
// …), return the document objects it may point at.
export function xrefCandidatesAt(
  root: JsonSchemaRoot,
  registry: ClassRegistry,
  text: string,
  offset: number
): XrefCandidates | null {
  const loc = getLocation(text, offset);
  if (loc.isAtPropertyKey || loc.path.length === 0) return null;
  const node = loc.previousNode;
  if (!node || node.type !== "string") return null;
  if (offset < node.offset || offset > node.offset + node.length) return null;
  const doc = parse(text, [], { allowTrailingComma: true }) as unknown;
  const schema = resolveSchemaForPath(root, registry, doc, loc.path as JsonPath);
  if (!schema) return null;
  const classes = extractXrefClasses(root, schema);
  if (!classes) return null;
  const instances = indexClassInstances(doc).filter(
    (i) => classes.length === 0 || classes.includes(i.className)
  );
  const seen = new Set<string>();
  const names: { name: string; className: string }[] = [];
  for (const inst of instances) {
    if (seen.has(inst.name)) continue;
    seen.add(inst.name);
    names.push({ name: inst.name, className: inst.className });
  }
  if (names.length === 0) return null;
  return { names, start: node.offset, length: node.length };
}

export function getContext(
  root: JsonSchemaRoot,
  registry: ClassRegistry,
  text: string,
  offset: number
): NodeContext {
  const rawPath = getLocation(text, offset).path as JsonPath;
  const doc = parse(text, [], { allowTrailingComma: true }) as unknown;
  return getContextForPath(root, registry, doc, rawPath);
}

export function getContextForPath(
  root: JsonSchemaRoot,
  registry: ClassRegistry,
  doc: unknown,
  rawPath: JsonPath
): NodeContext {
  const path = normalizeToObjectPath(doc, rawPath);
  const docNode = getAtPath(doc, path);
  const rawSchema = resolveSchemaForPath(root, registry, doc, path);

  const className =
    isPlainObject(docNode) && typeof docNode.class === "string"
      ? docNode.class
      : undefined;
  const isApplication = className === "Application";

  const crumbs = path.map(String);
  const breadcrumb =
    (crumbs.length > 0 ? crumbs.join(" › ") : "(root)") +
    (className ? ` (${className})` : "");

  if (!rawSchema) {
    return {
      path,
      breadcrumb,
      className,
      schema: undefined,
      presentProps: [],
      addableProps: [],
      unknownProps: [],
      isApplication,
    };
  }

  const eff = effectiveSchema(root, rawSchema, docNode);
  const required = new Set(eff.required ?? []);
  const presentProps: PropertyInfo[] = [];
  const addableProps: PropertyInfo[] = [];

  for (const [name, propSchema] of Object.entries(eff.properties ?? {})) {
    const docValue = isPlainObject(docNode) ? docNode[name] : undefined;
    const info = buildPropertyInfo(
      root,
      name,
      propSchema,
      required.has(name),
      docValue
    );
    (info.present ? presentProps : addableProps).push(info);
  }

  // Alphabetical; required-but-missing entries keep their visual marker.
  addableProps.sort((a, b) => a.name.localeCompare(b.name));

  // Keys in the document this schema doesn't know. Flag them when the schema
  // forbids extras (additionalProperties: false) or when this is a class
  // object without an explicit member escape hatch — the usual aftermath of
  // changing an object's class.
  const unknownProps: UnknownProp[] = [];
  const flagUnknown =
    eff.additionalProperties === false ||
    (className !== undefined && eff.additionalProperties === undefined);
  if (flagUnknown && isPlainObject(docNode) && eff.properties) {
    for (const [key, value] of Object.entries(docNode)) {
      if (key in eff.properties) continue;
      unknownProps.push({
        name: key,
        valueType: Array.isArray(value) ? "array" : typeof value,
      });
    }
  }

  return {
    path,
    breadcrumb,
    className,
    schema: eff,
    presentProps,
    addableProps,
    unknownProps,
    isApplication,
  };
}
