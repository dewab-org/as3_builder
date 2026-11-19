// Phase W1 of NetBox write-back (see NETBOX-WRITEBACK-PLAN.md): invert the
// SCALAR parts of the netboxAs3 rendering so edits made in the builder can be
// PATCHed onto the NetBox objects they came from.
//
// The provenance manifest is built at load time, while we still know exactly
// which NetBox object produced each AS3 key — no name guessing on the way
// back. Write-back therefore only works for declarations loaded through this
// tool in the current session.

import {
  LEGACY_LB_ALIASES,
  fqdnResolutionFromNetbox,
  isPersistencePolicy,
  sanitizeKey,
} from "./netboxAs3";
import { decodeBase64 } from "./base64";
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
  /** The NetBox object's name as loaded. When the AS3 key stops matching it
   * (a rename in the editor), the push renames the NetBox object. */
  netboxName?: string;
  /** Invertible NetBox field values as loaded. */
  fields: Dict;
  /** The AS3 object exactly as rendered at load (detects out-of-scope edits). */
  as3Snapshot: unknown;
  lastUpdated?: string;
  /** Pool entries: member rows as loaded (W2). */
  members?: MemberRow[];
  /** Pool entries: FQDN member rows as loaded, in the normalized AS3-group
   * shape. Compared only — FQDN member edits are not pushed. */
  fqdnMembers?: Dict[];
  /** Virtual-server entries: VIP addresses as loaded (W2). */
  vips?: { id: number; address: string }[];
  /** Pool entries: monitor AS3 keys as loaded (W4). */
  monitorKeys?: string[];
  /** Virtual-server entries: relation names as loaded (W4). */
  refNames?: {
    backend_pool: string | null;
    ssl_profile: string | null;
    server_ssl_profile: string | null;
  };
  /** Virtual-server entries: the linked SNAT pool's NetBox name as loaded. */
  snatPoolName?: string | null;
  /** Virtual-server entries: linked policy / protocol-profile names as loaded
   * (AS3-key form), for the M2M relink diffs. */
  linkNames?: {
    policies: string[];
    protocol_profiles: string[];
  };
  /** The application-level entry (label/extras map to the app object). */
  isApplication?: boolean;
}

/** Granular write operations beyond a scalar PATCH (W2/W4). */
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
    }
  | {
      op: "pool-monitors";
      keys: string[]; // monitor AS3 keys, resolved to ids at apply
      label: string;
    }
  | {
      op: "vs-ref";
      field: "backend_pool" | "ssl_profile" | "server_ssl_profile";
      targetKey: string | null; // null clears the reference
      label: string;
    }
  | {
      op: "vs-links";
      /** Which many-to-many field on the virtual server to set. */
      field: "policies" | "protocol_profiles";
      /** Target objects as AS3 keys (resolved via the manifest first, then by
       * NetBox name — these can be estate objects outside the declaration). */
      targetKeys: string[];
      label: string;
    }
  | {
      op: "vs-snat";
      /** SNAT pool name, resolved to an id at apply time; null clears it.
       * Pools are pre-created estate objects, so a missing name is an error,
       * never a create. */
      poolName: string | null;
      label: string;
    };

