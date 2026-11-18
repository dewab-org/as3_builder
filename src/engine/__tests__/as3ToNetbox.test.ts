import { describe, expect, it } from "vitest";
import goldenInput from "./fixtures/netbox-golden-input.json";
import { renderNetboxApp } from "../netboxAs3";
import {
  buildManifest,
  computeUpdates,
  findApplicationKey,
  newAppManifest,
} from "../as3ToNetbox";

type Dict = Record<string, unknown>;

const app = (
  (goldenInput as { data: { application_list: Dict[] } }).data.application_list
)[0];
const appName = "fixture-lb_vserver_ssl-10_0_0_2-sample-bigip-a_01-1321c639";

function freshRender() {
  const { declaration } = renderNetboxApp(app);
  const manifest = buildManifest(app, declaration);
  // deep copy so tests can mutate the declaration independently
  return {
    declaration: JSON.parse(JSON.stringify(declaration)) as Dict,
    manifest,
  };
}

describe("write-back manifest", () => {
  it("records provenance for every W1-writable object", () => {
    const { manifest } = freshRender();
    const byKey = Object.fromEntries(manifest.entries.map((e) => [e.as3Key, e]));
    expect(byKey.vs_ssl_app.endpoint).toBe("virtual-servers");
    expect(byKey.vs_ssl_app.id).toBe(19);
    expect(byKey.sg_web.endpoint).toBe("backend-pools");
    expect(byKey.ssl_vs_ssl_app.endpoint).toBe("ssl-profiles");
    expect(byKey.ssl_vs_ssl_app.className).toBe("TLS_Server");
  });
});

describe("net-new application push", () => {
  const declaration = {
    id: "my-decl",
    schemaVersion: "3.55.0",
    newApp: {
      class: "Application",
      label: "Hand-authored app",
      web: {
        class: "Service_HTTP",
        virtualAddresses: ["10.9.0.1"],
        virtualPort: 80,
        pool: "webPool",
      },
      webPool: {
        class: "Pool",
        members: [{ servicePort: 8080, serverAddresses: ["10.9.0.10"] }],
      },
    },
  } as Record<string, unknown>;

  it("finds the Application member of a declaration", () => {
    expect(findApplicationKey(declaration)).toBe("newApp");
    expect(findApplicationKey({ id: "x", schemaVersion: "3.55.0" })).toBeNull();
  });

  it("bootstraps a manifest whose changeset creates everything", () => {
    const m = newAppManifest(
      declaration,
      "newApp",
      { id: 42, name: "newApp", description: "Hand-authored app" },
      7
    );
    expect(m.appId).toBe(42);
    expect(m.createClusterId).toBe(7);
    const { updates, creates, deletes, notes } = computeUpdates(
      JSON.parse(JSON.stringify(declaration)),
      m
    );
    expect(deletes).toEqual([]);
    expect(notes).toEqual([]);
    // Label matches the created description — no application update.
    expect(updates).toEqual([]);
    expect(creates.map((c) => [c.endpoint, c.as3Key])).toEqual([
      ["backend-pools", "webPool"],
      ["virtual-servers", "web"],
    ]);
    const vs = creates.find((c) => c.endpoint === "virtual-servers");
    expect(vs?.fields.cluster).toBe(7);
    expect(vs?.vipAddresses).toEqual(["10.9.0.1/32"]);
  });
});

