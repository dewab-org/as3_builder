import { describe, expect, it } from "vitest";
import {
  definitionDocumentation,
  fieldDocumentation,
  loadAs3Documentation,
} from "../documentation";

describe("AS3 documentation augmentation", () => {
  it("covers every bundled AS3 definition with normalized fields", async () => {
    const documentation = await loadAs3Documentation();
    expect(documentation.generatedFrom.schemaSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(documentation.generatedFrom.implementation?.version).toBe(
      "3.56.0-10"
    );
    const entries = Object.entries(documentation.definitions);
    expect(entries).toHaveLength(524);
    for (const [, definition] of entries) {
      expect(definition.schemaDescription.length).toBeGreaterThan(0);
      expect(definition.behavior.length).toBeGreaterThan(0);
      expect(definition.allowedFields).toEqual(Object.keys(definition.fields));
      for (const field of Object.values(definition.fields)) {
        expect(field.types.length).toBeGreaterThan(0);
        expect(field.schemaDescription.length).toBeGreaterThan(0);
        expect(field.behavior.length).toBeGreaterThan(0);
        expect(field.allowed).toBeTypeOf("object");
      }
    }
  });

  it("flattens inherited service fields and preserves their equivalencies", async () => {
    const documentation = await loadAs3Documentation();
    const service = definitionDocumentation(documentation, "Service_HTTP");
    expect(service?.allowedFields).toContain("virtualAddresses");
    expect(service?.allowedFields).toContain("pool");
    expect(
      fieldDocumentation(documentation, "Service_HTTP", "pool")?.tmsh
    ).toMatchObject({
      objectType: "ltm virtual",
      property: "pool",
    });
  });

  it("looks definitions up by class discriminator", async () => {
    const documentation = await loadAs3Documentation();
    expect(definitionDocumentation(documentation, "Pool")?.tmsh?.objectType).toBe(
      "ltm pool"
    );
  });

  it("uses implementation mappings and curated TMOS behavior", async () => {
    const documentation = await loadAs3Documentation();
    const fields = Object.values(documentation.definitions).flatMap((definition) =>
      Object.values(definition.fields)
    );
    expect(
      fields.filter(
        (field) => field.behaviorSource === "as3-implementation-mapping"
      ).length
    ).toBeGreaterThan(2000);
    expect(fieldDocumentation(documentation, "Pool", "minimumMembersActive"))
      .toMatchObject({
        behaviorSource: "curated-tmos",
        tmsh: { objectType: "ltm pool", property: "min-active-members" },
      });
    expect(
      fieldDocumentation(documentation, "Pool", "minimumMembersActive")
        ?.behavior
    ).toContain("priority-group activation");
  });
});