export interface AppManifest {
  declarationId: string;
  appId: number;
  appKey: string;
  /** Cluster for NEW virtual servers (plugin 0.9.0 G1 makes it required):
   * the single cluster the app's virtual servers run in, falling back to the
   * app's single placement cluster. null/absent = ambiguous — creates are
   * refused with a note rather than guessed. */
  createClusterId?: number | null;
  entries: ManifestEntry[];
  /** Rendered objects WITHOUT a writable manifest entry (Service_Address,
   * Certificate, cipher objects, …): key → snapshot as rendered. Used to
   * tell "edited artifact" (out of scope note) from "new object". */
  artifacts: Record<string, unknown>;
  /** Application members that came from Application.extra_parameters —
   * complete AS3 objects the plugin doesn't model. */
  extraKeys: string[];
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
  /** Service creates: linked policies by AS3 key (M2M) — policyEndpoint,
   * iRules, and the policies behind Persist pointers. Resolved via the
   * changeset's own creates first, then by NetBox name (estate objects). */
  policyKeys?: string[];
  /** Service creates: linked TCP/HTTP protocol profiles by AS3 key (M2M),
   * resolved the same way. */
  protocolProfileKeys?: string[];
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

/** FK-safe orders: create dependencies first, delete dependents first. */
export const CREATE_ORDER = [
  "monitors",
  "ssl-profiles",
  "policies",
  "protocol-profiles",
  "backend-pools",
  "virtual-servers",
];
export const DELETE_ORDER = [
  "virtual-servers",
  "policies",
  "protocol-profiles",
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

// The renderer truncates labels/remarks to 64 chars; snapshot descriptions
// must match or long descriptions would false-diff on every round trip.
function desc64(v: unknown): string {
  return String(v ?? "").slice(0, 64);
}

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

// NetBox FQDN member rows (plugin 0.8.0 F13) → the normalized AS3 group
// shape the renderer emits, for compare-only diffing.
function fqdnRowsFromNetbox(pool: Dict): Dict[] {
  const rows: Dict[] = [];
  for (const m of (pool.members as Dict[] | undefined) ?? []) {
    const node = m.node as Dict | undefined;
    if (node?.address || typeof m.hostname !== "string" || !m.hostname) continue;
    rows.push({
      hostname: m.hostname,
      servicePort: Number(m.service_port),
      enabled: m.enabled !== false,
      ratio: (m.ratio as number | null) ?? 0,
      priorityGroup: (m.priority_group as number | null) ?? 0,
      ...fqdnResolutionFromNetbox(m),
    });
  }
  return sortFqdnRows(rows);
}

// AS3 fqdn member groups → the same normalized shape.
function fqdnRowsFromAs3(pool: Dict): Dict[] {
  const rows: Dict[] = [];
  for (const group of (pool.members as Dict[] | undefined) ?? []) {
    if (!isPlainObject(group) || group.addressDiscovery !== "fqdn") continue;
    const row: Dict = {
      hostname: group.hostname,
      servicePort: group.servicePort,
      enabled: group.adminState !== "disable",
      ratio: typeof group.ratio === "number" ? group.ratio : 0,
      priorityGroup:
        typeof group.priorityGroup === "number" ? group.priorityGroup : 0,
    };
    for (const prop of ["addressFamily", "autoPopulate", "queryInterval", "downInterval"]) {
      if (group[prop] !== undefined) row[prop] = group[prop];
    }
    rows.push(row);
  }
  return sortFqdnRows(rows);
}

function sortFqdnRows(rows: Dict[]): Dict[] {
  return rows.sort(
    (a, b) =>
      String(a.hostname).localeCompare(String(b.hostname)) ||
      Number(a.servicePort) - Number(b.servicePort)
  );
}

// AS3 pool.members (grouped) → normalized rows; unsupported member shapes
// (bigip refs, non-fqdn discovery) come back as notes. FQDN groups are
// handled by fqdnRowsFromAs3 and skipped here without a blocking note.
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
    if (group.addressDiscovery === "fqdn") continue; // compare-only (F13)
    if (group.hostname || group.addressDiscovery) {
      notes.push(
        `"${poolKey}": discovery members other than fqdn cannot be pushed — skipped`
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
      if (entry.trim() === "") {
        notes.push(
          `"${vsKey}": virtualAddresses has an empty entry — addresses not pushed`
        );
        return { addresses: null, notes };
      }
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

// AS3 properties accounted for by other machinery, per endpoint. Everything
// ELSE on the object is treated as extra_parameters (or conditions/options)
// and pushed to the JSON catch-all field (W4).
const NON_EXTRA_PROPS: Record<string, string[]> = {
  "virtual-servers": [
    "class",
    "virtualPort",
    "remark",
    "enable",
    "virtualType",
    "persistenceMethods",
    "virtualAddresses", // W2 op
    "pool", // W4 ref op
    "serverTLS", // W4 ref op
    "clientTLS", // W4 ref op
    "snat", // relation op (vs-snat)
    "policyEndpoint", // relation, noted
    "iRules", // relation, noted
    "profileTCP", // relation, noted
    "profileHTTP", // relation, noted
  ],
  "backend-pools": [
    "class",
    "loadBalancingMode",
    "label",
    "minimumMembersActive",
    "members", // W2 ops
    "monitors", // W4 op
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
    "certificates", // relation, noted
    "clientCertificate", // relation, noted
    "cipherGroup", // relation, noted
  ],
  applications: ["class", "label"],
};

// The JSON catch-all field name per endpoint.
const EXTRA_FIELD: Record<string, string> = {
  "virtual-servers": "extra_parameters",
  "backend-pools": "extra_parameters",
  monitors: "conditions",
  "ssl-profiles": "options",
  applications: "extra_parameters",
};

// Complement of the handled props = the object's extras. For applications,
// member objects (anything with a class) are excluded too.
export function extrasFromAs3(endpoint: string, obj: Dict): Dict | null {
  const known = new Set(NON_EXTRA_PROPS[endpoint] ?? []);
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    if (known.has(k)) continue;
    if (endpoint === "applications" && isPlainObject(v) && "class" in v) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function vsFieldsFromNetbox(vs: Dict): Dict {
  return {
    protocol: vs.protocol,
    service_port: vs.service_port,
    description: desc64(vs.description),
    enabled: vs.enabled !== false,
    vs_type: vs.vs_type ?? "standard",
    persistence: [...((vs.persistence as unknown[] | undefined) ?? [])].sort(),
    extra_parameters: vs.extra_parameters ?? null, // snapshot only
  };
}

// AS3 persistenceMethods → the NetBox persistence list. A {use: …} pointer is
// a Persist profile reference, which NetBox states as "universal" (R5);
// builtin method names pass through. Sorted to match vsFieldsFromNetbox.
function persistenceFromAs3(methods: unknown): unknown[] {
  const out = new Set<string>();
  for (const m of (methods as unknown[] | undefined) ?? []) {
    if (typeof m === "string") out.add(m);
    else if (isPlainObject(m) && typeof m.use === "string") out.add("universal");
  }
  return [...out].sort();
}

function vsFieldsFromAs3(svc: Dict): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  const fields: Dict = {
    description: desc64(svc.remark),
    enabled: svc.enable !== false,
    vs_type: svc.virtualType ?? "standard",
    persistence: persistenceFromAs3(svc.persistenceMethods),
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
    description: desc64(pool.description),
    priority_group_activation: pool.priority_group_activation === true,
    priority_group_threshold: pool.priority_group_threshold ?? null,
    extra_parameters: pool.extra_parameters ?? null, // snapshot only
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
      description: desc64(pool.label),
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
    description: desc64(m.description),
    conditions: m.conditions ?? null, // snapshot only
  };
}

function monitorFieldsFromAs3(m: Dict): { fields: Dict; unsupported: string[] } {
  return {
    fields: {
      monitor_type: m.monitorType,
      interval: typeof m.interval === "number" ? m.interval : null,
      timeout: typeof m.timeout === "number" ? m.timeout : null,
      description: desc64(m.label),
    },
    unsupported: [],
  };
}

const TLS_INT_BY_LABEL: Record<string, number> = {
  "TLSv1.0": 0,
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
    options: profile.options ?? null, // snapshot only
  };
}

function tlsFieldsFromAs3(tls: Dict): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  const versions: number[] = [];
  // Effective enablement per AS3 defaults (1.0/1.1/1.2 on, 1.3 off). TLSv1.0
  // is storable since plugin 0.8.0, but only on a profile whose THD Cyber
  // exception reference is recorded in NetBox — NetBox refuses it otherwise.
  if ((tls.tls1_0Enabled as boolean | undefined) ?? true) versions.push(0);
  if ((tls.tls1_1Enabled as boolean | undefined) ?? true) versions.push(1);
  if ((tls.tls1_2Enabled as boolean | undefined) ?? true) versions.push(2);
  if ((tls.tls1_3Enabled as boolean | undefined) ?? false) versions.push(3);
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


// ---- relation-object kinds (W5) --------------------------------------------
//
// policies, protocol profiles and cipher objects each store a *complete* AS3
// object in a JSON column (Policy.rules, ProtocolProfile.options) or map
// field-for-field (cipher rules/groups). They are separate NetBox objects, so
// editing one is an ordinary PATCH once it carries a manifest entry.

// Policy.rules holds the COMPLETE AS3 object, not a bare script or rule list.
// Write-back therefore rebuilds that wrapper from the stored one and swaps in
// the edited content — writing the inner value alone would leave a record the
// renderer can no longer read.
//
// The renderer also has nowhere to put an iRule policy's description, so
// description is deliberately not diffed here: an unrepresentable field must
// never be pushed, or every push would blank it.
function iruleFieldsFromNetbox(p: Dict): Dict {
  return { rules: isPlainObject(p.rules) ? { ...p.rules } : (p.rules ?? null) };
}

/** Rebuild a policy wrapper, preserving keys (and the legacy source key) the
 * stored record used. */
function iruleWrapper(snapshot: Dict | undefined, tcl: string): Dict {
  const stored = isPlainObject(snapshot?.rules) ? { ...snapshot.rules } : {};
  const legacy = !("iRule" in stored) && typeof stored.rules === "string";
  return { class: "iRule", ...stored, [legacy ? "rules" : "iRule"]: tcl };
}

function iruleFieldsFromAs3(
  a: Dict,
  snapshot?: Dict
): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  const source = a.iRule;
  let tcl: string | null = null;
  if (isPlainObject(source) && typeof source.base64 === "string") {
    try {
      tcl = decodeBase64(source.base64);
    } catch {
      unsupported.push("iRule base64 could not be decoded");
    }
  } else if (typeof source === "string") {
    tcl = source; // AS3 also allows the script inline
  } else if (source !== undefined) {
    unsupported.push("iRule must be a base64 wrapper or a string");
  }
  const fields: Dict = {};
  if (tcl !== null) fields.rules = iruleWrapper(snapshot, tcl);
  else if (snapshot) fields.rules = snapshot.rules;
  return { fields, unsupported };
}

// Same wrapper rule as iRules: rules holds {class, rules: [...], strategy?}.
// strategy is part of that JSON, not a column of its own.
function policyFieldsFromNetbox(p: Dict): Dict {
  return {
    description: desc64(p.description),
    rules: isPlainObject(p.rules) ? { ...p.rules } : (p.rules ?? null),
  };
}

function policyFieldsFromAs3(
  a: Dict,
  snapshot?: Dict
): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  if (a.rules !== undefined && !Array.isArray(a.rules))
    unsupported.push("rules must be an array — not pushed");
  const stored = isPlainObject(snapshot?.rules) ? { ...snapshot.rules } : {};
  const wrapper: Dict = { class: "Endpoint_Policy", ...stored };
  if (Array.isArray(a.rules)) wrapper.rules = a.rules;
  if (typeof a.strategy === "string") wrapper.strategy = a.strategy;
  else delete wrapper.strategy;
  // label maps to the description column, so it never belongs in the JSON.
  delete wrapper.label;
  return {
    fields: { description: desc64(a.label), rules: wrapper },
    unsupported,
  };
}

function protocolProfileFieldsFromNetbox(pp: Dict): Dict {
  const options = isPlainObject(pp.options) ? pp.options : {};
  return { options: { ...options } };
}

function protocolProfileFieldsFromAs3(
  a: Dict
): { fields: Dict; unsupported: string[] } {
  // options holds the AS3 object verbatim, class included — the renderer
  // spreads everything but class back out, so this round-trips exactly.
  return { fields: { options: { ...a } }, unsupported: [] };
}

function cipherRuleFieldsFromNetbox(rule: Dict): Dict {
  return {
    description: desc64(rule.description),
    ciphers: rule.ciphers ?? [],
    dh_groups: rule.dh_groups ?? [],
    signature_algorithms: rule.signature_algorithms ?? [],
  };
}

function cipherRuleFieldsFromAs3(a: Dict): { fields: Dict; unsupported: string[] } {
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    fields: {
      description: desc64(a.label),
      ciphers: list(a.cipherSuites),
      dh_groups: list(a.namedGroups),
      signature_algorithms: list(a.signatureAlgorithms),
    },
    unsupported: [],
  };
}

