import { describe, expect, it } from "vitest";
import { renameInManifest, renameMember } from "../rename";
import { buildManifest, computeUpdates } from "../as3ToNetbox";
import { renderNetboxApp } from "../netboxAs3";

type Dict = Record<string, unknown>;

const declaration = (): Dict => ({
  id: "d1",
  schemaVersion: "3.55.0",
  myApp: {
    class: "Application",
    web: {
      class: "Service_HTTPS",
      virtualAddresses: [{ use: "web_vip" }],
      pool: "pool1",
      iRules: ["logger"],
      persistenceMethods: [{ use: "sess_persist" }],
    },
    web_vip: { class: "Service_Address", virtualAddress: "10.0.0.1" },
    pool1: {
      class: "Pool",
      monitors: [{ use: "mon1" }],
      members: [{ servicePort: 80, serverAddresses: ["10.0.1.10"] }],
    },
    mon1: { class: "Monitor", monitorType: "http" },
    logger: { class: "iRule", iRule: "when HTTP_REQUEST { log local0. x }" },
    sess: { class: "iRule", iRule: "when HTTP_REQUEST { persist uie 1 }" },
    sess_persist: {
      class: "Persist",
      persistenceMethod: "universal",
      iRule: "sess",
    },
  },
});

describe("renameMember", () => {
  it("renames a member and rewrites every reference shape", () => {
    const d = declaration();
    const r1 = renameMember(d, ["myApp", "pool1"], "poolWeb");
    if ("error" in r1) throw new Error(r1.error);
    const app1 = r1.declaration.myApp as Dict;
    expect(app1.poolWeb).toBeDefined();
    expect(app1.pool1).toBeUndefined();
    expect((app1.web as Dict).pool).toBe("poolWeb");
    expect(r1.refsRewritten).toBe(1);

    const r2 = renameMember(r1.declaration, ["myApp", "sess"], "sessionRule");
    if ("error" in r2) throw new Error(r2.error);
    const app2 = r2.declaration.myApp as Dict;
    expect((app2.sess_persist as Dict).iRule).toBe("sessionRule");

    const r3 = renameMember(r2.declaration, ["myApp", "logger"], "logRule");
    if ("error" in r3) throw new Error(r3.error);
    const app3 = r3.declaration.myApp as Dict;
    expect((app3.web as Dict).iRules).toEqual(["logRule"]);

    const r4 = renameMember(r3.declaration, ["myApp", "web_vip"], "vip1");
    if ("error" in r4) throw new Error(r4.error);
    const app4 = r4.declaration.myApp as Dict;
    expect((app4.web as Dict).virtualAddresses).toEqual([{ use: "vip1" }]);
  });

  it("keeps member order", () => {
    const d = declaration();
    const r = renameMember(d, ["myApp", "pool1"], "poolWeb");
    if ("error" in r) throw new Error(r.error);
    expect(Object.keys(r.declaration.myApp as Dict)).toEqual([
      "class",
      "web",
      "web_vip",
      "poolWeb",
      "mon1",
      "logger",
      "sess",
      "sess_persist",
    ]);
  });

  it("renames the application itself", () => {
    const r = renameMember(declaration(), ["myApp"], "storefront");
    if ("error" in r) throw new Error(r.error);
    expect(Object.keys(r.declaration)).toEqual([
      "id",
      "schemaVersion",
      "storefront",
    ]);
  });

  it("refuses collisions and bad grammar", () => {
    const d = declaration();
    expect(renameMember(d, ["myApp", "pool1"], "web")).toMatchObject({
      error: expect.stringContaining("already exists"),
    });
    expect(renameMember(d, ["myApp", "pool1"], "9bad name")).toMatchObject({
      error: expect.stringContaining("letters"),
    });
    expect(renameMember(d, ["myApp", "nope"], "x")).toMatchObject({
      error: expect.stringContaining("not a member"),
    });
  });
});

describe("rename with NetBox provenance", () => {
  it("pushes as a NetBox name change, never delete + create", () => {
    const graph = {
      id: "77",
      name: "app77",
      virtual_servers: [
        {
          id: 7,
          name: "vs-old",
          protocol: "https",
          service_port: 443,
          cluster: { id: 4, name: "c1" },
          virtual_addresses: [{ id: 1, address: "10.0.0.5/32" }],
          backend_pool: {
            id: 8,
            name: "pool-old",
            members: [],
          },
        },
      ],
    };
    const { declaration: decl } = renderNetboxApp(graph);
    const manifest = buildManifest(graph, decl);

    const r = renameMember(
      decl as Dict,
      ["app77", "pool-old"],
      "pool-new"
    );
    if ("error" in r) throw new Error(r.error);
    renameInManifest(manifest, "pool-old", "pool-new");

    const { updates, creates, deletes } = computeUpdates(r.declaration, manifest);
    expect(creates).toEqual([]);
    expect(deletes).toEqual([]);
    const poolUpdate = updates.find((u) => u.entry.endpoint === "backend-pools");
    expect(poolUpdate?.changes).toEqual([
      { field: "name", from: "pool-old", to: "pool-new" },
    ]);
    // The virtual server's stored ref name followed the rename: no vs-ref op.
    const vsUpdate = updates.find((u) => u.entry.endpoint === "virtual-servers");
    expect(vsUpdate ?? { ops: [] }).toMatchObject({ ops: [] });
  });
});
