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

export interface MemberRow {
  id?: number; // NetBox pool-member pk (absent for rows built from AS3)
  address: string; // bare address, no mask
  addressWithMask: string;
  servicePort: number;
  enabled: boolean;
  ratio: number;
  priorityGroup: number;
}

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
  /** Pool entries: member rows as loaded (W2). */
  members?: MemberRow[];
  /** Virtual-server entries: VIP addresses as loaded (W2). */
  vips?: { id: number; address: string }[];
}

/** Granular write operations beyond a scalar PATCH (W2). */
export type WriteOp =
  | {
      op: "member-create";
      addressWithMask: string;
      body: Dict; // service_port + non-default state; pool/node injected at apply
      label: string;
    }
  | { op: "member-update"; memberId: number; body: Dict; label: string }
  | { op: "member-delete"; memberId: number; label: string }
  | {
      op: "vs-addresses";
      addresses: string[]; // full desired set, with masks
      adds: string[];
      removes: string[];
      label: string;
    };

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
  /** Granular member / address operations (W2). */
  ops: WriteOp[];
  /** Object also differs in ways the current phases cannot push. */
  outOfScope: boolean;
}

/** A new object to POST (W3). References are resolved at apply time. */
export interface CreateObject {
  as3Key: string;
  className: string;
  endpoint: string;
  /** Scalar POST body (no relations). */
  fields: Dict;
  /** Pool creates: member rows to add after the POST. */
  members?: MemberRow[];
  /** Service creates: VIP addresses (masked); null = unpushable. */
  vipAddresses?: string[] | null;
  /** FK fields referencing sibling objects by AS3 key (resolved to ids). */
  refs: { field: string; targetKey: string }[];
  /** Pool creates: monitor references by AS3 key (M2M). */
  monitorRefs?: string[];
  /** TLS profile creates: certificate names (get-or-created by name). */
  certificateNames?: string[];
  label: string;
}

/** A manifest object no longer present in the declaration (W3). */
export interface DeleteObject {
  entry: ManifestEntry;
  label: string;
}

export interface ChangeSet {
  updates: ObjectChange[];
  creates: CreateObject[];
  deletes: DeleteObject[];
  /** Human-readable findings that produce no write. */
  notes: string[];
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "obj"
  );
}

/** FK-safe orders: create dependencies first, delete dependents first. */
export const CREATE_ORDER = [
  "monitors",
  "ssl-profiles",
  "backend-pools",
  "virtual-servers",
];
export const DELETE_ORDER = [
  "virtual-servers",
  "ssl-profiles",
  "backend-pools",
  "monitors",
];

const PROTOCOL_BY_CLASS: Record<string, string> = {
  Service_TCP: "tcp",
  Service_HTTP: "http",
  Service_HTTPS: "https",
  Service_UDP: "udp",
};

function stripMask(address: string): string {
  return String(address).replace(/\/\d+$/, "");
}

function withMask(address: string): string {
  if (/\/\d+$/.test(address)) return address;
  return address.includes(":") ? `${address}/128` : `${address}/32`;
}

// NetBox graph member rows → normalized rows keyed by (address, port).
function memberRowsFromNetbox(pool: Dict): MemberRow[] {
  const rows: MemberRow[] = [];
  for (const m of (pool.members as Dict[] | undefined) ?? []) {
    const node = m.node as Dict | undefined;
    if (!node?.address) continue;
    rows.push({
      id: Number(m.id),
      address: stripMask(String(node.address)),
      addressWithMask: withMask(String(node.address)),
      servicePort: Number(m.service_port),
      enabled: m.enabled !== false,
      ratio: (m.ratio as number | null) ?? 0,
      priorityGroup: (m.priority_group as number | null) ?? 0,
    });
  }
  return rows;
}

// AS3 pool.members (grouped) → normalized rows; unsupported member shapes
// (fqdn/hostname, bigip refs) come back as notes.
function memberRowsFromAs3(
  pool: Dict,
  poolKey: string
): { rows: MemberRow[]; notes: string[] } {
  const rows: MemberRow[] = [];
  const notes: string[] = [];
  for (const group of (pool.members as Dict[] | undefined) ?? []) {
    if (!isPlainObject(group)) continue;
    if (typeof group.servicePort !== "number") {
      notes.push(`"${poolKey}": member group without numeric servicePort skipped`);
      continue;
    }
    if (group.hostname || group.addressDiscovery) {
      notes.push(
        `"${poolKey}": fqdn/discovery members cannot be pushed yet — skipped`
      );
      continue;
    }
    const addrs = (group.serverAddresses as unknown[] | undefined) ?? [];
    for (const a of addrs) {
      if (typeof a !== "string") continue;
      rows.push({
        address: stripMask(a),
        addressWithMask: withMask(a),
        servicePort: group.servicePort,
        enabled: group.adminState !== "disable",
        ratio: typeof group.ratio === "number" ? group.ratio : 0,
        priorityGroup:
          typeof group.priorityGroup === "number" ? group.priorityGroup : 0,
      });
    }
  }
  return { rows, notes };
}

