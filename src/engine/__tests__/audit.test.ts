// Regression tests for conditional-subschema handling: the AS3 schema hides
// large numbers of properties and enums behind if/then, dependencies, and
// combinators. These cover each construct the audit identified.

import { describe, expect, it } from "vitest";
import perAppSchema from "../../schemas/per-app-schema.json";
import { buildClassRegistry } from "../classRegistry";
import { getContextForPath } from "../context";
import { describeSchema } from "../describe";
import { effectiveSchema } from "../refResolver";
import { resolveSchemaForPath } from "../pathResolver";
import type { JsonSchemaRoot } from "../types";

const root = perAppSchema as unknown as JsonSchemaRoot;
const registry = buildClassRegistry(root);

function app(members: Record<string, unknown>) {
  return { schemaVersion: "3.55.0", myApp: { class: "Application", ...members } };
}

function addableAt(members: Record<string, unknown>, key: string): string[] {
  const ctx = getContextForPath(root, registry, app(members), ["myApp", key]);
  return ctx.addableProps.map((p) => p.name);
}

describe("conditional subschemas", () => {
  it("if/then on a discriminator adds that type's properties (Monitor)", () => {
    const dns = addableAt({ m: { class: "Monitor", monitorType: "dns" } }, "m");
    const tcp = addableAt({ m: { class: "Monitor", monitorType: "tcp" } }, "m");
    expect(dns).toContain("queryName");
    expect(dns).toContain("acceptRCODE");
    expect(tcp).not.toContain("queryName");
    expect(tcp).toContain("send");
  });

  it("if-conditions using combinators are evaluated, not assumed true", () => {
    // GSLB_Pool gates branches on "resourceRecordType is A or AAAA" via
    // anyOf inside the if; without combinator support every branch merged
    // and MX pools were offered A-record properties.
    const a = addableAt({ g: { class: "GSLB_Pool", resourceRecordType: "A" } }, "g");
    const mx = addableAt({ g: { class: "GSLB_Pool", resourceRecordType: "MX" } }, "g");
    expect(a).not.toEqual(mx);
    expect(a).toContain("monitors");
    expect(mx).not.toContain("monitors");
  });

  it("enums inside a property's then-branch resolve with the document value", () => {
    const doc = app({
      p: { class: "Pool", members: [{ servicePort: 80, addressDiscovery: "static" }] },
    });
    const path = ["myApp", "p", "members", 0, "addressDiscovery"];
    const schema = resolveSchemaForPath(root, registry, doc, path)!;

    // Without the document value the branch cannot be chosen…
    expect(effectiveSchema(root, schema).enum).toBeUndefined();
    // …with it, the enum (and therefore the pick list) appears.
    const withValue = effectiveSchema(root, schema, "static");
    expect(withValue.enum).toContain("fqdn");

    const docs = describeSchema(root, schema, "static");
    expect(docs.enumValues).toContain("fqdn");
    expect(docs.type).toBe("enum");
  });

  it("dependencies constrain but never introduce properties (audit invariant)", () => {
    // Every `dependencies` entry in this schema only requires/forbids or
    // restricts values; all referenced properties are declared normally, so
    // the property lists need no dependency handling. Guard the assumption.
    const withDep = addableAt(
      {
        t: {
          class: "TLS_Server",
          certificates: [{ certificate: "c" }],
          forwardProxyBypassAllowlist: { bigip: "/Common/x" },
        },
      },
      "t"
    );
    const withoutDep = addableAt(
      { t: { class: "TLS_Server", certificates: [{ certificate: "c" }] } },
      "t"
    );
    for (const name of ["forwardProxyEnabled", "forwardProxyBypassEnabled"]) {
      expect(withDep).toContain(name);
      expect(withoutDep).toContain(name);
    }
  });

  it("class discrimination still wins over sibling branches", () => {
    const pool = addableAt({ p: { class: "Pool" } }, "p");
    expect(pool).toContain("loadBalancingMode");
    expect(pool).not.toContain("virtualAddresses");
  });
});
