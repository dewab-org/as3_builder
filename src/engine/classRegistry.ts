import type { JsonSchema, JsonSchemaRoot } from "./types";
import { deref, effectiveSchema } from "./refResolver";

export interface ClassInfo {
  className: string;
  definitionName: string;
  schema: JsonSchema; // the raw definition; resolve with effectiveSchema + docNode
  description?: string;
  required: string[];
}

export type ClassRegistry = Map<string, ClassInfo>;

// A definition is a "class definition" when its flattened form has a
// `class` property fixed to a single value (const, or one-entry enum).
export function buildClassRegistry(root: JsonSchemaRoot): ClassRegistry {
  const registry: ClassRegistry = new Map();
  for (const [definitionName, def] of Object.entries(root.definitions ?? {})) {
    let eff: JsonSchema;
    try {
      eff = effectiveSchema(root, def);
    } catch {
      continue; // tolerate odd definitions; they just aren't classes
    }
    const classProp = eff.properties?.class;
    if (!classProp) continue;
    const resolved = deref(root, classProp);
    let className: string | undefined;
    if (typeof resolved.const === "string") className = resolved.const;
    else if (resolved.enum?.length === 1 && typeof resolved.enum[0] === "string")
      className = resolved.enum[0];
    if (!className) continue;
    // When two definitions claim the same class name (e.g. Application and
    // Application_Shared both declare class "Application"), the definition
    // NAMED like the class wins; otherwise first-seen wins.
    const existing = registry.get(className);
    if (existing) {
      if (existing.definitionName === existing.className) continue;
      if (definitionName !== className) continue;
    }
    registry.set(className, {
      className,
      definitionName,
      schema: def,
      description: (eff.description ?? eff.title) as string | undefined,
      required: eff.required ?? [],
    });
  }
  return registry;
}

// Classes allowed as named members of an Application, derived from the
// Application definition's additionalProperties class enum.
export function applicationMemberClasses(
  root: JsonSchemaRoot,
  registry: ClassRegistry
): ClassInfo[] {
  const appDef = root.definitions?.Application;
  if (appDef) {
    const eff = effectiveSchema(root, appDef);
    const ap = eff.additionalProperties;
    if (typeof ap === "object" && ap !== null) {
      const classEnum = deref(root, ap).properties?.class;
      const values = classEnum ? deref(root, classEnum).enum : undefined;
      if (Array.isArray(values) && values.length > 0) {
        const out: ClassInfo[] = [];
        for (const v of values) {
          const info = typeof v === "string" ? registry.get(v) : undefined;
          if (info) out.push(info);
        }
        if (out.length > 0) return out;
      }
    }
  }
  return [...registry.values()];
}
