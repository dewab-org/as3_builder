import { describe, expect, it } from "vitest";
import { renderNetboxApp } from "../netboxAs3";
import { buildManifest, computeUpdates } from "../as3ToNetbox";
import { encodeBase64 } from "../base64";

type Dict = Record<string, unknown>;

const TCL = "when HTTP_REQUEST {\n  HTTP::redirect https://[HTTP::host]\n}";

/** A minimal application graph carrying one of each relation object. */
function netboxApp(overrides: Dict = {}): Dict {
  return {
    id: 1,
    name: "relations-app",
    description: "",
    last_updated: "2026-01-01T00:00:00+00:00",
    virtual_servers: [
      {
        id: 10,
        name: "vs_rel",
        protocol: "https",
        service_port: 443,
        enabled: true,
        vs_type: "standard",
        virtual_addresses: [{ id: 90, address: "10.0.0.9/32" }],
        last_updated: "2026-01-01T00:00:00+00:00",
        policies: [
          {
            id: 20,
            name: "pol_forward",
            policy_type: "standard",
            description: "forwarding",
            last_updated: "2026-01-01T00:00:00+00:00",
            rules: {
              class: "Endpoint_Policy",
              strategy: "first-match",
              rules: [{ name: "r1", conditions: [], actions: [] }],
            },
          },
          {
            id: 21,
            name: "irule_redirect",
            policy_type: "irule",
            description: "redirect",
            last_updated: "2026-01-01T00:00:00+00:00",
            rules: { class: "iRule", iRule: TCL },
          },
        ],
        protocol_profiles: [
          {
            id: 30,
            name: "tcp_lan",
            protocol_type: "tcp",
            last_updated: "2026-01-01T00:00:00+00:00",
            options: { class: "TCP_Profile", idleTimeout: 300 },
          },
        ],
        ssl_profile: {
          id: 40,
          name: "ssl_vs_rel",
          profile_type: "client",
          last_updated: "2026-01-01T00:00:00+00:00",
          tls_versions: ["TLSv1.2"],
          ciphers: [],
          certificates: [],
          cipher_group: {
            id: 50,
            name: "cg_strong",
            description: "strong suites",
            last_updated: "2026-01-01T00:00:00+00:00",
            cipher_rules: [
              {
                id: 60,
                name: "cr_ecdhe",
                priority: 1,
                description: "ecdhe only",
                ciphers: ["ECDHE-RSA-AES128-GCM-SHA256"],
                dh_groups: ["P-256"],
                signature_algorithms: [],
                last_updated: "2026-01-01T00:00:00+00:00",
              },
            ],
          },
        },
        ...overrides,
      },
    ],
  };
}

function fresh(app: Dict = netboxApp()) {
  const { declaration } = renderNetboxApp(app);
  const manifest = buildManifest(app, declaration);
  return {
    declaration: JSON.parse(JSON.stringify(declaration)) as Dict,
    manifest,
    appKey: manifest.appKey,
  };
}

describe("relation objects: manifest", () => {
  it("records provenance for policies, profiles and cipher objects", () => {
    const { manifest } = fresh();
    const byKey = Object.fromEntries(manifest.entries.map((e) => [e.as3Key, e]));

    expect(byKey.pol_forward).toMatchObject({
      endpoint: "policies",
      id: 20,
      className: "Endpoint_Policy",
    });
    expect(byKey.irule_redirect).toMatchObject({
      endpoint: "policies",
      id: 21,
      className: "iRule",
    });
    expect(byKey.tcp_lan).toMatchObject({
      endpoint: "protocol-profiles",
      id: 30,
      className: "TCP_Profile",
    });
    expect(byKey.cg_strong).toMatchObject({
      endpoint: "cipher-groups",
      id: 50,
    });
    expect(byKey.cr_ecdhe).toMatchObject({
      endpoint: "cipher-rules",
      id: 60,
    });
  });

  it("leaves a merged multi-policy object unmanifested", () => {
    const app = netboxApp();
    const vs = (app.virtual_servers as Dict[])[0];
    (vs.policies as Dict[]).push({
      id: 22,
      name: "pol_second",
      policy_type: "standard",
      rules: { class: "Endpoint_Policy", rules: [{ name: "r2" }] },
    });
    const { manifest } = fresh(app);
    const keys = manifest.entries.map((e) => e.as3Key);
    expect(keys).not.toContain("pol_forward");
    expect(keys).not.toContain("pol_second");
    expect(Object.keys(manifest.artifacts)).toContain("vs_rel-endpoint-policy");
  });
});

