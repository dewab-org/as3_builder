// Render an application graph from the netbox-load-balancer plugin as a
// per-app AS3 declaration. This is a TypeScript port of the core mapping in
// f5_toolbox's graphql_to_as3 transformer (pydantic_builders/*). The input is
// the GraphQL application shape (APPLICATION_GRAPH_QUERY below), matching
// what f5_toolbox queries.

import { isPlainObject } from "./types";

export interface NetboxRenderResult {
  declaration: Record<string, unknown>;
  warnings: string[];
}

// ---- GraphQL documents -----------------------------------------------------

export const APPLICATION_LIST_QUERY = `query {
  application_list {
    id
    name
    description
  }
}`;

// Adapted from f5_toolbox application_by_snow_sys_id.graphql (filter by id).
export function applicationGraphQuery(appId: number | string): string {
  return `query {
  application_list(filters: { id: ${Number(appId)} }) {
    id name snow_sys_id description last_updated extra_parameters
    virtual_servers {
      id name slug description enabled last_updated
      applications { id name }
      backend_pool {
        id name description load_balancing_algorithm last_updated
        monitors { id name description monitor_type interval timeout conditions last_updated }
        priority_group_activation priority_group_threshold extra_parameters
        members {
          id
          node { id address }
          service_port enabled ratio priority_group extra_parameters
        }
      }
      service_port vs_type protocol
      destination_addresses { id address }
      virtual_addresses { id address }
      policies { id name policy_type rules description last_updated }
      persistence
      ssl_profile {
        id name profile_type last_updated
        certificates { id name description distinguished_name }
        cipher_group {
          id name description last_updated
          cipher_rules {
            id priority name description ciphers dh_groups signature_algorithms
            last_updated
          }
        }
        ciphers tls_versions mtls options
      }
      server_ssl_profile {
        id name profile_type last_updated
        certificates { id name description distinguished_name }
        cipher_group {
          id name description last_updated
          cipher_rules {
            id priority name description ciphers dh_groups signature_algorithms
            last_updated
          }
        }
        ciphers tls_versions mtls options
      }
      protocol_profiles { id name protocol_type options last_updated }
      snat_pool { id name description members { id address } }
      extra_parameters
    }
  }
}`;
}

// ---- helpers ---------------------------------------------------------------

type Dict = Record<string, unknown>;

// NetBox LB plugin < 0.3.0 exposed pre-AS3 load-balancing values; normalize
// them forward (same map as f5_toolbox _LEGACY_LB_ALIASES).
export const LEGACY_LB_ALIASES: Record<string, string> = {
  "least-connections": "least-connections-member",
  "source-ip": "round-robin",
};

const SERVICE_CLASS: Record<string, string> = {
  tcp: "Service_TCP",
  http: "Service_HTTP",
  https: "Service_HTTPS",
  udp: "Service_UDP",
};

// AS3 application-key grammar: ^[A-Za-z][0-9A-Za-z_.-]*$, max 190; f5_toolbox
// truncates application names to 64.
export function sanitizeKey(name: string, maxLength = 64): string {
  let out = String(name).replace(/[^0-9A-Za-z_.-]/g, "_");
  if (!/^[A-Za-z]/.test(out)) out = `A_${out}`;
  return out.slice(0, maxLength);
}

function sanitizeLabel(text: string): string {
  return String(text).slice(0, 64);
}

function stripCidr(address: string): string {
  return String(address).replace(/\/\d+$/, "");
}

function decodeBase64Pem(value: string): string {
  try {
    const decoded =
      typeof atob === "function"
        ? atob(value)
        : Buffer.from(value, "base64").toString("utf-8");
    if (decoded.startsWith("-----BEGIN ") && decoded.includes("-----END "))
      return decoded;
  } catch {
    /* not base64 */
  }
  return value;
}

function toBase64(value: string): string {
  return typeof btoa === "function"
    ? btoa(value)
    : Buffer.from(value, "utf-8").toString("base64");
}

// ---- renderer --------------------------------------------------------------

class Renderer {
  warnings: string[] = [];
  objects: Dict = {}; // named AS3 objects within the Application

  warn(msg: string) {
    this.warnings.push(msg);
  }

