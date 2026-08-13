// Phase W1 of NetBox write-back (see NETBOX-WRITEBACK-PLAN.md): invert the
// SCALAR parts of the netboxAs3 rendering so edits made in the builder can be
// PATCHed onto the NetBox objects they came from.
//
// The provenance manifest is built at load time, while we still know exactly
// which NetBox object produced each AS3 key — no name guessing on the way
// back. Write-back therefore only works for declarations loaded through this
// tool in the current session.

import { LEGACY_LB_ALIASES, sanitizeKey } from "./netboxAs3";
import { isPlainObject } from "./types";

type Dict = Record<string, unknown>;

export interface ManifestEntry {
  as3Key: string;
  endpoint: string; // plugin REST collection, e.g. "virtual-servers"
  id: number;
  className: string;
  /** Invertible NetBox field values as loaded. */
  fields: Dict;
  /** The AS3 object exactly as rendered at load (detects out-of-scope edits). */
  as3Snapshot: unknown;
  lastUpdated?: string;
}

export interface AppManifest {
  declarationId: string;
  appId: number;
  appKey: string;
  entries: ManifestEntry[];
  /** Rendered objects WITHOUT a writable manifest entry (Service_Address,
   * Certificate, cipher objects, …): key → snapshot as rendered. Used to
   * tell "edited artifact" (out of scope note) from "new object". */
  artifacts: Record<string, unknown>;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ObjectChange {
  entry: ManifestEntry;
  changes: FieldChange[];
  /** Object also differs in ways W1 cannot push. */
  outOfScope: boolean;
}

export interface ChangeSet {
  updates: ObjectChange[];
  /** Human-readable findings that produce no PATCH (deletions, creations,
   * unsupported edits). */
  notes: string[];
}

const PROTOCOL_BY_CLASS: Record<string, string> = {
  Service_TCP: "tcp",
  Service_HTTP: "http",
  Service_HTTPS: "https",
  Service_UDP: "udp",
};

// ---- field extractors ------------------------------------------------------
// For each supported object kind there are two extractors producing the SAME
// field set: one from the NetBox graph node (load time), one from the edited
// AS3 object (push time). Diffing them yields the PATCH body.

function vsFieldsFromNetbox(vs: Dict): Dict {
  return {
    protocol: vs.protocol,
    service_port: vs.service_port,
    description: vs.description ?? "",
    enabled: vs.enabled !== false,
    vs_type: vs.vs_type ?? "standard",
    persistence: vs.persistence ?? [],
  };
}

function vsFieldsFromAs3(svc: Dict): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  const fields: Dict = {
    description: svc.remark ?? "",
    enabled: svc.enable !== false,
    vs_type: svc.virtualType ?? "standard",
    persistence: svc.persistenceMethods ?? [],
  };
  const protocol = PROTOCOL_BY_CLASS[String(svc.class)];
  if (protocol) fields.protocol = protocol;
  else unsupported.push(`class ${svc.class} has no NetBox protocol`);
  if (typeof svc.virtualPort === "number") fields.service_port = svc.virtualPort;
  else unsupported.push("virtualPort missing/non-numeric");
  return { fields, unsupported };
}

function poolFieldsFromNetbox(pool: Dict): Dict {
  // Store the forward-normalized value so a no-edit round trip is clean;
  // the renderer normalizes legacy aliases the same way.
  const rawLb = pool.load_balancing_algorithm as string | undefined;
  return {
    load_balancing_algorithm: rawLb ? (LEGACY_LB_ALIASES[rawLb] ?? rawLb) : null,
    description: pool.description ?? "",
    priority_group_activation: pool.priority_group_activation === true,
    priority_group_threshold: pool.priority_group_threshold ?? null,
  };
}

function poolFieldsFromAs3(pool: Dict): { fields: Dict; unsupported: string[] } {
  const threshold =
    typeof pool.minimumMembersActive === "number"
      ? pool.minimumMembersActive
      : null;
  return {
    fields: {
      load_balancing_algorithm: pool.loadBalancingMode ?? null,
      description: pool.label ?? "",
      priority_group_activation: threshold !== null,
      priority_group_threshold: threshold,
    },
    unsupported: [],
  };
}

function monitorFieldsFromNetbox(m: Dict): Dict {
  return {
    monitor_type: m.monitor_type,
    interval: m.interval ?? null,
    timeout: m.timeout ?? null,
    description: m.description ?? "",
  };
}

function monitorFieldsFromAs3(m: Dict): { fields: Dict; unsupported: string[] } {
  return {
    fields: {
      monitor_type: m.monitorType,
      interval: typeof m.interval === "number" ? m.interval : null,
      timeout: typeof m.timeout === "number" ? m.timeout : null,
      description: m.label ?? "",
    },
    unsupported: [],
  };
}