describe("write-back changeset (W1)", () => {
  it("round-trips to an EMPTY changeset when nothing was edited", () => {
    const { declaration, manifest } = freshRender();
    const { updates, creates, deletes, notes } = computeUpdates(
      declaration,
      manifest
    );
    expect(updates).toEqual([]);
    expect(creates).toEqual([]);
    expect(deletes).toEqual([]);
    expect(notes).toEqual([]);
  });

  it("detects a service port change", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).virtualPort = 8443;
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].entry.endpoint).toBe("virtual-servers");
    expect(updates[0].changes).toEqual([
      { field: "service_port", from: 443, to: 8443 },
    ]);
  });

  it("detects LB mode + persistence changes on the right objects", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.sg_web as Dict).loadBalancingMode = "round-robin";
    (appObj.vs_ssl_app as Dict).persistenceMethods = ["source-address"];
    const { updates } = computeUpdates(declaration, manifest);
    const byEndpoint = Object.fromEntries(
      updates.map((u) => [u.entry.endpoint, u])
    );
    expect(byEndpoint["backend-pools"].changes).toEqual([
      {
        field: "load_balancing_algorithm",
        from: "least-connections-member",
        to: "round-robin",
      },
    ]);
    expect(byEndpoint["virtual-servers"].changes).toEqual([
      { field: "persistence", from: ["cookie"], to: ["source-address"] },
    ]);
  });

  it("inverts TLS flags to tls_versions ints and mtls", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    const tls = appObj.ssl_vs_ssl_app as Dict;
    tls.tls1_1Enabled = false; // was on (fixture allows 1.1+1.2)
    tls.authenticationMode = "require";
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    const fields = Object.fromEntries(
      updates[0].changes.map((c) => [c.field, c.to])
    );
    expect(fields.tls_versions).toEqual([2]);
    expect(fields.mtls).toBe("require");
  });

  it("turns removals into delete rows and additions into create rows", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    delete appObj.sg_web;
    appObj.newPool = {
      class: "Pool",
      members: [{ servicePort: 8080, serverAddresses: ["10.9.9.1"] }],
    };
    (appObj.vs_ssl_app as Dict).class = "Service_HTTP";
    const { updates, creates, deletes, notes } = computeUpdates(
      declaration,
      manifest
    );
    expect(updates).toEqual([]);
    expect(deletes).toMatchObject([{ entry: { as3Key: "sg_web" } }]);
    expect(creates).toMatchObject([
      {
        as3Key: "newPool",
        endpoint: "backend-pools",
        fields: { name: "newPool", load_balancing_algorithm: "round-robin" },
        members: [{ addressWithMask: "10.9.9.1/32", servicePort: 8080 }],
      },
    ]);
    expect(
      notes.some((n) => n.includes("vs_ssl_app") && n.includes("class"))
    ).toBe(true);
  });

  it("builds full service create specs with refs, cluster, and vips", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    appObj.newVip = {
      class: "Service_Address",
      virtualAddress: "10.7.7.7/32",
    };
    appObj.newWeb = {
      class: "Service_HTTP",
      virtualAddresses: [{ use: "newVip" }],
      pool: "sg_web",
    };
    const { creates, notes } = computeUpdates(declaration, manifest);
    expect(creates).toMatchObject([
      {
        as3Key: "newWeb",
        endpoint: "virtual-servers",
        fields: {
          name: "newWeb",
          cluster: 77, // required since plugin 0.9.0 (G1)
          protocol: "http",
          service_port: 80, // AS3 default for http
          vs_type: "standard",
        },
        refs: [{ field: "backend_pool", targetKey: "sg_web" }],
        vipAddresses: ["10.7.7.7/32"],
      },
    ]);
    // slug is derived and read-only since plugin 0.9.0 (G1)
    expect(creates[0].fields).not.toHaveProperty("slug");
    expect(notes).toEqual([]);
  });

  it("records the create cluster from the loaded virtual servers", () => {
    const { manifest } = freshRender();
    expect(manifest.createClusterId).toBe(77);
  });

  it("refuses a service create when no cluster could be determined", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    appObj.newWeb = {
      class: "Service_HTTP",
      virtualAddresses: ["10.7.7.7"],
      virtualPort: 80,
    };
    const { creates, notes } = computeUpdates(declaration, {
      ...manifest,
      createClusterId: null,
    });
    expect(creates).toEqual([]);
    expect(notes.some((n) => n.includes("cluster"))).toBe(true);
  });

  it("collapses Persist pointers back to the NetBox universal method", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).persistenceMethods = [
      { use: "session_persist" },
      "source-address",
    ];
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].changes).toEqual([
      { field: "persistence", from: ["cookie"], to: ["source-address", "universal"] },
    ]);
  });

  it("round-trips a spread Service_* protocol profile without a detach op", () => {
    // A Service_*-class protocol profile has no per-VS pointer (its options
    // are spread into the service), so an untouched declaration must not
    // produce a "detach all protocol profiles" op.
    const graph = {
      id: "900",
      name: "app900",
      virtual_servers: [
        {
          id: 90,
          name: "vs-udp",
          protocol: "udp",
          service_port: 111,
          virtual_addresses: [{ id: 1, address: "10.0.0.40/32" }],
          protocol_profiles: [
            {
              id: 5,
              name: "udp-idle",
              options: { class: "Service_UDP", idleTimeout: 180 },
            },
          ],
        },
      ],
    };
    const { declaration } = renderNetboxApp(graph);
    const manifest = buildManifest(graph, declaration);
    const { updates, notes } = computeUpdates(
      JSON.parse(JSON.stringify(declaration)),
      manifest
    );
    expect(notes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("round-trips a persistence iRule policy without a detach op", () => {
    const graph = {
      id: "901",
      name: "app901",
      virtual_servers: [
        {
          id: 91,
          name: "vs-https",
          protocol: "https",
          service_port: 443,
          persistence: ["universal"],
          virtual_addresses: [{ id: 2, address: "10.0.0.41/32" }],
          policies: [
            {
              id: 6,
              name: "session-pol",
              policy_type: "irule",
              is_persistence: true,
              rules: {
                class: "iRule",
                iRule: "when HTTP_REQUEST { persist uie 1 }",
                isPersistenceMethod: true,
              },
            },
          ],
        },
      ],
    };
    const { declaration } = renderNetboxApp(graph);
    const manifest = buildManifest(graph, declaration);
    const { updates, notes } = computeUpdates(
      JSON.parse(JSON.stringify(declaration)),
      manifest
    );
    expect(notes).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("stores TLSv1.0 as version 0 instead of dropping it", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.ssl_vs_ssl_app as Dict).tls1_0Enabled = true;
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    const fields = Object.fromEntries(
      updates[0].changes.map((c) => [c.field, c.to])
    );
    expect(fields.tls_versions).toEqual([0, 1, 2]);
    expect(notes).toEqual([]);
  });

  it("orders creates and deletes FK-safely", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    // create a service + a pool + a monitor
    appObj.zNewVs = {
      class: "Service_HTTP",
      virtualAddresses: ["10.7.7.8"],
      virtualPort: 80,
    };
    appObj.aNewPool = { class: "Pool" };
    appObj.mNewMon = { class: "Monitor", monitorType: "http" };
    // delete the existing pool and vs
    delete appObj.sg_web;
    delete appObj.vs_ssl_app;
    const { creates, deletes } = computeUpdates(declaration, manifest);
    expect(creates.map((c) => c.endpoint)).toEqual([
      "monitors",
      "backend-pools",
      "virtual-servers",
    ]);
    expect(deletes.map((d) => d.entry.endpoint)).toEqual([
      "virtual-servers",
      "backend-pools",
    ]);
  });

  it("W4: rewiring a service's TLS profile produces a vs-ref op", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).serverTLS = { use: "otherTls" };
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].ops).toMatchObject([
      { op: "vs-ref", field: "ssl_profile", targetKey: "otherTls" },
    ]);
  });

  it("W4: removing the pool reference clears backend_pool", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    delete (appObj.vs_ssl_app as Dict).pool;
    const { updates } = computeUpdates(declaration, manifest);
    const refOps = updates.flatMap((u) =>
      u.ops.filter((o) => o.op === "vs-ref")
    );
    expect(refOps).toMatchObject([
      { field: "backend_pool", targetKey: null },
    ]);
  });

  it("W4: changing the pool monitor list produces a pool-monitors op", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.sg_web as Dict).monitors = [{ use: "newMonitor" }];
    const { updates } = computeUpdates(declaration, manifest);
    const monOps = updates.flatMap((u) =>
      u.ops.filter((o) => o.op === "pool-monitors")
    );
    expect(monOps).toMatchObject([{ keys: ["newMonitor"] }]);
  });

  it("W4: unknown scalar props become extra_parameters", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.sg_web as Dict).slowRampTime = 20;
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].changes).toEqual([
      { field: "extra_parameters", from: null, to: { slowRampTime: 20 } },
    ]);
    expect(notes).toEqual([]);
  });

  it("W4: app label edits map to the application description", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    appObj.label = "renamed application";
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toMatchObject([
      {
        entry: { endpoint: "applications", isApplication: true },
        changes: [{ field: "description", to: "renamed application" }],
      },
    ]);
  });

  it("W5: a snat pointer edit relinks the virtual server", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).snat = { bigip: "/Common/Shared/other" };
    const { updates } = computeUpdates(declaration, manifest);
    const vsChange = updates.find(
      (u) => u.entry.endpoint === "virtual-servers"
    );
    // SNAT pools are pre-created estate objects: the push relinks, it never
    // creates, and it is no longer reported as out of scope.
    expect(vsChange?.ops).toContainEqual({
      op: "vs-snat",
      poolName: "other",
      label: 'point snat at pool "other"',
    });
    expect(vsChange?.outOfScope).toBe(false);
  });

  it("W5: a bigip pointer has no NetBox row, so the link is left alone", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).profileTCP = { bigip: "/Common/tcp-lan" };
    const { updates, notes } = computeUpdates(declaration, manifest);
    const ops = updates.flatMap((u) => u.ops);
    expect(ops.filter((o) => o.op === "vs-links")).toEqual([]);
    expect(
      notes.some((n) => n.includes("not a NetBox object of its own"))
    ).toBe(true);
  });

  it("TLS profile creates require certificates", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    appObj.newTls = { class: "TLS_Server", certificates: [] };
    const { creates, notes } = computeUpdates(declaration, manifest);
    expect(creates).toEqual([]);
    expect(notes.some((n) => n.includes("newTls") && n.includes("certificates"))).toBe(
      true
    );
  });

  it("turns a member port change into delete+create ops", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    const pool = appObj.sg_web as Dict;
    (pool.members as Dict[])[0].servicePort = 8080;
    const { updates } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].changes).toEqual([]);
    const kinds = updates[0].ops.map((o) => o.op).sort();
    // two addresses move from :443 to :8080 → 2 creates + 2 deletes
    expect(kinds).toEqual([
      "member-create",
      "member-create",
      "member-delete",
      "member-delete",
    ]);
  });

  it("adds/removes/updates individual members", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    const pool = appObj.sg_web as Dict;
    const group = (pool.members as Dict[])[0];
    // remove .21, add .30, and disable the whole group (state change on .20)
    group.serverAddresses = ["192.168.1.20", "192.168.1.30"];
    group.adminState = "disable";
    const { updates } = computeUpdates(declaration, manifest);
    const ops = updates[0].ops;
    const byOp = (k: string) => ops.filter((o) => o.op === k);
    expect(byOp("member-create")).toMatchObject([
      { addressWithMask: "192.168.1.30/32", body: { service_port: 443, enabled: false } },
    ]);
    expect(byOp("member-delete")).toHaveLength(1);
    expect(byOp("member-update")).toMatchObject([
      { body: { enabled: false } },
    ]);
  });

  it("turns a Service_Address edit into a vs-addresses op", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app_service_address as Dict).virtualAddress = "10.0.0.9/32";
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toHaveLength(1);
    expect(updates[0].entry.endpoint).toBe("virtual-servers");
    expect(updates[0].ops).toMatchObject([
      {
        op: "vs-addresses",
        addresses: ["10.0.0.9/32"],
        adds: ["10.0.0.9/32"],
        removes: ["10.0.0.2/32"],
      },
    ]);
    expect(notes).toEqual([]);
  });

  it("bigip virtual addresses are not pushable", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    (appObj.vs_ssl_app as Dict).virtualAddresses = [
      { bigip: "/Common/existing-vip" },
    ];
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates.every((u) => u.ops.length === 0)).toBe(true);
    expect(notes.some((n) => n.includes("not pushable"))).toBe(true);
  });
});