// AS3 service.virtualAddresses → desired VIP set (masked). Entries may be raw
// strings or {use: <Service_Address key>}; {bigip:…} makes the set unpushable.
function vipAddressesFromAs3(
  svc: Dict,
  application: Dict,
  vsKey: string
): { addresses: string[] | null; notes: string[] } {
  const notes: string[] = [];
  const out: string[] = [];
  const list = svc.virtualAddresses as unknown[] | undefined;
  if (!list) return { addresses: [], notes };
  for (const entry of list) {
    if (typeof entry === "string") {
      out.push(withMask(entry));
    } else if (isPlainObject(entry) && typeof entry.use === "string") {
      const target = application[entry.use];
      if (isPlainObject(target) && typeof target.virtualAddress === "string") {
        out.push(withMask(target.virtualAddress));
      } else {
        notes.push(
          `"${vsKey}": virtualAddresses use-reference "${entry.use}" does not resolve — addresses not pushed`
        );
        return { addresses: null, notes };
      }
    } else {
      notes.push(
        `"${vsKey}": virtualAddresses entry ${JSON.stringify(entry).slice(0, 40)} is not pushable — addresses not pushed`
      );
      return { addresses: null, notes };
    }
  }
  return { addresses: out, notes };
}

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
    const entry: ManifestEntry = {
      as3Key,
      endpoint: spec.endpoint,
      id: Number(netboxObj.id),
      className,
      fields: spec.fromNetbox(netboxObj),
      as3Snapshot: JSON.parse(JSON.stringify(as3Snapshot)),
      lastUpdated: netboxObj.last_updated as string | undefined,
    };
    if (spec.endpoint === "backend-pools") {
      entry.members = memberRowsFromNetbox(netboxObj);
    }
    if (spec.endpoint === "virtual-servers") {
      entry.vips = (
        (netboxObj.virtual_addresses as Dict[] | undefined) ?? []
      ).map((v) => ({ id: Number(v.id), address: withMask(String(v.address)) }));
    }
    entries.push(entry);
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

// ---- create specs (W3) -----------------------------------------------------

const DEFAULT_PORT_BY_PROTOCOL: Record<string, number> = {
  http: 80,
  https: 443,
};