  // Add a named object; first render wins, mismatched duplicates warn.
  addObject(key: string, value: Dict): string {
    const existing = this.objects[key];
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(value)) {
        this.warn(`Name collision on "${key}"; keeping the first definition`);
      }
      return key;
    }
    this.objects[key] = value;
    return key;
  }

  spreadExtras(target: Dict, extras: unknown, context: string): void {
    if (!extras || typeof extras !== "object") return;
    for (const [k, v] of Object.entries(extras as Dict)) {
      if (k in target) this.warn(`${context}: extra_parameters override "${k}"`);
      target[k] = v;
    }
  }

  renderMonitor(monitor: Dict): string {
    const key = sanitizeKey(String(monitor.name));
    const obj: Dict = { class: "Monitor", monitorType: monitor.monitor_type };
    if (monitor.monitor_type !== "inband") {
      if (monitor.interval != null) obj.interval = monitor.interval;
      if (monitor.timeout != null) obj.timeout = monitor.timeout;
    }
    if (monitor.description) obj.label = sanitizeLabel(String(monitor.description));
    if (monitor.conditions && typeof monitor.conditions === "object") {
      Object.assign(obj, monitor.conditions as Dict);
    }
    return this.addObject(key, obj);
  }

  renderPool(pool: Dict): string {
    const key = sanitizeKey(String(pool.name));
    const obj: Dict = { class: "Pool" };
    if (pool.load_balancing_algorithm) {
      const raw = String(pool.load_balancing_algorithm);
      obj.loadBalancingMode = LEGACY_LB_ALIASES[raw] ?? raw;
    }
    if (pool.description) obj.label = sanitizeLabel(String(pool.description));
    const monitors = (pool.monitors as Dict[] | undefined) ?? [];
    if (monitors.length > 0) {
      obj.monitors = monitors.map((m) => ({ use: this.renderMonitor(m) }));
    }
    if (pool.priority_group_activation && pool.priority_group_threshold != null) {
      obj.minimumMembersActive = pool.priority_group_threshold;
    }

    // Group members by (port, disabled, ratio, priorityGroup) — matches
    // f5_toolbox so equal-state members collapse into one serverAddresses[].
    const groups = new Map<string, Dict>();
    for (const member of (pool.members as Dict[] | undefined) ?? []) {
      const node = member.node as Dict | undefined;
      const address = node?.address ? stripCidr(String(node.address)) : undefined;
      if (!address) {
        this.warn(`Pool "${key}": member without node address skipped`);
        continue;
      }
      const disabled = member.enabled === false;
      const ratio = (member.ratio as number | null) ?? 0;
      const priorityGroup = (member.priority_group as number | null) ?? 0;
      const groupKey = `${member.service_port}|${disabled}|${ratio}|${priorityGroup}`;
      let entry = groups.get(groupKey);
      if (!entry) {
        entry = { servicePort: member.service_port, serverAddresses: [] as string[] };
        if (disabled) entry.adminState = "disable";
        if (ratio) entry.ratio = ratio;
        if (priorityGroup) entry.priorityGroup = priorityGroup;
        groups.set(groupKey, entry);
      }
      (entry.serverAddresses as string[]).push(address);
      this.spreadExtras(entry, member.extra_parameters, `Pool "${key}" member`);
    }
    if (groups.size > 0) obj.members = [...groups.values()];

    this.spreadExtras(obj, pool.extra_parameters, `Pool "${key}"`);
    return this.addObject(key, obj);
  }

  renderCertificate(cert: Dict): string {
    const key = sanitizeKey(String(cert.name));
    const obj: Dict = { class: "Certificate" };
    if (typeof cert.certificate === "string" && cert.certificate) {
      obj.certificate = { text: decodeBase64Pem(cert.certificate) };
      if (typeof cert.privateKey === "string" && cert.privateKey)
        obj.privateKey = { text: decodeBase64Pem(cert.privateKey) };
      if (typeof cert.passphrase === "string" && cert.passphrase)
        obj.passphrase = { ciphertext: cert.passphrase };
    } else {
      // NetBox stores only metadata; reference the certificate assumed to
      // already exist on the BIG-IP.
      obj.certificate = { bigip: `/Common/${key}.crt` };
      obj.privateKey = { bigip: `/Common/${key}.key` };
      obj.remark = "PEM not stored in NetBox - references existing BIG-IP cert";
    }
    return this.addObject(key, obj);
  }

  renderCipherGroup(group: Dict): string {
    const key = sanitizeKey(String(group.name));
    const rules = [...((group.cipher_rules as Dict[] | undefined) ?? [])].sort(
      (a, b) =>
        ((a.priority as number) ?? 0) - ((b.priority as number) ?? 0) ||
        String(a.name).localeCompare(String(b.name))
    );
    const ruleKeys = rules.map((rule) => {
      const ruleKey = sanitizeKey(String(rule.name));
      const ruleObj: Dict = { class: "Cipher_Rule" };
      if (Array.isArray(rule.ciphers) && rule.ciphers.length)
        ruleObj.cipherSuites = rule.ciphers;
      if (Array.isArray(rule.dh_groups) && rule.dh_groups.length)
        ruleObj.namedGroups = rule.dh_groups;
      if (Array.isArray(rule.signature_algorithms) && rule.signature_algorithms.length)
        ruleObj.signatureAlgorithms = rule.signature_algorithms;
      if (rule.description) ruleObj.label = sanitizeLabel(String(rule.description));
      return { use: this.addObject(ruleKey, ruleObj) };
    });
    const obj: Dict = { class: "Cipher_Group", allowCipherRules: ruleKeys };
    if (group.description) obj.label = sanitizeLabel(String(group.description));
    return this.addObject(key, obj);
  }

  renderTlsProfile(profile: Dict, kind: "server" | "client"): string {
    const key = sanitizeKey(String(profile.name));
    const obj: Dict = { class: kind === "server" ? "TLS_Server" : "TLS_Client" };

    const certs = (profile.certificates as Dict[] | undefined) ?? [];
    const certKeys = certs.map((c) => this.renderCertificate(c));
    if (kind === "server") {
      obj.certificates = certKeys.map((c) => ({ certificate: c }));
    } else if (certKeys.length > 0) {
      obj.clientCertificate = certKeys[0]; // AS3 TLS_Client takes one
    }

    const ciphers = profile.ciphers as string[] | undefined;
    if (ciphers?.length) obj.ciphers = ciphers.join(":");
    if (profile.cipher_group) {
      obj.cipherGroup = { use: this.renderCipherGroup(profile.cipher_group as Dict) };
    }

    // tls_versions arrive as labels via GraphQL ("TLSv1.1"…). Emit only the
    // flags that differ from AS3 defaults (1.0/1.1/1.2 on, 1.3 off).
    const versions = ((profile.tls_versions as unknown[] | undefined) ?? []).map(
      String
    );
    if (versions.length > 0) {
      const flags: [string, string, boolean][] = [
        ["TLSv1.0", "tls1_0Enabled", true],
        ["TLSv1.1", "tls1_1Enabled", true],
        ["TLSv1.2", "tls1_2Enabled", true],
        ["TLSv1.3", "tls1_3Enabled", false],
      ];
      for (const [label, prop, dflt] of flags) {
        const enabled = versions.includes(label);
        if (enabled !== dflt) obj[prop] = enabled;
      }
    }

    if (profile.mtls && profile.mtls !== "ignore")
      obj.authenticationMode = profile.mtls;
    if (profile.options && typeof profile.options === "object")
      this.spreadExtras(obj, profile.options, `SSL profile "${key}"`);
    return this.addObject(key, obj);
  }

  // NetBox's Policy.rules holds the COMPLETE AS3 object for the policy —
  // {class: "Endpoint_Policy", rules: [...], strategy} for standard policies
  // and {class: "iRule", iRule: "<tcl>"} for iRules — not a bare rules array.
  private policyRules(p: Dict): unknown[] | null {
    const r = p.rules;
    if (isPlainObject(r) && Array.isArray(r.rules)) return r.rules;
    return null;
  }

  private policyStrategy(p: Dict): string | undefined {
    const r = p.rules;
    return isPlainObject(r) && typeof r.strategy === "string"
      ? r.strategy
      : undefined;
  }

  // Canonical shape stores the Tcl in rules.iRule; older records used
  // rules.rules (f5_toolbox accepts both, so we do too).
  private iRuleSource(p: Dict): string | null {
    const r = p.rules;
    if (!isPlainObject(r)) return null;
    const source = typeof r.iRule === "string" ? r.iRule : r.rules;
    return typeof source === "string" && source.trim() !== "" ? source : null;
  }

  renderPolicies(vsKey: string, service: Dict, policies: Dict[]): void {
    const standard = policies.filter((p) => p.policy_type === "standard");
    const irules = policies.filter((p) => p.policy_type === "irule");

    if (standard.length === 1) {
      const p = standard[0];
      const rules = this.policyRules(p);
      if (!rules) {
        this.warn(
          `Policy "${p.name}": rules data is not in the expected AS3 shape ({rules: [...]}) — not rendered`
        );
      } else {
        const key = sanitizeKey(String(p.name));
        const obj: Dict = { class: "Endpoint_Policy", rules };
        const strategy = this.policyStrategy(p);
        if (strategy) obj.strategy = strategy;
        if (p.description) obj.label = sanitizeLabel(String(p.description));
        if (rules.length === 0)
          this.warn(`Policy "${p.name}" has no rules in NetBox`);
        service.policyEndpoint = { use: this.addObject(key, obj) };
      }
    } else if (standard.length > 1) {
      // BIG-IP rejects several forwarding policies on one virtual server, so
      // f5_toolbox merges same-virtual standard policies into one.
      const merged: unknown[] = [];
      const strategies = new Set<string>();
      for (const p of standard) {
        const rules = this.policyRules(p);
        if (!rules) {
          this.warn(
            `Policy "${p.name}": rules data is not in the expected AS3 shape — omitted from the merged policy`
          );
          continue;
        }
        merged.push(...rules);
        const strategy = this.policyStrategy(p);
        if (strategy) strategies.add(strategy);
      }
      const key = sanitizeKey(`${vsKey}-endpoint-policy`);
      const obj: Dict = {
        class: "Endpoint_Policy",
        rules: merged,
        label: sanitizeLabel(`Merged endpoint policies for ${vsKey}`),
      };
      if (strategies.size === 1) {
        obj.strategy = [...strategies][0];
      } else if (strategies.size > 1) {
        this.warn(
          `Virtual server "${vsKey}": merged policies disagree on strategy (${[...strategies].join(", ")}) — strategy omitted`
        );
      }
      if (merged.length === 0)
        this.warn(`Virtual server "${vsKey}": merged policy has no rules`);
      service.policyEndpoint = { use: this.addObject(key, obj) };
    }

    if (irules.length > 0) {
      const names: string[] = [];
      for (const p of irules) {
        const source = this.iRuleSource(p);
        if (source === null) {
          this.warn(
            `iRule policy "${p.name}" has no Tcl source (rules.iRule) — not rendered`
          );
          continue;
        }
        const key = sanitizeKey(String(p.name));
        this.addObject(key, { class: "iRule", iRule: { base64: toBase64(source) } });
        names.push(key);
      }
      if (names.length > 0) service.iRules = names;
    }
  }

  renderProtocolProfiles(service: Dict, profiles: Dict[]): void {
    for (const pp of profiles) {
      const options = (pp.options as Dict | null) ?? {};
      const cls = options.class as string | undefined;
      const rest: Dict = { ...options };
      delete rest.class;
      if (cls === "TCP_Profile" || cls === "HTTP_Profile") {
        const key = this.addObject(sanitizeKey(String(pp.name)), {
          class: cls,
          ...rest,
        });
        service[cls === "TCP_Profile" ? "profileTCP" : "profileHTTP"] = {
          use: key,
        };
      } else if (cls?.startsWith("Service_")) {
        this.spreadExtras(service, rest, `Protocol profile "${pp.name}"`);
      } else {
        this.warn(
          `Protocol profile "${pp.name}" has unsupported options.class "${cls}"; skipped`
        );
      }
    }
  }

  renderVirtualServer(vs: Dict): void {
    const vsKey = sanitizeKey(String(vs.name));
    const cls = SERVICE_CLASS[String(vs.protocol)];
    if (!cls) {
      this.warn(
        `Virtual server "${vsKey}": protocol "${vs.protocol}" not supported; skipped`
      );
      return;
    }
    const service: Dict = { class: cls };

    const vips = (vs.virtual_addresses as Dict[] | undefined) ?? [];
    if (vips.length > 0) {
      service.virtualAddresses = vips.map((vip, i) => {
        const addrKey = sanitizeKey(
          i === 0 ? `${vsKey}_service_address` : `${vsKey}_service_address_${i}`
        );
        this.addObject(addrKey, {
          class: "Service_Address",
          virtualAddress: vip.address,
          routeAdvertisement: "selective",
        });
        return { use: addrKey };
      });
    } else {
      this.warn(`Virtual server "${vsKey}" has no virtual addresses`);
    }

    if (vs.service_port != null) service.virtualPort = vs.service_port;
    if (vs.description) service.remark = sanitizeLabel(String(vs.description));
    if (vs.enabled === false) service.enable = false;
    if (vs.vs_type && vs.vs_type !== "standard") service.virtualType = vs.vs_type;

    const persistence = vs.persistence as string[] | undefined;
    if (persistence?.length) service.persistenceMethods = persistence;

    // Live GraphQL exposes a single backend_pool; the offline payload shape
    // (and older plugin versions) use a backend_pools list.
    const pools = (
      vs.backend_pool
        ? [vs.backend_pool]
        : ((vs.backend_pools as Dict[] | undefined) ?? [])
    ) as Dict[];
    if (pools.length > 0) {
      service.pool = this.renderPool(pools[0]);
      for (const extra of pools.slice(1)) {
        this.renderPool(extra); // still emitted for policy references
      }
    }
    if (vs.ssl_profile) {
      service.serverTLS = {
        use: this.renderTlsProfile(vs.ssl_profile as Dict, "server"),
      };
    }
    if (vs.server_ssl_profile) {
      service.clientTLS = {
        use: this.renderTlsProfile(vs.server_ssl_profile as Dict, "client"),
      };
    }
    if (vs.snat_pool) {
      service.snat = {
        bigip: `/Common/Shared/${(vs.snat_pool as Dict).name}`,
      };
    }

    this.renderPolicies(vsKey, service, (vs.policies as Dict[] | undefined) ?? []);
    this.renderProtocolProfiles(
      service,
      (vs.protocol_profiles as Dict[] | undefined) ?? []
    );
    this.spreadExtras(service, vs.extra_parameters, `Virtual server "${vsKey}"`);

    this.addObject(vsKey, service);
  }
}

