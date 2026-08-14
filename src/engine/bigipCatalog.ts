/**
 * Catalogue of /Common objects a declaration points at but never defines —
 * the profiles, persistence methods and monitors F5 ships with a BIG-IP.
 *
 * They are estate objects: an AS3 declaration references one as
 * `{bigip: "/Common/tcp-lan-optimized"}` and cannot create or change it, which
 * is why the editor flags them external. The catalogue is generated from a
 * real device by scripts/fetch-bigip-profiles.mjs and refreshed after a BIG-IP
 * upgrade; `generatedFrom` records which device and version it came from, so a
 * stale or unpopulated catalogue is visible rather than silently empty.
 */

export interface BigipCatalogEntry {
  name: string;
  /** `/Common/…` — exactly what goes in `{bigip: …}`. */
  fullPath: string;
  /** iControl collection it came from, e.g. "ltm/profile/tcp". */
  collection: string;
  /** AS3 property that accepts it, or null when AS3 has no property for it. */
  as3Property: string | null;
  defaultsFrom: string | null;
  settings: Record<string, unknown>;
  /** Settings that differ from the profile this one derives from — the part
   * an operator actually chooses on. */
  differsFromParent?: Record<string, unknown>;
}

export interface BigipCatalog {
  format: string;
  formatVersion: number;
  generatedFrom: {
    host: string | null;
    version: string | null;
    build: string | null;
    digest?: string;
    note?: string;
  };
  entries: BigipCatalogEntry[];
}

let catalogPromise: Promise<BigipCatalog> | undefined;

/** Loaded as its own chunk: it is device data, not needed to start editing. */
export function loadBigipCatalog(): Promise<BigipCatalog> {
  catalogPromise ??= import("../schemas/bigip-common-catalog.json").then(
    (module) => module.default as BigipCatalog
  );
  return catalogPromise;
}

/** True when no device has been read yet — the UI should say so rather than
 * present an empty list as "there are none". */
export function isCatalogPopulated(catalog: BigipCatalog | undefined): boolean {
  return (catalog?.entries.length ?? 0) > 0;
}

/** Entries offerable for an AS3 property, in the order a picker should show. */
export function bigipCandidates(
  catalog: BigipCatalog | undefined,
  as3Property: string | undefined
): BigipCatalogEntry[] {
  if (!catalog || !as3Property) return [];
  return catalog.entries
    .filter((e) => e.as3Property === as3Property)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function catalogEntry(
  catalog: BigipCatalog | undefined,
  fullPath: string
): BigipCatalogEntry | undefined {
  return catalog?.entries.find((e) => e.fullPath === fullPath);
}

/** One-line summary for a picker row or tooltip: what this profile changes
 * relative to its parent, or its base type when it is the parent. */
export function summarizeEntry(entry: BigipCatalogEntry): string {
  const diff = entry.differsFromParent;
  if (!diff || Object.keys(diff).length === 0)
    return entry.defaultsFrom
      ? `same settings as ${entry.defaultsFrom}`
      : "base profile";
  const parts = Object.entries(diff)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  const rest = Object.keys(diff).length - parts.length;
  return parts.join(", ") + (rest > 0 ? `, +${rest} more` : "");
}