const TLS_INT_BY_LABEL: Record<string, number> = {
  "TLSv1.1": 1,
  "TLSv1.2": 2,
  "TLSv1.3": 3,
};

function tlsFieldsFromNetbox(profile: Dict): Dict {
  const versions = ((profile.tls_versions as unknown[] | undefined) ?? []).map(
    (v) => (typeof v === "number" ? v : (TLS_INT_BY_LABEL[String(v)] ?? -1))
  );
  return {
    ciphers: profile.ciphers ?? [],
    mtls: profile.mtls ?? "ignore",
    tls_versions: [...versions].sort(),
  };
}

function tlsFieldsFromAs3(tls: Dict): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  const versions: number[] = [];
  // Effective enablement per AS3 defaults (1.0/1.1/1.2 on, 1.3 off).
  if ((tls.tls1_1Enabled as boolean | undefined) ?? true) versions.push(1);
  if ((tls.tls1_2Enabled as boolean | undefined) ?? true) versions.push(2);
  if ((tls.tls1_3Enabled as boolean | undefined) ?? false) versions.push(3);
  if (tls.tls1_0Enabled === true)
    unsupported.push("TLSv1.0 cannot be stored in NetBox (no such choice)");
  return {
    fields: {
      ciphers:
        typeof tls.ciphers === "string" && tls.ciphers !== ""
          ? String(tls.ciphers).split(":")
          : [],
      mtls: tls.authenticationMode ?? "ignore",
      tls_versions: versions.sort(),
    },
    unsupported,
  };
}

interface KindSpec {
  endpoint: string;
  fromNetbox: (n: Dict) => Dict;
  fromAs3: (a: Dict) => { fields: Dict; unsupported: string[] };
}

const KIND_BY_CLASS: Record<string, KindSpec> = {
  Service_TCP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_HTTP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_HTTPS: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_UDP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Pool: { endpoint: "backend-pools", fromNetbox: poolFieldsFromNetbox, fromAs3: poolFieldsFromAs3 },
  Monitor: { endpoint: "monitors", fromNetbox: monitorFieldsFromNetbox, fromAs3: monitorFieldsFromAs3 },
  TLS_Server: { endpoint: "ssl-profiles", fromNetbox: tlsFieldsFromNetbox, fromAs3: tlsFieldsFromAs3 },
  TLS_Client: { endpoint: "ssl-profiles", fromNetbox: tlsFieldsFromNetbox, fromAs3: tlsFieldsFromAs3 },
};

// ---- manifest --------------------------------------------------------------

// Walk the GraphQL application graph alongside the rendered declaration and
// record provenance for every object W1 can write back to.
export function buildManifest(
  app: Dict,
  declaration: Dict
): AppManifest {
  const appKey = sanitizeKey(String(app.name));
  const application = declaration[appKey] as Dict | undefined;
  const entries: ManifestEntry[] = [];
  const seen = new Set<string>();

  function add(
    netboxObj: Dict | null | undefined,
    className: string,
    spec: KindSpec,
    as3KeySource: string
  ) {
    if (!netboxObj || netboxObj.id == null) return;
    const as3Key = sanitizeKey(as3KeySource);
    if (seen.has(as3Key)) return; // renderer keeps the first definition too
    const as3Snapshot = application?.[as3Key];
    if (as3Snapshot === undefined) return; // renderer skipped it
    seen.add(as3Key);
    entries.push({
      as3Key,
      endpoint: spec.endpoint,
      id: Number(netboxObj.id),
      className,
      fields: spec.fromNetbox(netboxObj),
      as3Snapshot: JSON.parse(JSON.stringify(as3Snapshot)),
      lastUpdated: netboxObj.last_updated as string | undefined,
    });
  }

  for (const vs of (app.virtual_servers as Dict[] | undefined) ?? []) {
    const svcClass = Object.entries(PROTOCOL_BY_CLASS).find(
      ([, proto]) => proto === vs.protocol
    )?.[0];
    if (svcClass) {
      add(vs, svcClass, KIND_BY_CLASS[svcClass], String(vs.name));
    }
    const pools = (
      vs.backend_pool ? [vs.backend_pool] : ((vs.backend_pools as Dict[]) ?? [])
    ) as Dict[];
    for (const pool of pools) {
      add(pool, "Pool", KIND_BY_CLASS.Pool, String(pool.name));
      for (const m of (pool.monitors as Dict[] | undefined) ?? []) {
        add(m, "Monitor", KIND_BY_CLASS.Monitor, String(m.name));
      }
    }
    if (vs.ssl_profile) {
      add(
        vs.ssl_profile as Dict,
        "TLS_Server",
        KIND_BY_CLASS.TLS_Server,
        String((vs.ssl_profile as Dict).name)
      );
    }
    if (vs.server_ssl_profile) {
      add(
        vs.server_ssl_profile as Dict,
        "TLS_Client",
        KIND_BY_CLASS.TLS_Client,
        String((vs.server_ssl_profile as Dict).name)
      );
    }
  }

  const artifacts: Record<string, unknown> = {};
  if (isPlainObject(application)) {
    for (const [key, value] of Object.entries(application)) {
      if (seen.has(key) || !isPlainObject(value) || typeof value.class !== "string")
        continue;
      artifacts[key] = JSON.parse(JSON.stringify(value));
    }
  }

  return {
    declarationId: String(declaration.id ?? ""),
    appId: Number(app.id),
    appKey,
    entries,
    artifacts,
  };
}

