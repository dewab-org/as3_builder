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

/** URL-sourced schemas use ids of the form `url:<url>`. */
export function urlSchemaId(url: string): string {
  return `url:${url}`;
}

export function urlSchemaLabel(url: string): string {
  try {
    const u = new URL(url);
    const file = u.pathname.split("/").filter(Boolean).pop() ?? u.hostname;
    return `${file} (${u.hostname})`;
  } catch {
    return url;
  }
}

// Light sanity check: parsed JSON must look like a JSON Schema we can use.
function assertSchemaShape(v: unknown): Record<string, unknown> {
  if (
    typeof v !== "object" ||
    v === null ||
    Array.isArray(v) ||
    (!("definitions" in v) && !("properties" in v) && !("$defs" in v))
  ) {
    throw new Error(
      "The URL did not return a JSON Schema (expected an object with definitions/properties)"
    );
  }
  return v as Record<string, unknown>;
}

async function fetchSchemaFromUrl(url: string): Promise<Record<string, unknown>> {
  // Direct fetch first (works for CORS-enabled hosts like raw.githubusercontent);
  // fall back to the dev-server passthrough for hosts without CORS headers.
  let lastError: unknown;
  for (const target of [url, `/url-proxy?url=${encodeURIComponent(url)}`]) {
    try {
      const res = await fetch(target, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return assertSchemaShape(await res.json());
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not load schema from ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export async function loadSchema(id: string): Promise<SchemaEntry> {
  const cached = cache.get(id);
  if (cached) return cached;
  let schema: Record<string, unknown>;
  let label: string;
  if (id.startsWith("url:")) {
    const url = id.slice(4);
    schema = await fetchSchemaFromUrl(url);
    label = urlSchemaLabel(url);
  } else {
    switch (id) {
      case "as3-3.55.0-12":
        schema = (await import("./as3-schema-3.55.0-12.json"))
          .default as Record<string, unknown>;
        break;
      case "as3-3.56.0-10":
        schema = (await import("./as3-schema-3.56.0-10.json"))
          .default as Record<string, unknown>;
        break;
      default:
        throw new Error(`Unknown schema id: ${id}`);
    }
    label = SCHEMA_LIST.find((s) => s.id === id)?.label ?? id;
  }
  const entry: SchemaEntry = { id, label, schema };
  cache.set(id, entry);
  return entry;
}