// Structural keys can't be object names: they would rewrite the Application
// itself. The plugin rejects them at render time, and so do we.
const RESERVED_APP_KEYS = new Set(["class", "label", "remark", "constants"]);

export function renderNetboxApp(app: Dict): NetboxRenderResult {
  const r = new Renderer();
  const appKey = sanitizeKey(String(app.name));
  if (String(app.name).length > 64)
    r.warn(`Application name truncated to 64 characters: "${appKey}"`);

  for (const vs of (app.virtual_servers as Dict[] | undefined) ?? []) {
    r.renderVirtualServer(vs);
  }

  const application: Dict = { class: "Application" };
  if (app.description)
    application.label = sanitizeLabel(String(app.description));
  Object.assign(application, r.objects);

  // Application.extra_parameters holds COMPLETE top-level AS3 objects keyed
  // by name — the plugin's escape valve for classes it doesn't model
  // (Data_Group, standalone iRule, WAF/Analytics policy, …). Unlike the
  // pool/service/member extras, these are objects, not property fragments.
  const appExtras = app.extra_parameters;
  if (isPlainObject(appExtras)) {
    for (const [rawKey, value] of Object.entries(appExtras)) {
      const key = sanitizeKey(rawKey);
      if (RESERVED_APP_KEYS.has(rawKey)) {
        r.warn(
          `Application extra_parameters key "${rawKey}" is reserved — not added`
        );
        continue;
      }
      if (!isPlainObject(value) || typeof value.class !== "string") {
        r.warn(
          `Application extra_parameters "${rawKey}" is not a complete AS3 object (no class) — not added`
        );
        continue;
      }
      if (key in application) {
        r.warn(
          `Application extra_parameters "${rawKey}" collides with a generated object — the generated one is kept`
        );
        continue;
      }
      application[key] = value;
    }
  }

  const declaration: Dict = {
    id: `${app.id}-${app.name}`.slice(0, 255),
    schemaVersion: "3.55.0",
    [appKey]: application,
  };
  return { declaration, warnings: r.warnings };
}