// ---- changeset -------------------------------------------------------------

function valueEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function computeUpdates(
  declaration: Dict,
  manifest: AppManifest
): ChangeSet {
  const notes: string[] = [];
  const updates: ObjectChange[] = [];
  const application = declaration[manifest.appKey] as Dict | undefined;
  if (!isPlainObject(application)) {
    return {
      updates: [],
      notes: [
        `Application key "${manifest.appKey}" not found in the declaration — was it renamed? Renames are not supported in W1.`,
      ],
    };
  }

  const knownKeys = new Set(manifest.entries.map((e) => e.as3Key));

  for (const entry of manifest.entries) {
    const current = application[entry.as3Key];
    if (current === undefined) {
      notes.push(
        `"${entry.as3Key}" (${entry.className}) was removed from the declaration — deletions ship in phase W3, skipped.`
      );
      continue;
    }
    if (!isPlainObject(current)) {
      notes.push(`"${entry.as3Key}" is no longer an object — skipped.`);
      continue;
    }
    if (String(current.class) !== entry.className) {
      notes.push(
        `"${entry.as3Key}" changed class ${entry.className} → ${current.class} — class changes are not pushable, skipped.`
      );
      continue;
    }
    const spec = KIND_BY_CLASS[entry.className];
    const { fields, unsupported } = spec.fromAs3(current);
    for (const u of unsupported) notes.push(`"${entry.as3Key}": ${u}`);

    const changes: FieldChange[] = [];
    for (const [field, to] of Object.entries(fields)) {
      const from = entry.fields[field];
      if (!valueEq(from, to)) changes.push({ field, from, to });
    }

    // Did the object change in ways the field diff didn't capture?
    const outOfScope =
      !valueEq(current, entry.as3Snapshot) &&
      changes.length === 0
        ? true
        : !valueEq(stripKnown(current, entry), stripKnown(entry.as3Snapshot as Dict, entry));

    if (changes.length > 0 || outOfScope) {
      updates.push({ entry, changes, outOfScope });
      if (outOfScope) {
        notes.push(
          `"${entry.as3Key}" has additional edits outside W1 scope (members, addresses, certificates, …) that will NOT be pushed.`
        );
      }
    }
  }

  // Artifact objects (rendered without a writable manifest entry): edits to
  // them are out of W1 scope; brand-new objects wait for W3.
  for (const [key, value] of Object.entries(application)) {
    if (key === "class" || key === "label" || key === "remark") continue;
    if (knownKeys.has(key)) continue;
    if (!isPlainObject(value) || typeof value.class !== "string") continue;
    if (key in manifest.artifacts) {
      if (!valueEq(value, manifest.artifacts[key])) {
        notes.push(
          `"${key}" (${value.class}) was edited but is derived data (addresses, certificates, policies) — pushing it ships in a later phase.`
        );
      }
      continue;
    }
    notes.push(
      `"${key}" (${value.class}) is new — object creation ships in phase W3, skipped.`
    );
  }

  return { updates, notes };
}

// Remove the properties the W1 field extractors already account for, so the
// remainder shows whether out-of-scope edits exist.
const KNOWN_AS3_PROPS: Record<string, string[]> = {
  "virtual-servers": [
    "class",
    "virtualPort",
    "remark",
    "enable",
    "virtualType",
    "persistenceMethods",
  ],
  "backend-pools": ["class", "loadBalancingMode", "label", "minimumMembersActive"],
  monitors: ["class", "monitorType", "interval", "timeout", "label"],
  "ssl-profiles": [
    "class",
    "ciphers",
    "authenticationMode",
    "tls1_0Enabled",
    "tls1_1Enabled",
    "tls1_2Enabled",
    "tls1_3Enabled",
  ],
};

function stripKnown(obj: Dict, entry: ManifestEntry): Dict {
  const known = new Set(KNOWN_AS3_PROPS[entry.endpoint] ?? []);
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!known.has(k)) out[k] = v;
  }
  return out;
}