function cipherGroupFieldsFromNetbox(group: Dict): Dict {
  return { description: desc64(group.description) };
}

function cipherGroupFieldsFromAs3(a: Dict): { fields: Dict; unsupported: string[] } {
  const unsupported: string[] = [];
  if (a.allowCipherRules !== undefined && !Array.isArray(a.allowCipherRules))
    unsupported.push("allowCipherRules must be an array");
  return { fields: { description: desc64(a.label) }, unsupported };
}

interface KindSpec {
  endpoint: string;
  fromNetbox: (n: Dict) => Dict;
  /** `snapshot` is the entry's NetBox fields as loaded; specs whose storage
   * is a whole-AS3-object JSON column use it to preserve unmodelled keys. */
  fromAs3: (
    a: Dict,
    snapshot?: Dict
  ) => { fields: Dict; unsupported: string[] };
}

// Application-level: the app object itself maps to the applications endpoint
// (label ↔ description, plus the extras catch-all handled in the diff loop).
const APPLICATION_KIND: KindSpec = {
  endpoint: "applications",
  fromNetbox: (app) => ({
    description: desc64(app.description),
    extra_parameters: app.extra_parameters ?? null, // snapshot only
  }),
  fromAs3: (appObj) => ({
    fields: { description: desc64(appObj.label) },
    unsupported: [],
  }),
};

