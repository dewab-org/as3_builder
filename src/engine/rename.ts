// Rename an application member (or the application itself) and rewrite every
// reference to it inside the application. AS3 points at objects by name, so a
// bare key rename leaves dangling pointers; this is the safe version.

import { isPlainObject } from "./types";
import type { AppManifest } from "./as3ToNetbox";

type Dict = Record<string, unknown>;

/** AS3 object-key grammar (same as the renderer's sanitizer target). */
const KEY_GRAMMAR = /^[A-Za-z][0-9A-Za-z_.-]*$/;

/** Properties whose STRING value is a pointer to a sibling object by name.
 * ({use: …} pointers are rewritten wherever they appear.) */
const STRING_REF_PROPS = new Set([
  "pool",
  "iRule", // Persist.iRule
  "certificate", // TLS_Server certificates[{certificate}]
  "clientCertificate",
  "policyEndpoint",
  "profileTCP",
  "profileHTTP",
  "cipherGroup",
]);

/** Properties whose array elements may be bare-name pointers. */
const ARRAY_REF_PROPS = new Set(["iRules", "policyEndpoint"]);

function rewriteRefs(node: unknown, oldKey: string, newKey: string): number {
  if (!isPlainObject(node)) return 0;
  let count = 0;
  for (const [prop, value] of Object.entries(node)) {
    if (prop === "use" && value === oldKey) {
      (node as Dict).use = newKey;
      count++;
    } else if (STRING_REF_PROPS.has(prop) && value === oldKey) {
      (node as Dict)[prop] = newKey;
      count++;
    } else if (ARRAY_REF_PROPS.has(prop) && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] === oldKey) {
          value[i] = newKey;
          count++;
        } else {
          count += rewriteRefs(value[i], oldKey, newKey);
        }
      }
    } else if (Array.isArray(value)) {
      for (const v of value) count += rewriteRefs(v, oldKey, newKey);
    } else if (isPlainObject(value)) {
      count += rewriteRefs(value, oldKey, newKey);
    }
  }
  return count;
}

type Path = (string | number)[];

/** Later document position first, so deleting in this order never shifts an
 * array index that a later deletion still relies on. */
function reverseDocumentOrder(a: Path, b: Path): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === "number" && typeof b[i] === "number")
      return (b[i] as number) - (a[i] as number);
    return String(b[i]).localeCompare(String(a[i]));
  }
  return b.length - a.length;
}

/**
 * Where an application member is referenced from inside its application, as
 * paths to delete when the member itself is deleted. A pointer held in a
 * property loses that property (`pool`, `serverTLS: {use}`, Persist `iRule`);
 * a pointer that is a list entry loses that entry (`iRules`, `monitors`,
 * `virtualAddresses`); a pointer anywhere inside a list item loses the item
 * (a `certificates` entry, a policy action). Empty for anything that is not
 * [applicationKey, memberKey]. Sorted for sequential deletion.
 */
export function referencePathsTo(declaration: Dict, path: Path): Path[] {
  if (path.length !== 2 || path.some((s) => typeof s !== "string")) return [];
  const [appKey, key] = path as string[];
  const application = declaration[appKey];
  if (!isPlainObject(application) || application.class !== "Application")
    return [];

  const found: Path[] = [];

  function walk(node: Dict, nodePath: Path, elementPath: Path | null): void {
    for (const [prop, value] of Object.entries(node)) {
      const propPath = [...nodePath, prop];
      const isPointer =
        (STRING_REF_PROPS.has(prop) && value === key) ||
        (isPlainObject(value) && value.use === key);
      if (isPointer) {
        // Inside a list item (a certificates entry, a policy action's
        // select.pool) the whole item goes — removing just the pointer would
        // leave a hollow item that silently means something else. Elsewhere
        // just the pointing property goes.
        found.push(elementPath ?? propPath);
        continue;
      }
      if (Array.isArray(value)) {
        value.forEach((el, i) => {
          const elPath = [...propPath, i];
          if (
            (ARRAY_REF_PROPS.has(prop) && el === key) ||
            (isPlainObject(el) && el.use === key)
          ) {
            found.push(elPath);
          } else if (isPlainObject(el)) {
            walk(el, elPath, elPath);
          }
        });
      } else if (isPlainObject(value)) {
        // Keep the nearest enclosing list item while descending.
        walk(value, propPath, elementPath);
      }
    }
  }

  for (const [memberKey, member] of Object.entries(application)) {
    if (memberKey === key || !isPlainObject(member)) continue;
    walk(member, [appKey, memberKey], null);
  }

  // One entry per location, latest first.
  const unique = new Map(found.map((p) => [JSON.stringify(p), p]));
  return [...unique.values()].sort(reverseDocumentOrder);
}