describe("relation objects: changeset", () => {
  it("round-trips to an empty changeset when nothing was edited", () => {
    const { declaration, manifest } = fresh();
    const { updates, creates, deletes } = computeUpdates(declaration, manifest);
    expect(updates).toEqual([]);
    expect(creates).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("pushes an edited iRule as decoded Tcl", () => {
    const { declaration, manifest, appKey } = fresh();
    const app = declaration[appKey] as Dict;
    const edited = `${TCL}\n# tuned`;
    (app.irule_redirect as Dict).iRule = { base64: encodeBase64(edited) };

    const { updates } = computeUpdates(declaration, manifest);
    const change = updates.find((u) => u.entry.as3Key === "irule_redirect");
    expect(change?.entry.endpoint).toBe("policies");
    // The whole AS3 wrapper is written, not the bare script: NetBox's
    // Policy.rules holds the complete object and the renderer reads it back
    // through rules.iRule.
    expect(change?.changes).toEqual([
      {
        field: "rules",
        from: { class: "iRule", iRule: TCL },
        to: { class: "iRule", iRule: edited },
      },
    ]);
  });

  it("pushes edited endpoint-policy rules and strategy", () => {
    const { declaration, manifest, appKey } = fresh();
    const policy = (declaration[appKey] as Dict).pol_forward as Dict;
    policy.rules = [{ name: "r1", conditions: [], actions: [] }, { name: "r2" }];
    policy.strategy = "best-match";

    const { updates } = computeUpdates(declaration, manifest);
    const change = updates.find((u) => u.entry.as3Key === "pol_forward");
    // strategy lives inside the rules JSON, not in a column of its own.
    expect(change?.changes).toEqual([
      {
        field: "rules",
        from: {
          class: "Endpoint_Policy",
          strategy: "first-match",
          rules: [{ name: "r1", conditions: [], actions: [] }],
        },
        to: {
          class: "Endpoint_Policy",
          strategy: "best-match",
          rules: [{ name: "r1", conditions: [], actions: [] }, { name: "r2" }],
        },
      },
    ]);
  });

  it("pushes a protocol profile as a complete AS3 object in options", () => {
    const { declaration, manifest, appKey } = fresh();
    (declaration[appKey] as Dict).tcp_lan = {
      class: "TCP_Profile",
      idleTimeout: 600,
    };
    const { updates } = computeUpdates(declaration, manifest);
    const change = updates.find((u) => u.entry.as3Key === "tcp_lan");
    expect(change?.changes).toEqual([
      {
        field: "options",
        from: { class: "TCP_Profile", idleTimeout: 300 },
        to: { class: "TCP_Profile", idleTimeout: 600 },
      },
    ]);
  });

  it("maps cipher rule and group fields to their NetBox columns", () => {
    const { declaration, manifest, appKey } = fresh();
    const app = declaration[appKey] as Dict;
    const rule = app.cr_ecdhe as Dict;
    rule.cipherSuites = ["ECDHE-RSA-AES256-GCM-SHA384"];
    rule.namedGroups = ["P-384"];
    rule.label = "p384 only";
    (app.cg_strong as Dict).label = "stronger suites";

    const { updates } = computeUpdates(declaration, manifest);
    const ruleFields = Object.fromEntries(
      (updates.find((u) => u.entry.as3Key === "cr_ecdhe")?.changes ?? []).map(
        (c) => [c.field, c.to]
      )
    );
    expect(ruleFields).toEqual({
      ciphers: ["ECDHE-RSA-AES256-GCM-SHA384"],
      dh_groups: ["P-384"],
      description: "p384 only",
    });
    const groupChange = updates.find((u) => u.entry.as3Key === "cg_strong");
    expect(groupChange?.changes).toEqual([
      { field: "description", from: "strong suites", to: "stronger suites" },
    ]);
  });

  it("explains why a merged policy cannot be pushed", () => {
    const app = netboxApp();
    (app.virtual_servers as Dict[])[0].policies = [
      {
        id: 20,
        name: "pol_a",
        policy_type: "standard",
        rules: { class: "Endpoint_Policy", rules: [{ name: "a" }] },
      },
      {
        id: 22,
        name: "pol_b",
        policy_type: "standard",
        rules: { class: "Endpoint_Policy", rules: [{ name: "b" }] },
      },
    ];
    const { declaration, manifest, appKey } = fresh(app);
    const merged = (declaration[appKey] as Dict)["vs_rel-endpoint-policy"] as Dict;
    merged.rules = [{ name: "a" }];

    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toEqual([]);
    expect(notes.join(" ")).toMatch(/merged view of several NetBox policies/);
  });

  it("reads a legacy iRule record without reporting a phantom edit", () => {
    const app = netboxApp();
    const policies = (app.virtual_servers as Dict[])[0].policies as Dict[];
    policies[1].rules = { class: "iRule", rules: TCL }; // pre-canonical shape
    const { declaration, manifest } = fresh(app);
    expect(computeUpdates(declaration, manifest).updates).toEqual([]);
  });

  it("keeps a legacy iRule record in its own shape when pushing an edit", () => {
    const app = netboxApp();
    const policies = (app.virtual_servers as Dict[])[0].policies as Dict[];
    policies[1].rules = { class: "iRule", rules: TCL };
    const { declaration, manifest, appKey } = fresh(app);
    const edited = `${TCL}\n# tuned`;
    ((declaration[appKey] as Dict).irule_redirect as Dict).iRule = {
      base64: encodeBase64(edited),
    };
    const change = computeUpdates(declaration, manifest).updates.find(
      (u) => u.entry.as3Key === "irule_redirect"
    );
    // Written back through rules.rules — pushing an edit must not silently
    // migrate the record to the canonical key.
    expect(change?.changes[0].to).toEqual({ class: "iRule", rules: edited });
  });
});
