import { describe, expect, it } from "vitest";
import goldenInput from "./fixtures/netbox-golden-input.json";
import { renderNetboxApp } from "../netboxAs3";
import { buildManifest, computeUpdates } from "../as3ToNetbox";

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

describe("write-back changeset (W1)", () => {
  it("round-trips to an EMPTY changeset when nothing was edited", () => {
    const { declaration, manifest } = freshRender();
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toEqual([]);
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

  it("flags deletions/creations/class changes as notes, not updates", () => {
    const { declaration, manifest } = freshRender();
    const appObj = declaration[appName] as Dict;
    delete appObj.sg_web;
    appObj.newPool = { class: "Pool", members: [] };
    (appObj.vs_ssl_app as Dict).class = "Service_HTTP";
    const { updates, notes } = computeUpdates(declaration, manifest);
    expect(updates).toEqual([]);
    expect(notes.some((n) => n.includes("sg_web") && n.includes("W3"))).toBe(true);
    expect(notes.some((n) => n.includes("newPool"))).toBe(true);
    expect(
      notes.some((n) => n.includes("vs_ssl_app") && n.includes("class"))
    ).toBe(true);
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
