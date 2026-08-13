// Endpoint_Policy internals: rules, actions and conditions are discriminated
// unions whose properties sit behind `required`-gated oneOf branches.
import { describe, expect, it } from "vitest";
import perAppSchema from "../../schemas/per-app-schema.json";
import { buildClassRegistry } from "../classRegistry";
import { getContextForPath } from "../context";
import type { JsonSchemaRoot } from "../types";

const root = perAppSchema as unknown as JsonSchemaRoot;
const registry = buildClassRegistry(root);

const docWith = (action: unknown, condition: unknown) => ({
  schemaVersion: "3.55.0",
  myApp: {
    class: "Application",
    pol: {
      class: "Endpoint_Policy",
      rules: [{ name: "r1", actions: [action], conditions: [condition] }],
    },
  },
});

const propsAt = (doc: unknown, path: (string | number)[]) => {
  const ctx = getContextForPath(root, registry, doc, path);
  return [...ctx.presentProps, ...ctx.addableProps].map((p) => p.name);
};

describe("policy rule internals", () => {
  const doc = docWith({ type: "forward", event: "request" }, { type: "httpUri" });

  it("rule items offer the rule's own properties", () => {
    const p = propsAt(doc, ["myApp", "pol", "rules", 0]);
    expect(p).toEqual(
      expect.arrayContaining(["name", "conditions", "actions", "label", "remark"])
    );
  });

  it("a forward action offers select (gated behind a required-only oneOf)", () => {
    const p = propsAt(doc, ["myApp", "pol", "rules", 0, "actions", 0]);
    expect(p).toContain("select");
  });

  it("an httpUri condition offers every match target while none is chosen", () => {
    const p = propsAt(doc, ["myApp", "pol", "rules", 0, "conditions", 0]);
    expect(p).toEqual(
      expect.arrayContaining(["path", "host", "pathSegment", "queryParameter"])
    );
  });

  it("once a match target is chosen its alternatives are withheld", () => {
    const chosen = docWith(
      { type: "forward" },
      { type: "httpUri", path: { values: ["/"], operand: "equals" } }
    );
    const p = propsAt(chosen, ["myApp", "pol", "rules", 0, "conditions", 0]);
    expect(p).toContain("path");
    expect(p).not.toContain("host");
  });
});