const KIND_BY_CLASS: Record<string, KindSpec> = {
  Application: APPLICATION_KIND,
  Service_TCP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_HTTP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_HTTPS: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Service_UDP: { endpoint: "virtual-servers", fromNetbox: vsFieldsFromNetbox, fromAs3: vsFieldsFromAs3 },
  Pool: { endpoint: "backend-pools", fromNetbox: poolFieldsFromNetbox, fromAs3: poolFieldsFromAs3 },
  Monitor: { endpoint: "monitors", fromNetbox: monitorFieldsFromNetbox, fromAs3: monitorFieldsFromAs3 },
  TLS_Server: { endpoint: "ssl-profiles", fromNetbox: tlsFieldsFromNetbox, fromAs3: tlsFieldsFromAs3 },
  TLS_Client: { endpoint: "ssl-profiles", fromNetbox: tlsFieldsFromNetbox, fromAs3: tlsFieldsFromAs3 },
  iRule: { endpoint: "policies", fromNetbox: iruleFieldsFromNetbox, fromAs3: iruleFieldsFromAs3 },
  Endpoint_Policy: { endpoint: "policies", fromNetbox: policyFieldsFromNetbox, fromAs3: policyFieldsFromAs3 },
  TCP_Profile: { endpoint: "protocol-profiles", fromNetbox: protocolProfileFieldsFromNetbox, fromAs3: protocolProfileFieldsFromAs3 },
  HTTP_Profile: { endpoint: "protocol-profiles", fromNetbox: protocolProfileFieldsFromNetbox, fromAs3: protocolProfileFieldsFromAs3 },
  Cipher_Rule: { endpoint: "cipher-rules", fromNetbox: cipherRuleFieldsFromNetbox, fromAs3: cipherRuleFieldsFromAs3 },
  Cipher_Group: { endpoint: "cipher-groups", fromNetbox: cipherGroupFieldsFromNetbox, fromAs3: cipherGroupFieldsFromAs3 },
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
      netboxName: String(netboxObj.name ?? ""),
      fields: spec.fromNetbox(netboxObj),
      as3Snapshot: JSON.parse(JSON.stringify(as3Snapshot)),
      lastUpdated: netboxObj.last_updated as string | undefined,
    };
    if (spec.endpoint === "backend-pools") {
      entry.members = memberRowsFromNetbox(netboxObj);
      entry.fqdnMembers = fqdnRowsFromNetbox(netboxObj);
      entry.monitorKeys = (
        (netboxObj.monitors as Dict[] | undefined) ?? []
      ).map((m) => sanitizeKey(String(m.name)));
    }
    if (spec.endpoint === "virtual-servers") {
      entry.vips = (
        (netboxObj.virtual_addresses as Dict[] | undefined) ?? []
      ).map((v) => ({ id: Number(v.id), address: withMask(String(v.address)) }));
      const refName = (o: unknown) =>
        isPlainObject(o) && o.name ? sanitizeKey(String(o.name)) : null;
      // Live GraphQL: singular backend_pool; offline payloads: plural list.
      const firstPool =
        netboxObj.backend_pool ??
        ((netboxObj.backend_pools as Dict[] | undefined) ?? [])[0];
      entry.refNames = {
        backend_pool: refName(firstPool),
        ssl_profile: refName(netboxObj.ssl_profile),
        server_ssl_profile: refName(netboxObj.server_ssl_profile),
      };
      // SNAT pools are referenced by NetBox name, not by an AS3 key: they are
      // estate objects that exist independently of any declaration.
      entry.snatPoolName = isPlainObject(netboxObj.snat_pool)
        ? String(netboxObj.snat_pool.name)
        : null;
      const linkNames = (list: Dict[]) =>
        list.map((o) => sanitizeKey(String(o.name)));
      // Only links the renderer represents as per-VS pointers belong here,
      // or an untouched declaration diffs as a detach:
      // - a Service_*-class protocol profile is spread into the service's own
      //   fields (no pointer), so only TCP/HTTP profiles are link targets;
      // - a persistence iRule (R5) is reached through persistenceMethods and
      //   its Persist artifact, never the iRules list.
      entry.linkNames = {
        policies: linkNames(
          ((netboxObj.policies as Dict[] | undefined) ?? []).filter(
            (p) => !isPersistencePolicy(p)
          )
        ),
        protocol_profiles: linkNames(
          ((netboxObj.protocol_profiles as Dict[] | undefined) ?? []).filter(
            (pp) => {
              const cls = isPlainObject(pp.options) ? pp.options.class : undefined;
              return cls === "TCP_Profile" || cls === "HTTP_Profile";
            }
          )
        ),
      };
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
    // Policies: exactly one standard policy maps 1:1 to an Endpoint_Policy.
    // Two or more are merged by the renderer into a synthetic object with no
    // single NetBox owner, so that stays read-only (explained at diff time).
    const policies = (vs.policies as Dict[] | undefined) ?? [];
    const standard = policies.filter((p) => p.policy_type === "standard");
    if (standard.length === 1) {
      add(
        standard[0],
        "Endpoint_Policy",
        KIND_BY_CLASS.Endpoint_Policy,
        String(standard[0].name)
      );
    }
    for (const p of policies) {
      if (p.policy_type === "irule")
        add(p, "iRule", KIND_BY_CLASS.iRule, String(p.name));
    }

    for (const pp of (vs.protocol_profiles as Dict[] | undefined) ?? []) {
      const cls = isPlainObject(pp.options) ? pp.options.class : undefined;
      // Service_* options are spread into the virtual server's own fields by
      // the renderer, so they have no standalone AS3 object to edit.
      if (cls === "TCP_Profile" || cls === "HTTP_Profile")
        add(pp, cls, KIND_BY_CLASS[cls], String(pp.name));
    }

    for (const profile of [vs.ssl_profile, vs.server_ssl_profile]) {
      const group = isPlainObject(profile) ? profile.cipher_group : undefined;
      if (!isPlainObject(group)) continue;
      add(group, "Cipher_Group", KIND_BY_CLASS.Cipher_Group, String(group.name));
      for (const rule of (group.cipher_rules as Dict[] | undefined) ?? [])
        add(rule, "Cipher_Rule", KIND_BY_CLASS.Cipher_Rule, String(rule.name));
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

  // Application-level entry: label ↔ description + app extras (W4).
  if (isPlainObject(application)) {
    entries.unshift({
      as3Key: appKey,
      endpoint: "applications",
      id: Number(app.id),
      className: "Application",
      netboxName: String(app.name ?? ""),
      fields: APPLICATION_KIND.fromNetbox(app),
      as3Snapshot: JSON.parse(JSON.stringify(application)),
      lastUpdated: app.last_updated as string | undefined,
      isApplication: true,
    });
  }

  const artifacts: Record<string, unknown> = {};
  if (isPlainObject(application)) {
    for (const [key, value] of Object.entries(application)) {
      if (seen.has(key) || !isPlainObject(value) || typeof value.class !== "string")
        continue;
      artifacts[key] = JSON.parse(JSON.stringify(value));
    }
  }

  const extraKeys = isPlainObject(app.extra_parameters)
    ? Object.keys(app.extra_parameters).map((k) => sanitizeKey(k))
    : [];

  // Cluster for new virtual servers (0.9.0 G1): the single cluster the app's
  // virtual servers resolve to, else the app's single placement cluster.
  const clusterIds = new Set<number>();
  for (const vs of (app.virtual_servers as Dict[] | undefined) ?? []) {
    const cluster = vs.cluster as Dict | undefined;
    if (cluster?.id != null) clusterIds.add(Number(cluster.id));
  }
  let createClusterId: number | null =
    clusterIds.size === 1 ? [...clusterIds][0] : null;
  if (createClusterId === null && clusterIds.size === 0) {
    const placements = (app.clusters as Dict[] | undefined) ?? [];
    if (placements.length === 1 && placements[0].id != null)
      createClusterId = Number(placements[0].id);
  }

  return {
    declarationId: String(declaration.id ?? ""),
    appId: Number(app.id),
    appKey,
    createClusterId,
    entries,
    artifacts,
    extraKeys,
  };
}

// ---- create specs (W3) -----------------------------------------------------

const DEFAULT_PORT_BY_PROTOCOL: Record<string, number> = {
  http: 80,
  https: 443,
};

// Build a CreateObject for a declaration object with no manifest entry.
// Returns null (with notes) when the object cannot be created.
/** The AS3 key a pointer names ("name" or {use: "name"}), or null when it
 * points outside the declaration (a {bigip} path with no NetBox row here). */
function pointerKey(v: unknown): string | null {
  if (typeof v === "string") return sanitizeKey(v);
  if (isPlainObject(v) && typeof v.use === "string") return sanitizeKey(v.use);
  return null;
}

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

  if (spec.endpoint === "policies") {
    const policyType = className === "iRule" ? "irule" : "standard";
    const { fields, unsupported } = spec.fromAs3(obj);
    for (const u of unsupported) notes.push(`"${as3Key}": ${u}`);
    if (!isPlainObject(fields.rules)) {
      notes.push(
        `"${as3Key}": ${className} without usable rules cannot be created`
      );
      return null;
    }
    return {
      as3Key,
      className,
      endpoint: spec.endpoint,
      fields: { name: as3Key, policy_type: policyType, ...fields },
      refs: [],
      label: `create ${policyType} policy "${as3Key}"`,
    };
  }

  if (spec.endpoint === "protocol-profiles") {
    const protocolType = className === "TCP_Profile" ? "tcp" : "http";
    const { fields } = spec.fromAs3(obj);
    return {
      as3Key,
      className,
      endpoint: spec.endpoint,
      fields: { name: as3Key, protocol_type: protocolType, ...fields },
      refs: [],
      label: `create ${className} "${as3Key}"`,
    };
  }

  if (spec.endpoint !== "virtual-servers") {
    // Cipher objects and the like: no standalone create path.
    notes.push(`"${as3Key}": ${className} cannot be created from a push`);
    return null;
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

  // M2M links the service states as pointers: the endpoint policy, its
  // iRules, and TCP/HTTP profile pointers. Persist pointers are resolved by
  // the caller (they need the application object).
  const policyKeys: string[] = [];
  const pe = pointerKey(obj.policyEndpoint);
  if (pe) policyKeys.push(pe);
  for (const r of (obj.iRules as unknown[] | undefined) ?? []) {
    const k = pointerKey(r);
    if (k) policyKeys.push(k);
  }
  const protocolProfileKeys: string[] = [];
  for (const p of [obj.profileTCP, obj.profileHTTP]) {
    const k = pointerKey(p);
    if (k) protocolProfileKeys.push(k);
  }

  return {
    as3Key,
    className,
    // slug is derived and read-only since plugin 0.9.0 (G1); cluster is
    // stamped by computeUpdates from the manifest.
    endpoint: "virtual-servers",
    fields: { name: as3Key, ...fields },
    vipAddresses: null, // filled by the caller (needs the application object)
    refs,
    policyKeys,
    protocolProfileKeys,
    label: `create ${className} "${as3Key}"`,
  };
}

// ---- net-new applications --------------------------------------------------

/** The declaration member that is the AS3 Application object, for
 * bootstrapping a net-new push. null when the declaration has none. */
export function findApplicationKey(declaration: Dict): string | null {
  for (const [k, v] of Object.entries(declaration)) {
    if (isPlainObject(v) && v.class === "Application") return k;
  }
  return null;
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  );
}