// Build a CreateObject for a declaration object with no manifest entry.
// Returns null (with notes) when the object cannot be created.
function buildCreate(
  as3Key: string,
  obj: Dict,
  notes: string[]
): CreateObject | null {
  const className = String(obj.class);
  const spec = KIND_BY_CLASS[className];
  if (!spec) return null; // caller notes unknown classes

  if (spec.endpoint === "backend-pools") {
    const { fields } = poolFieldsFromAs3(obj);
    if (!fields.load_balancing_algorithm)
      fields.load_balancing_algorithm = "round-robin";
    const { rows, notes: memberNotes } = memberRowsFromAs3(obj, as3Key);
    notes.push(...memberNotes);
    const monitorRefs: string[] = [];
    for (const m of (obj.monitors as unknown[] | undefined) ?? []) {
      if (isPlainObject(m) && typeof m.use === "string") {
        monitorRefs.push(sanitizeKey(m.use));
      } else if (typeof m === "string") {
        notes.push(
          `"${as3Key}": built-in monitor "${m}" has no NetBox object — not linked`
        );
      } else {
        notes.push(`"${as3Key}": unsupported monitor reference — not linked`);
      }
    }
    return {
      as3Key,
      className,
      endpoint: spec.endpoint,
      fields: { name: as3Key, ...fields },
      members: rows,
      refs: [],
      monitorRefs,
      label: `create Pool "${as3Key}"${rows.length ? ` with ${rows.length} member${rows.length === 1 ? "" : "s"}` : ""}`,
    };
  }

  if (spec.endpoint === "monitors") {
    const { fields } = monitorFieldsFromAs3(obj);
    if (typeof fields.monitor_type !== "string") {
      notes.push(`"${as3Key}": Monitor without monitorType cannot be created`);
      return null;
    }
    // NetBox requires interval/timeout; fall back to the AS3 defaults.
    if (fields.interval == null) fields.interval = 5;
    if (fields.timeout == null) fields.timeout = 16;
    return {
      as3Key,
      className,
      endpoint: spec.endpoint,
      fields: { name: as3Key, ...fields },
      refs: [],
      label: `create Monitor "${as3Key}" (${fields.monitor_type})`,
    };
  }

  if (spec.endpoint === "ssl-profiles") {
    const { fields } = tlsFieldsFromAs3(obj);
    const profileType = className === "TLS_Server" ? "client" : "server";
    const certificateNames: string[] = [];
    if (className === "TLS_Server") {
      for (const c of (obj.certificates as unknown[] | undefined) ?? []) {
        if (isPlainObject(c) && typeof c.certificate === "string")
          certificateNames.push(sanitizeKey(c.certificate));
      }
    } else if (typeof obj.clientCertificate === "string") {
      certificateNames.push(sanitizeKey(obj.clientCertificate));
    }
    if (certificateNames.length === 0) {
      notes.push(
        `"${as3Key}": ${className} without certificates cannot be created (NetBox requires at least one)`
      );
      return null;
    }
    return {
      as3Key,
      className,
      endpoint: spec.endpoint,
      fields: { name: as3Key, profile_type: profileType, ...fields },
      refs: [],
      certificateNames,
      label: `create ${className} "${as3Key}"`,
    };
  }

  // virtual-servers
  const { fields } = vsFieldsFromAs3(obj);
  if (!fields.protocol) {
    notes.push(`"${as3Key}": ${className} has no NetBox protocol mapping`);
    return null;
  }
  if (typeof fields.service_port !== "number") {
    const dflt = DEFAULT_PORT_BY_PROTOCOL[String(fields.protocol)];
    if (dflt === undefined) {
      notes.push(
        `"${as3Key}": virtualPort is required to create a ${fields.protocol} virtual server`
      );
      return null;
    }
    fields.service_port = dflt;
  }
  const refs: CreateObject["refs"] = [];
  if (typeof obj.pool === "string")
    refs.push({ field: "backend_pool", targetKey: sanitizeKey(obj.pool) });
  const serverTLS = obj.serverTLS;
  if (isPlainObject(serverTLS) && typeof serverTLS.use === "string")
    refs.push({ field: "ssl_profile", targetKey: sanitizeKey(serverTLS.use) });
  const clientTLS = obj.clientTLS;
  if (isPlainObject(clientTLS) && typeof clientTLS.use === "string")
    refs.push({
      field: "server_ssl_profile",
      targetKey: sanitizeKey(clientTLS.use),
    });
  if (obj.snat !== undefined)
    notes.push(`"${as3Key}": snat is not part of virtual-server creation — set it in NetBox`);
  return {
    as3Key,
    className,
    endpoint: "virtual-servers",
    fields: { name: as3Key, slug: slugify(as3Key), ...fields },
    vipAddresses: null, // filled by the caller (needs the application object)
    refs,
    label: `create ${className} "${as3Key}"`,
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
  const creates: CreateObject[] = [];
  const deletes: DeleteObject[] = [];
  const application = declaration[manifest.appKey] as Dict | undefined;
  if (!isPlainObject(application)) {
    return {
      updates: [],
      creates: [],
      deletes: [],
      notes: [
        `Application key "${manifest.appKey}" not found in the declaration — was it renamed? Renames are not supported.`,
      ],
    };
  }

  const knownKeys = new Set(manifest.entries.map((e) => e.as3Key));

  for (const entry of manifest.entries) {
    const current = application[entry.as3Key];
    if (current === undefined) {
      deletes.push({
        entry,
        label: `delete ${entry.className} "${entry.as3Key}" (#${entry.id})`,
      });
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

    // W2 granular ops: pool membership and VS virtual addresses.
    const ops: WriteOp[] = [];
    if (entry.members) {
      const { rows, notes: memberNotes } = memberRowsFromAs3(
        current,
        entry.as3Key
      );
      notes.push(...memberNotes);
      if (memberNotes.length === 0) {
        const key = (r: MemberRow) => `${r.address}|${r.servicePort}`;
        const nbByKey = new Map(entry.members.map((r) => [key(r), r]));
        const as3ByKey = new Map(rows.map((r) => [key(r), r]));
        for (const [k, row] of as3ByKey) {
          const existing = nbByKey.get(k);
          if (!existing) {
            const body: Dict = { service_port: row.servicePort };
            if (!row.enabled) body.enabled = false;
            if (row.ratio) body.ratio = row.ratio;
            if (row.priorityGroup) body.priority_group = row.priorityGroup;
            ops.push({
              op: "member-create",
              addressWithMask: row.addressWithMask,
              body,
              label: `add member ${row.address}:${row.servicePort}`,
            });
          } else {
            const body: Dict = {};
            if (existing.enabled !== row.enabled) body.enabled = row.enabled;
            if (existing.ratio !== row.ratio) body.ratio = row.ratio;
            if (existing.priorityGroup !== row.priorityGroup)
              body.priority_group = row.priorityGroup;
            if (Object.keys(body).length > 0 && existing.id !== undefined) {
              ops.push({
                op: "member-update",
                memberId: existing.id,
                body,
                label: `update member ${row.address}:${row.servicePort} (${Object.keys(body).join(", ")})`,
              });
            }
          }
        }
        for (const [k, row] of nbByKey) {
          if (!as3ByKey.has(k) && row.id !== undefined) {
            ops.push({
              op: "member-delete",
              memberId: row.id,
              label: `remove member ${row.address}:${row.servicePort}`,
            });
          }
        }
      }
    }
    if (entry.vips) {
      const { addresses, notes: vipNotes } = vipAddressesFromAs3(
        current,
        application,
        entry.as3Key
      );
      notes.push(...vipNotes);
      if (addresses !== null) {
        const before = entry.vips.map((v) => v.address).sort();
        const after = [...addresses].sort();
        if (!valueEq(before, after)) {
          ops.push({
            op: "vs-addresses",
            addresses,
            adds: after.filter((a) => !before.includes(a)),
            removes: before.filter((a) => !after.includes(a)),
            label: `set virtual addresses to ${addresses.join(", ") || "(none)"}`,
          });
        }
      }
    }

    // Did the object change in ways the diffs above didn't capture?
    const outOfScope = !valueEq(
      stripKnown(current, entry),
      stripKnown(entry.as3Snapshot as Dict, entry)
    );

    if (changes.length > 0 || ops.length > 0 || outOfScope) {
      updates.push({ entry, changes, ops, outOfScope });
      if (outOfScope) {
        notes.push(
          `"${entry.as3Key}" has additional edits outside the pushable scope (certificates, policies, profiles, …) that will NOT be pushed.`
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
      // Service_Address edits are covered by the vs-addresses op; other
      // artifact edits still wait for a later phase.
      if (
        value.class !== "Service_Address" &&
        !valueEq(value, manifest.artifacts[key])
      ) {
        notes.push(
          `"${key}" (${value.class}) was edited but is derived data (certificates, policies) — pushing it ships in a later phase.`
        );
      }
      continue;
    }
    const create = buildCreate(key, value, notes);
    if (!create) {
      // Service_Address / Certificate objects are consumed by the services
      // and TLS profiles that reference them — no standalone NetBox object.
      const cls = String(value.class);
      if (
        !KIND_BY_CLASS[cls] &&
        cls !== "Service_Address" &&
        cls !== "Certificate"
      ) {
        notes.push(`"${key}" (${cls}) has no NetBox model — cannot be created.`);
      }
      continue;
    }
    if (create.endpoint === "virtual-servers") {
      const { addresses, notes: vipNotes } = vipAddressesFromAs3(
        value,
        application,
        key
      );
      notes.push(...vipNotes);
      create.vipAddresses = addresses;
    }
    creates.push(create);
  }

  // FK-safe ordering for the apply loop.
  creates.sort(
    (a, b) => CREATE_ORDER.indexOf(a.endpoint) - CREATE_ORDER.indexOf(b.endpoint)
  );
  deletes.sort(
    (a, b) =>
      DELETE_ORDER.indexOf(a.entry.endpoint) -
      DELETE_ORDER.indexOf(b.entry.endpoint)
  );

  return { updates, creates, deletes, notes };
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
    "virtualAddresses", // handled by the vs-addresses op (W2)
  ],
  "backend-pools": [
    "class",
    "loadBalancingMode",
    "label",
    "minimumMembersActive",
    "members", // handled by member ops (W2)
  ],
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
