import { describe, expect, it } from "vitest";
import {
  bigipCandidates,
  catalogEntry,
  isCatalogPopulated,
  summarizeEntry,
  type BigipCatalog,
} from "../bigipCatalog";

const catalog: BigipCatalog = {
  format: "bigip-common-catalog",
  formatVersion: 1,
  generatedFrom: { host: "bigip01", version: "17.5.1.4", build: "0.0.20" },
  entries: [
    {
      name: "tcp",
      fullPath: "/Common/tcp",
      collection: "ltm/profile/tcp",
      as3Property: "profileTCP",
      defaultsFrom: null,
      settings: { idleTimeout: 300, nagle: "enabled" },
    },
    {
      name: "tcp-lan-optimized",
      fullPath: "/Common/tcp-lan-optimized",
      collection: "ltm/profile/tcp",
      as3Property: "profileTCP",
      defaultsFrom: "/Common/tcp",
      settings: { idleTimeout: 300, nagle: "disabled", ackOnPush: "enabled" },
      differsFromParent: { nagle: "disabled", ackOnPush: "enabled" },
    },
    {
      name: "http",
      fullPath: "/Common/http",
      collection: "ltm/profile/http",
      as3Property: "profileHTTP",
      defaultsFrom: null,
      settings: {},
    },
  ],
};

describe("bigip catalogue", () => {
  it("offers only the candidates a property accepts, sorted", () => {
    expect(bigipCandidates(catalog, "profileTCP").map((e) => e.name)).toEqual([
      "tcp",
      "tcp-lan-optimized",
    ]);
    expect(bigipCandidates(catalog, "profileHTTP").map((e) => e.fullPath)).toEqual(
      ["/Common/http"]
    );
    expect(bigipCandidates(catalog, "profileNope")).toEqual([]);
    expect(bigipCandidates(undefined, "profileTCP")).toEqual([]);
  });

  it("distinguishes an unfetched catalogue from one with no matches", () => {
    expect(isCatalogPopulated(catalog)).toBe(true);
    expect(isCatalogPopulated({ ...catalog, entries: [] })).toBe(false);
    expect(isCatalogPopulated(undefined)).toBe(false);
  });

  it("summarizes what a derived profile changes", () => {
    const derived = catalogEntry(catalog, "/Common/tcp-lan-optimized")!;
    expect(summarizeEntry(derived)).toBe(
      'nagle: "disabled", ackOnPush: "enabled"'
    );
    expect(summarizeEntry(catalogEntry(catalog, "/Common/tcp")!)).toBe(
      "base profile"
    );
  });

  it("looks an entry up by the path that goes in {bigip: …}", () => {
    expect(catalogEntry(catalog, "/Common/tcp")?.name).toBe("tcp");
    expect(catalogEntry(catalog, "/Common/missing")).toBeUndefined();
  });
});

describe("the shipped catalogue", () => {
  it("is a valid, clearly-unpopulated placeholder until a device is read", async () => {
    const shipped = (await import("../../schemas/bigip-common-catalog.json"))
      .default as BigipCatalog;
    expect(shipped.format).toBe("bigip-common-catalog");
    // If this starts failing, someone fetched a real catalogue — good; update
    // the expectation to assert the entries instead.
    expect(isCatalogPopulated(shipped)).toBe(false);
    expect(shipped.generatedFrom.note).toMatch(/LICENSED BIG-IP/);
  });
});