/**
 * Provenance for an application that was JUST created in NetBox from this
 * declaration (net-new push): one application-level entry, so everything the
 * declaration holds becomes a create against that application, placed on the
 * surveyed cluster. From then on the ordinary diff machinery applies.
 */
export function newAppManifest(
  declaration: Dict,
  appKey: string,
  createdApp: Dict,
  clusterId: number
): AppManifest {
  const application = declaration[appKey];
  return {
    declarationId: String(declaration.id ?? ""),
    appId: Number(createdApp.id),
    appKey,
    createClusterId: clusterId,
    entries: [
      {
        as3Key: appKey,
        endpoint: "applications",
        id: Number(createdApp.id),
        className: "Application",
        // No netboxName: the surveyed name need not match the AS3 key, and
        // must not read as a rename. The post-push reload builds a real
        // manifest from NetBox.
        // Snapshot the DECLARATION's view, not the created record: the
        // surveyed description need not appear as a label in the editor, and
        // must not diff as "clear the description". The post-push reload
        // renders NetBox's truth back into the editor.
        fields: isPlainObject(application)
          ? APPLICATION_KIND.fromAs3(application).fields
          : { description: "" },
        as3Snapshot: isPlainObject(application)
          ? JSON.parse(JSON.stringify(application))
          : {},
        lastUpdated: createdApp.last_updated as string | undefined,
        isApplication: true,
      },
    ],
    artifacts: {},
    extraKeys: [],
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
    const current = entry.isApplication
      ? application
      : application[entry.as3Key];
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
    const { fields, unsupported } = spec.fromAs3(current, entry.fields);
    for (const u of unsupported) notes.push(`"${entry.as3Key}": ${u}`);

    const changes: FieldChange[] = [];
    for (const [field, to] of Object.entries(fields)) {
      const from = entry.fields[field];
      if (!valueEq(from, to)) changes.push({ field, from, to });
    }

    // A rename in the editor: the AS3 key no longer matches the name this
    // object was loaded under, so the push renames it in NetBox in place
    // (never delete + create).
    if (
      entry.netboxName !== undefined &&
      entry.as3Key !== sanitizeKey(entry.netboxName)
    ) {
      changes.push({ field: "name", from: entry.netboxName, to: entry.as3Key });
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
      // FQDN members (F13) are rendered but compare-only: an edit is
      // reported, never pushed.
      if (!valueEq(entry.fqdnMembers ?? [], fqdnRowsFromAs3(current))) {
        notes.push(
          `"${entry.as3Key}": FQDN member changes are not pushed — edit them in NetBox.`
        );
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

    // W4: pool monitor list (M2M by AS3 key).
    if (entry.monitorKeys) {
      const desired: string[] = [];
      let linkable = true;
      for (const m of (current.monitors as unknown[] | undefined) ?? []) {
        if (isPlainObject(m) && typeof m.use === "string") {
          desired.push(sanitizeKey(m.use));
        } else {
          notes.push(
            `"${entry.as3Key}": monitor reference ${JSON.stringify(m).slice(0, 30)} has no NetBox object — monitor list not pushed`
          );
          linkable = false;
        }
      }
      if (
        linkable &&
        !valueEq([...desired].sort(), [...entry.monitorKeys].sort())
      ) {
        ops.push({
          op: "pool-monitors",
          keys: desired,
          label: `set monitors to ${desired.join(", ") || "(none)"}`,
        });
      }
    }

    // W4: virtual-server relation rewiring by name.
    if (entry.refNames) {
      const refOf = (v: unknown): string | null | undefined => {
        if (v === undefined) return null;
        if (typeof v === "string") return sanitizeKey(v);
        if (isPlainObject(v) && typeof v.use === "string")
          return sanitizeKey(v.use);
        return undefined; // {bigip} etc. — not a document reference
      };
      const refProps: [
        string,
        "backend_pool" | "ssl_profile" | "server_ssl_profile",
      ][] = [
        ["pool", "backend_pool"],
        ["serverTLS", "ssl_profile"],
        ["clientTLS", "server_ssl_profile"],
      ];
      for (const [as3Prop, field] of refProps) {
        const target = refOf(current[as3Prop]);
        if (target === undefined) {
          if (!valueEq(current[as3Prop], (entry.as3Snapshot as Dict)[as3Prop]))
            notes.push(
              `"${entry.as3Key}": ${as3Prop} points outside the declaration — not pushed`
            );
          continue;
        }
        if (target !== entry.refNames[field]) {
          ops.push({
            op: "vs-ref",
            field,
            targetKey: target,
            label:
              target === null
                ? `clear ${as3Prop}`
                : `set ${as3Prop} to "${target}"`,
          });
        }
      }
    }


    // Policies and protocol profiles: AS3 points at them per virtual server,
    // NetBox links them many-to-many. Retargeting is a relink of that set —
    // the objects themselves are written (or not) by their own entries.
    if (entry.linkNames) {
      const gather = (
        values: unknown[]
      ): { keys: string[]; unresolved: unknown[] } => {
        const keys: string[] = [];
        const unresolved: unknown[] = [];
        for (const v of values) {
          if (v === undefined) continue;
          const key = pointerKey(v);
          // A rendered artifact (the merged multi-policy object, say) is not a
          // NetBox row, so it can never be the target of a link.
          if (key === null || key in manifest.artifacts) unresolved.push(v);
          else keys.push(key);
        }
        return { keys, unresolved };
      };

      const iRules = Array.isArray(current.iRules) ? current.iRules : [];
      const linkSets: [
        "policies" | "protocol_profiles",
        unknown[],
        string,
      ][] = [
        ["policies", [current.policyEndpoint, ...iRules], "policyEndpoint/iRules"],
        [
          "protocol_profiles",
          [current.profileTCP, current.profileHTTP],
          "profileTCP/profileHTTP",
        ],
      ];

      for (const [field, values, as3Props] of linkSets) {
        const { keys, unresolved } = gather(values);
        for (const u of unresolved)
          notes.push(
            `"${entry.as3Key}": ${as3Props} points at ${JSON.stringify(u)}, which is not a NetBox object of its own — the link was not changed`
          );
        // Order is NetBox's to decide; compare as sets.
        const same =
          keys.length === entry.linkNames[field].length &&
          [...keys].sort().join("\u0000") ===
            [...entry.linkNames[field]].sort().join("\u0000");
        if (!same && unresolved.length === 0) {
          ops.push({
            op: "vs-links",
            field,
            targetKeys: keys,
            label:
              keys.length === 0
                ? `detach all ${field.replace("_", " ")}`
                : `link ${field.replace("_", " ")} to ${keys
                    .map((k) => `"${k}"`)
                    .join(", ")}`,
          });
        }
      }
    }

    // SNAT: declarations consume a pre-created pool, they never define one.
    // AS3 spells that as {bigip: "/Partition/Folder/<name>"}; the keywords
    // "auto"/"none"/"self" mean "no pool", which clears the link.
    if (entry.snatPoolName !== undefined) {
      const snat = current.snat;
      let desired: string | null | undefined;
      if (snat === undefined) desired = null;
      else if (typeof snat === "string")
        desired = snat === "auto" || snat === "none" || snat === "self"
          ? null
          : undefined;
      else if (isPlainObject(snat) && typeof snat.bigip === "string")
        desired = String(snat.bigip).split("/").filter(Boolean).pop() ?? null;
      else desired = undefined;

      if (desired === undefined) {
        if (!valueEq(snat, (entry.as3Snapshot as Dict).snat))
          notes.push(
            `"${entry.as3Key}": snat must be a {bigip: "/Common/Shared/<pool>"} pointer or auto/none/self — "${JSON.stringify(snat)}" was not pushed`
          );
      } else if (desired !== entry.snatPoolName) {
        ops.push({
          op: "vs-snat",
          poolName: desired,
          label:
            desired === null
              ? "clear snat pool"
              : `point snat at pool "${desired}"`,
        });
      }
    }

    // W4: extras catch-all (extra_parameters / conditions / options). Only
    // pushable when the loaded extras round-trip cleanly — if the renderer
    // merged data from other sources (protocol profiles etc.), pushing the
    // complement would smuggle it into the catch-all field.
    if (entry.isApplication) {
      // Application.extra_parameters carries COMPLETE AS3 objects keyed by
      // name: everything in the application that isn't a modelled object and
      // isn't a renderer artifact belongs there.
      const rendererArtifacts = new Set(
        Object.keys(manifest.artifacts).filter(
          (k) => !manifest.extraKeys.includes(k)
        )
      );
      const desired: Dict = {};
      for (const [key, value] of Object.entries(current)) {
        if (!isPlainObject(value) || typeof value.class !== "string") continue;
        if (knownKeys.has(key) || rendererArtifacts.has(key)) continue;
        // A new object of a class NetBox models becomes a real object (W3
        // create); only unmodelled classes — and objects that already lived
        // in extras — belong in extra_parameters.
        if (!manifest.extraKeys.includes(key) && KIND_BY_CLASS[String(value.class)])
          continue;
        desired[key] = value;
      }
      const before = (entry.fields.extra_parameters ?? null) as Dict | null;
      const after = Object.keys(desired).length > 0 ? desired : null;
      if (!valueEq(before, after)) {
        changes.push({ field: "extra_parameters", from: before, to: after });
      }
    }

    const extraField = entry.isApplication ? undefined : EXTRA_FIELD[entry.endpoint];
    if (extraField) {
      const currentExtras = extrasFromAs3(entry.endpoint, current);
      const snapshotExtras = extrasFromAs3(
        entry.endpoint,
        entry.as3Snapshot as Dict
      );
      if (!valueEq(currentExtras, snapshotExtras)) {
        if (!valueEq(snapshotExtras, entry.fields[extraField] ?? null)) {
          notes.push(
            `"${entry.as3Key}": edited properties map to ${extraField}, but the loaded value has mixed provenance — not pushed`
          );
        } else {
          changes.push({
            field: extraField,
            from: entry.fields[extraField] ?? null,
            to: currentExtras,
          });
        }
      }
    }

    // Anything left that the diffs above don't cover (relation props that
    // only note): changed?
    const noted = NOTED_RELATION_PROPS[entry.endpoint] ?? [];
    const pickNoted = (o: Dict) =>
      Object.fromEntries(noted.map((p) => [p, o[p]]));
    const outOfScope = !valueEq(
      pickNoted(current),
      pickNoted(entry.as3Snapshot as Dict)
    );

    if (changes.length > 0 || ops.length > 0 || outOfScope) {
      updates.push({ entry, changes, ops, outOfScope });
      if (outOfScope) {
        notes.push(
          `"${entry.as3Key}" changes which policy, profile or certificate it points at — retargeting those references is not implemented, so that part was not pushed.`
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
          value.class === "Endpoint_Policy"
            ? `"${key}" was edited but is a merged view of several NetBox policies on one virtual server — there is no single object to write it back to. Edit the individual policies in NetBox.`
            : value.class === "Certificate"
              ? CERTIFICATE_NOTE(key, "was edited")
              : `"${key}" (${value.class}) was edited but is derived data with no NetBox object of its own — not pushable.`
        );
      }
      continue;
    }
    const create = buildCreate(key, value, notes);
    if (!create) {
      // Service_Address objects are consumed by the services that reference
      // them — no standalone NetBox object.
      const cls = String(value.class);
      if (cls === "Certificate") {
        notes.push(CERTIFICATE_NOTE(key, "is new"));
      } else if (
        !KIND_BY_CLASS[cls] &&
        cls !== "Service_Address" &&
        // A Persist profile is represented by its policy's is_persistence
        // flag and the service's persistence method — nothing of its own.
        cls !== "Persist"
      ) {
        notes.push(
          `"${key}" (${cls}) has no NetBox model — stored in the application's extra_parameters.`
        );
      }
      continue;
    }
    if (create.endpoint === "virtual-servers") {
      // cluster is required since plugin 0.9.0 (G1). Never guess one: an
      // ambiguous or unknown cluster refuses the create with a note.
      const clusterId = manifest.createClusterId ?? null;
      if (clusterId === null) {
        notes.push(
          `"${key}": a virtual server needs a cluster, and this application's could not be determined at load (several clusters, or a manifest from an older load) — create it in NetBox, or reload the application first.`
        );
        continue;
      }
      create.fields.cluster = clusterId;
      const { addresses, notes: vipNotes } = vipAddressesFromAs3(
        value,
        application,
        key
      );
      notes.push(...vipNotes);
      create.vipAddresses = addresses;
      // Universal persistence points at a Persist artifact whose iRule names
      // the persistence policy (R5) — that policy must be linked on the VS.
      for (const m of (value.persistenceMethods as unknown[] | undefined) ?? []) {
        if (!isPlainObject(m) || typeof m.use !== "string") continue;
        const target = application[sanitizeKey(m.use)];
        if (
          isPlainObject(target) &&
          target.class === "Persist" &&
          typeof target.iRule === "string"
        ) {
          create.policyKeys = [
            ...new Set([...(create.policyKeys ?? []), sanitizeKey(target.iRule)]),
          ];
        }
      }
    }
    creates.push(create);
  }

  // An iRule referenced by a Persist artifact is a persistence method (R5):
  // its created record must say so, or the plugin refuses a virtual server
  // that requests universal persistence through it.
  for (const [, value] of Object.entries(application)) {
    if (
      !isPlainObject(value) ||
      value.class !== "Persist" ||
      typeof value.iRule !== "string"
    )
      continue;
    const policyCreate = creates.find(
      (c) =>
        c.endpoint === "policies" && c.as3Key === sanitizeKey(value.iRule as string)
    );
    if (policyCreate && isPlainObject(policyCreate.fields.rules)) {
      policyCreate.fields.is_persistence = true;
      policyCreate.fields.rules = {
        ...policyCreate.fields.rules,
        isPersistenceMethod: true,
      };
    }
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

// Relation-shaped properties that only NOTE on change (no write support):
// their NetBox counterparts are relations we don't rewire yet.
// NetBox holds certificate metadata only — a pointer to material that lives
// in the certificate estate (Venafi / the BIG-IP), not the certificate itself.
// Nothing about a certificate is therefore writable from a declaration.
const CERTIFICATE_NOTE = (key: string, what: string) =>
  `"${key}" ${what}, but certificates are pointers: NetBox stores metadata only and the material lives in the certificate estate. Manage it there — nothing is pushed.`;

// Relation properties with no write path yet: editing one is reported, not
// pushed. `snat` is absent deliberately — retargeting it is a vs-snat op.
const NOTED_RELATION_PROPS: Record<string, string[]> = {
  // Virtual-server relations all have write paths now (vs-ref, vs-snat,
  // vs-links), so nothing here is merely noted.
  "ssl-profiles": ["certificates", "clientCertificate", "cipherGroup"],
};
