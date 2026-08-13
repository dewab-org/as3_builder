import perAppSchema from "./per-app-schema.json";

export interface SchemaEntry {
  id: string;
  label: string;
  schema: Record<string, unknown>;
}

export interface SchemaListing {
  id: string;
  label: string;
}

// The default per-app schema ships in the main bundle (needed at boot); the
// full AS3 schemas (~1.2MB each) load on demand when selected.
export const SCHEMA_LIST: SchemaListing[] = [
  { id: "per-app", label: "Per-App Schema" },
  { id: "as3-3.55.0-12", label: "AS3 3.55.0-12 (full)" },
  { id: "as3-3.56.0-10", label: "AS3 3.56.0-10 (full)" },
];

export const DEFAULT_SCHEMA_ID = "per-app";

export const DEFAULT_SCHEMA_ENTRY: SchemaEntry = {
  id: "per-app",
  label: "Per-App Schema",
  schema: perAppSchema as Record<string, unknown>,
};

const cache = new Map<string, SchemaEntry>([["per-app", DEFAULT_SCHEMA_ENTRY]]);

export async function loadSchema(id: string): Promise<SchemaEntry> {
  const cached = cache.get(id);
  if (cached) return cached;
  let schema: Record<string, unknown>;
  switch (id) {
    case "as3-3.55.0-12":
      schema = (await import("./as3-schema-3.55.0-12.json")).default as Record<
        string,
        unknown
      >;
      break;
    case "as3-3.56.0-10":
      schema = (await import("./as3-schema-3.56.0-10.json")).default as Record<
        string,
        unknown
      >;
      break;
    default:
      throw new Error(`Unknown schema id: ${id}`);
  }
  const entry: SchemaEntry = {
    id,
    label: SCHEMA_LIST.find((s) => s.id === id)?.label ?? id,
    schema,
  };
  cache.set(id, entry);
  return entry;
}
