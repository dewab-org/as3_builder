import perAppSchema from "./per-app-schema.json";
import as3Schema3550 from "./as3-schema-3.55.0-12.json";
import as3Schema3560 from "./as3-schema-3.56.0-10.json";

export interface SchemaEntry {
  id: string;
  label: string;
  schema: Record<string, unknown>;
}

export const SCHEMAS: SchemaEntry[] = [
  {
    id: "per-app",
    label: "Per-App Schema",
    schema: perAppSchema as Record<string, unknown>,
  },
  {
    id: "as3-3.55.0-12",
    label: "AS3 3.55.0-12 (full)",
    schema: as3Schema3550 as Record<string, unknown>,
  },
  {
    id: "as3-3.56.0-10",
    label: "AS3 3.56.0-10 (full)",
    schema: as3Schema3560 as Record<string, unknown>,
  },
];

export const DEFAULT_SCHEMA_ID = "per-app";

export function getSchema(id: string): SchemaEntry {
  const entry = SCHEMAS.find((s) => s.id === id);
  if (!entry) throw new Error(`Unknown schema id: ${id}`);
  return entry;
}