/** Whether the node at `path` (holding `value`) is something rename
 * supports: the Application itself, or one of its class-bearing members
 * other than its Constants. Not controls, not plain properties. */
export function canRename(path: (string | number)[], value: unknown): boolean {
  if (!isPlainObject(value) || path.some((s) => typeof s !== "string"))
    return false;
  if (path.length === 1) return value.class === "Application";
  if (path.length === 2)
    return typeof value.class === "string" && value.class !== "Constants";
  return false;
}

export interface RenameResult {
  /** The whole declaration, renamed, ready to serialize. */
  declaration: Dict;
  /** How many pointers were rewritten along with the key. */
  refsRewritten: number;
  /** True when the application member itself (the top-level key) moved. */
  renamedApplication: boolean;
}

/**
 * Rename `path`'s member key in a parsed declaration. `path` is either
 * [appKey] (rename the application) or [appKey, memberKey]. Returns a NEW
 * declaration object (key order preserved) or an error string.
 */
export function renameMember(
  declaration: Dict,
  path: (string | number)[],
  newKey: string
): RenameResult | { error: string } {
  if (path.length < 1 || path.length > 2 || path.some((s) => typeof s !== "string"))
    return { error: "Only applications and their members can be renamed." };
  const oldKey = String(path[path.length - 1]);
  if (newKey === oldKey)
    return { declaration, refsRewritten: 0, renamedApplication: path.length === 1 };
  if (!KEY_GRAMMAR.test(newKey) || newKey.length > 190)
    return {
      error:
        "Names must start with a letter and use only letters, digits, _ . - (max 190).",
    };

  const clone = JSON.parse(JSON.stringify(declaration)) as Dict;

  if (path.length === 1) {
    // The application itself: move the top-level key, order preserved.
    if (!isPlainObject(clone[oldKey]) || clone[oldKey].class !== "Application")
      return { error: `"${oldKey}" is not an application.` };
    if (newKey in clone)
      return { error: `"${newKey}" already exists in the declaration.` };
    const renamed: Dict = {};
    for (const [k, v] of Object.entries(clone)) {
      renamed[k === oldKey ? newKey : k] = v;
    }
    return { declaration: renamed, refsRewritten: 0, renamedApplication: true };
  }

  const appKey = String(path[0]);
  const application = clone[appKey];
  if (!isPlainObject(application) || application.class !== "Application")
    return { error: `"${appKey}" is not an application.` };
  if (!(oldKey in application))
    return { error: `"${oldKey}" is not a member of "${appKey}".` };
  if (newKey in application)
    return { error: `"${newKey}" already exists in "${appKey}".` };

  const renamedApp: Dict = {};
  for (const [k, v] of Object.entries(application)) {
    renamedApp[k === oldKey ? newKey : k] = v;
  }
  clone[appKey] = renamedApp;
  const refsRewritten = rewriteRefs(renamedApp, oldKey, newKey);
  return { declaration: clone, refsRewritten, renamedApplication: false };
}

/**
 * Keep a NetBox provenance manifest in step with a rename, so write-back
 * pushes the rename as a NetBox name change instead of a delete + create.
 * The stored link names other entries hold are rewritten too — the push
 * renames the object itself, so the links stay consistent.
 */
export function renameInManifest(
  manifest: AppManifest,
  oldKey: string,
  newKey: string
): void {
  if (manifest.appKey === oldKey) manifest.appKey = newKey;
  for (const entry of manifest.entries) {
    if (entry.as3Key === oldKey) entry.as3Key = newKey;
    if (entry.refNames) {
      for (const field of [
        "backend_pool",
        "ssl_profile",
        "server_ssl_profile",
      ] as const) {
        if (entry.refNames[field] === oldKey) entry.refNames[field] = newKey;
      }
    }
    if (entry.linkNames) {
      for (const field of ["policies", "protocol_profiles"] as const) {
        entry.linkNames[field] = entry.linkNames[field].map((n) =>
          n === oldKey ? newKey : n
        );
      }
    }
    if (entry.monitorKeys)
      entry.monitorKeys = entry.monitorKeys.map((n) =>
        n === oldKey ? newKey : n
      );
  }
  if (oldKey in manifest.artifacts) {
    manifest.artifacts[newKey] = manifest.artifacts[oldKey];
    delete manifest.artifacts[oldKey];
  }
}
