import { describe, expect, it } from "vitest";
import {
  canRename,
  referencePathsTo,
  renameInManifest,
  renameMember,
} from "../rename";
import { buildManifest, computeUpdates, newAppManifest } from "../as3ToNetbox";
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

/** Apply deletions in the order given, as the editor does. */
function deleteAll(doc: Dict, paths: (string | number)[][]): Dict {
  const clone = JSON.parse(JSON.stringify(doc)) as Dict;
  for (const path of paths) {
    let parent: unknown = clone;
    for (const seg of path.slice(0, -1)) parent = (parent as Dict)[seg as string];
    const last = path[path.length - 1];
    if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete (parent as Dict)[last as string];
  }
  return clone;
}

describe("referencePathsTo (delete clears references)", () => {
  it("finds a string pointer property", () => {
    expect(referencePathsTo(declaration(), ["myApp", "pool1"])).toEqual([
      ["myApp", "web", "pool"],
    ]);
  });

  it("finds list entries and {use} pointers", () => {
    const d = declaration();
    expect(referencePathsTo(d, ["myApp", "logger"])).toEqual([
      ["myApp", "web", "iRules", 0],
    ]);
    expect(referencePathsTo(d, ["myApp", "mon1"])).toEqual([
      ["myApp", "pool1", "monitors", 0],
    ]);
    expect(referencePathsTo(d, ["myApp", "web_vip"])).toEqual([
      ["myApp", "web", "virtualAddresses", 0],
    ]);
    expect(referencePathsTo(d, ["myApp", "sess_persist"])).toEqual([
      ["myApp", "web", "persistenceMethods", 0],
    ]);
  });

  it("finds a Persist profile's iRule", () => {
    expect(referencePathsTo(declaration(), ["myApp", "sess"])).toEqual([
      ["myApp", "sess_persist", "iRule"],
    ]);
  });

  it("removes a whole certificates entry, not just its pointer", () => {
    const d = {
      app: {
        class: "Application",
        tls: {
          class: "TLS_Server",
          certificates: [
            { certificate: "keep" },
            { certificate: "gone", matchToSNI: "x.example.com" },
          ],
        },
        keep: { class: "Certificate" },
        gone: { class: "Certificate" },
      },
    };
    expect(referencePathsTo(d, ["app", "gone"])).toEqual([
      ["app", "tls", "certificates", 1],
    ]);
  });

  it("orders deletions so earlier list indexes stay valid", () => {
    const d = declaration();
    ((d.myApp as Dict).web as Dict).iRules = ["logger", "other", "logger"];
    const paths = referencePathsTo(d, ["myApp", "logger"]);
    expect(paths).toEqual([
      ["myApp", "web", "iRules", 2],
      ["myApp", "web", "iRules", 0],
    ]);
    const after = deleteAll(d, [...paths, ["myApp", "logger"]]);
    expect(((after.myApp as Dict).web as Dict).iRules).toEqual(["other"]);
  });

  it("ignores names that only look like the key elsewhere", () => {
    const d = declaration();
    // A label or remark that happens to equal the key is not a pointer.
    ((d.myApp as Dict).web as Dict).remark = "pool1";
    expect(referencePathsTo(d, ["myApp", "pool1"])).toEqual([
      ["myApp", "web", "pool"],
    ]);
  });

  it("has nothing to clear for the application or nested paths", () => {
    const d = declaration();
    expect(referencePathsTo(d, ["myApp"])).toEqual([]);
    expect(referencePathsTo(d, ["myApp", "web", "pool"])).toEqual([]);
  });

  it("pushes as unlink-then-delete, with nothing left dangling", () => {
    const graph = {
      id: "78",
      name: "app78",
      virtual_servers: [
        {
          id: 9,
          name: "vs1",
          protocol: "https",
          service_port: 443,
          cluster: { id: 4, name: "c1" },
          virtual_addresses: [{ id: 1, address: "10.0.0.6/32" }],
          backend_pool: { id: 10, name: "p1", members: [] },
        },
      ],
    };
    const { declaration: decl } = renderNetboxApp(graph);
    const manifest = buildManifest(graph, decl);
    const paths = referencePathsTo(decl as Dict, ["app78", "p1"]);
    const after = deleteAll(decl as Dict, [...paths, ["app78", "p1"]]);
    const { updates, deletes, notes } = computeUpdates(after, manifest);
    expect(notes).toEqual([]);
    expect(deletes.map((d) => d.entry.as3Key)).toEqual(["p1"]);
    const vs = updates.find((u) => u.entry.endpoint === "virtual-servers");
    expect(vs?.ops).toMatchObject([
      { op: "vs-ref", field: "backend_pool", targetKey: null },
    ]);
  });
});

describe("review fixes: rename and reference scope", () => {
  it("removes a policy action whose select points at the deleted pool", () => {
    const d = {
      app: {
        class: "Application",
        pol: {
          class: "Endpoint_Policy",
          rules: [
            {
              name: "r1",
              actions: [
                { type: "forward", select: { pool: { use: "gone" } } },
                { type: "httpHeader", insert: { name: "x", value: "y" } },
              ],
            },
          ],
        },
        gone: { class: "Pool" },
      },
    };
    expect(referencePathsTo(d, ["app", "gone"])).toEqual([
      ["app", "pol", "rules", 0, "actions", 0],
    ]);
  });

  it("does not scan non-application objects", () => {
    const d = { controls: { class: "Controls", trace: true, logLevel: "debug" } };
    expect(referencePathsTo(d, ["controls", "trace"])).toEqual([]);
  });

  it("only renames applications and their members", () => {
    expect(canRename(["myApp"], { class: "Application" })).toBe(true);
    expect(canRename(["controls"], { class: "Controls" })).toBe(false);
    expect(canRename(["myApp", "pool1"], { class: "Pool" })).toBe(true);
    expect(canRename(["myApp", "constants"], { class: "Constants" })).toBe(false);
    expect(canRename(["myApp", "web", "pool"], "pool1")).toBe(false);
    expect(
      renameMember({ controls: { class: "Controls" } }, ["controls"], "x")
    ).toMatchObject({ error: expect.stringContaining("not an application") });
  });
});

describe("review fix: net-new survey name", () => {
  it("does not read a surveyed name as a rename", () => {
    const d: Dict = {
      id: "n1",
      myApp: {
        class: "Application",
        web: { class: "Service_HTTP", virtualAddresses: ["10.9.9.9"], virtualPort: 80 },
      },
    };
    const m = newAppManifest(d, "myApp", { id: 0, name: "Storefront Prod" }, 3);
    const { updates } = computeUpdates(JSON.parse(JSON.stringify(d)), m);
    expect(updates).toEqual([]);
  });
});
