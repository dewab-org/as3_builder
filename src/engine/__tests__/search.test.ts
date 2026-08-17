import { describe, expect, it } from "vitest";
import { pathKey } from "../relationships";
import { searchMatches } from "../search";

const doc = {
  schemaVersion: "3.55.0",
  app: {
    class: "Application",
    web: { class: "Service_HTTP", virtualPort: 8443, pool: "sg_web" },
    sg_web: { class: "Pool", members: [{ serverAddresses: ["10.0.1.10"] }] },
  },
};

const has = (set: Set<string> | null, path: (string | number)[]) =>
  set !== null && set.has(pathKey(path));

describe("find in document", () => {
  it("is off for a blank query, distinct from no hits", () => {
    expect(searchMatches(doc, "")).toBeNull();
    expect(searchMatches(doc, "   ")).toBeNull();
    expect(searchMatches(doc, "zzz-nothing")?.size).toBe(0);
  });

  it("matches keys, case-insensitively", () => {
    const set = searchMatches(doc, "VIRTUALPORT");
    expect(has(set, ["app", "web", "virtualPort"])).toBe(true);
  });

  it("matches scalar values, including inside arrays and numbers", () => {
    expect(
      has(searchMatches(doc, "10.0.1"), [
        "app",
        "sg_web",
        "members",
        0,
        "serverAddresses",
        0,
      ])
    ).toBe(true);
    expect(has(searchMatches(doc, "8443"), ["app", "web", "virtualPort"])).toBe(
      true
    );
  });

  it("keeps the route to a match: ancestors are in the set", () => {
    const set = searchMatches(doc, "10.0.1");
    expect(has(set, ["app", "sg_web"])).toBe(true);
    expect(has(set, ["app"])).toBe(true);
    // The array item on the route counts too — a matching pool member must
    // not render dimmed (the bug the live check caught).
    expect(has(set, ["app", "sg_web", "members", 0])).toBe(true);
    // …but an unrelated sibling is not.
    expect(has(set, ["app", "web"])).toBe(false);
  });

  it("a class-name query lights up the objects of that class", () => {
    const set = searchMatches(doc, "pool");
    // "pool" the property on web, and sg_web via its class value.
    expect(has(set, ["app", "web", "pool"])).toBe(true);
    expect(has(set, ["app", "sg_web"])).toBe(true);
  });
});
