// Loose JSON Schema (draft-07) typing. The AS3 schema uses many keywords;
// we type only what the engine reads and index the rest.
export interface JsonSchema {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  patternProperties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema | JsonSchema[];
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  if?: JsonSchema;
  then?: JsonSchema;
  else?: JsonSchema;
  not?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  f5PostProcess?: { tag?: string; data?: unknown };
  [key: string]: unknown;
}

export interface JsonSchemaRoot extends JsonSchema {
  definitions?: Record<string, JsonSchema>;
}

export type JsonPath = (string | number)[];

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getAtPath(doc: unknown, path: JsonPath): unknown {
  let cur: unknown = doc;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}
