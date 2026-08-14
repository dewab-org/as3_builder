import { describe, expect, it } from "vitest";
import { pathKey, relatedPaths } from "../relationships";

const doc = {
  id: "1",
  schemaVersion: "3.55.0",
  app: {
    class: "Application",
    label: "sg_web", // prose that happens to match a member name
    sg_web: { class: "Pool", monitors: [{ use: "mon_http" }] },
    mon_http: { class: "Monitor", monitorType: "http" },
    ssl_web: { class: "TLS_Server", certificates: [{ certificate: "cert_web" }] },
    cert_web: { class: "Certificate" },
    vs_web: {
      class: "Service_HTTPS",
      pool: "sg_web",
      serverTLS: { use: "ssl_web" },
      snat: { bigip: "/Common/Shared/snatpool" },
    },
  },
};

const keys = (path: (string | number)[]) => [...relatedPaths(doc, path)].sort();

describe("pointer relationships", () => {
  it("lights up what a selected pointer object names", () => {
    expect(keys(["app", "vs_web", "serverTLS"])).toEqual([pathKey(["app", "ssl_web"])]);
  });

  it("lights up everything a selected object points at", () => {
    expect(keys(["app", "vs_web"])).toEqual(
      [pathKey(["app", "sg_web"]), pathKey(["app", "ssl_web"])].sort()
    );
  });

  it("lights up the pointers aimed at a selected object", () => {
    expect(keys(["app", "sg_web"])).toEqual(
      [
        pathKey(["app", "vs_web", "pool"]),
        // its own monitor reference, since a pool points as well as is pointed at
        pathKey(["app", "mon_http"]),
      ].sort()
    );
  });

  it("ignores prose that happens to match a member name", () => {
    // Application.label is "sg_web"; selecting the application must not link.
    expect(keys(["app"])).toEqual([]);
  });

  it("ignores pointers outside the declaration", () => {
    // snat names an estate object, which has no card to light up.
    const onlySnat = { ...doc, app: { ...doc.app, vs_web: { class: "Service_HTTPS", snat: { bigip: "/Common/Shared/x" } } } };
    expect([...relatedPaths(onlySnat, ["app", "vs_web"])]).toEqual([]);
  });

  it("never marks the selection as its own relation", () => {
    expect(keys(["app", "mon_http"])).not.toContain(pathKey(["app", "mon_http"]));
  });
});
