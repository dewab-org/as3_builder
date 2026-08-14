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
  it("came from a real device and covers the AS3 pointer properties", async () => {
    const shipped = (await import("../../schemas/bigip-common-catalog.json"))
      .default as BigipCatalog;
    expect(shipped.format).toBe("bigip-common-catalog");
    expect(isCatalogPopulated(shipped)).toBe(true);
    // Provenance: a catalogue with no device behind it is a stale placeholder.
    expect(shipped.generatedFrom.version).toMatch(/^\d+\.\d+/);
    expect(shipped.generatedFrom.digest).toMatch(/^[a-f0-9]{64}$/);

    // The properties a per-app declaration actually points at.
    for (const property of [
      "profileTCP",
      "profileHTTP",
      "profileL4",
      "serverTLS",
      "clientTLS",
      "persistenceMethods",
      "monitors",
    ])
      expect(bigipCandidates(shipped, property).length).toBeGreaterThan(0);

    // Everything is in /Common and usable verbatim in {bigip: …}.
    for (const entry of shipped.entries)
      expect(entry.fullPath.startsWith("/Common/")).toBe(true);
  });

  it("records what a derived profile changes, not just its full settings", async () => {
    const shipped = (await import("../../schemas/bigip-common-catalog.json"))
      .default as BigipCatalog;
    const lan = catalogEntry(shipped, "/Common/tcp-lan-optimized");
    expect(lan?.defaultsFrom).toBe("/Common/tcp-legacy");
    expect(Object.keys(lan?.differsFromParent ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(lan?.settings ?? {}).length).toBeGreaterThan(
      Object.keys(lan?.differsFromParent ?? {}).length
    );
  });
});
