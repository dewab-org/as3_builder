import { describe, expect, it } from "vitest";
import perAppSchema from "../../schemas/per-app-schema.json";
import type { JsonSchemaRoot } from "../types";
import { deref, effectiveSchema } from "../refResolver";
import {
  applicationMemberClasses,
  buildClassRegistry,
} from "../classRegistry";
import { resolveSchemaForPath } from "../pathResolver";
import { getContext, getContextForPath } from "../context";
import { stubValue } from "../stubber";
import { indexClassInstances } from "../docIndex";
import { validateValue } from "../validation";

const root = perAppSchema as unknown as JsonSchemaRoot;
const registry = buildClassRegistry(root);

const DOC = {
  schemaVersion: "3.55.0",
  myApp: {
    class: "Application",
    web: {
      class: "Service_HTTP",
      virtualAddresses: ["10.0.0.1"],
      pool: "pool1",
    },
    pool1: {
      class: "Pool",
      members: [{ servicePort: 80, serverAddresses: ["10.0.1.10"] }],
    },
  },
};

describe("refResolver", () => {
  it("derefs #/definitions refs", () => {
    const app = deref(root, { $ref: "#/definitions/Application" });
    expect(app.title).toBe("Application");
  });

  it("throws a descriptive error on unknown refs", () => {
    expect(() => deref(root, { $ref: "#/definitions/Nope" })).toThrow(
      /Unknown \$ref/
    );
  });

  it("flattens allOf chains (Service_HTTP inherits core props)", () => {
    const eff = effectiveSchema(
      root,
      root.definitions!.Service_HTTP,
      DOC.myApp.web
    );
    expect(eff.properties).toHaveProperty("virtualPort"); // own
    expect(eff.properties).toHaveProperty("virtualAddresses"); // via core chain
    expect(eff.properties).toHaveProperty("pool"); // via core chain
  });

  it("applies if/then discrimination from the doc node", () => {
    const appEff = effectiveSchema(root, root.definitions!.Application);
    const memberUnion = appEff.additionalProperties;
    expect(typeof memberUnion).toBe("object");
    const eff = effectiveSchema(root, memberUnion as JsonSchemaRoot, {
      class: "Pool",
    });
    expect(eff.properties).toHaveProperty("members");
  });
});

describe("classRegistry", () => {
  it("contains the key classes and >100 total", () => {
    expect(registry.has("Service_HTTP")).toBe(true);
    expect(registry.has("Pool")).toBe(true);
    expect(registry.has("Application")).toBe(true);
    expect(registry.size).toBeGreaterThan(100);
  });

  it("records required properties", () => {
    expect(registry.get("Pool")!.required).toContain("class");
  });

  it("derives Application member classes from the schema enum", () => {
    const classes = applicationMemberClasses(root, registry);
    const names = classes.map((c) => c.className);
    expect(names).toContain("Service_HTTP");
    expect(names).toContain("Pool");
    expect(names).not.toContain("Application"); // an app can't nest an app
  });
});

describe("pathResolver", () => {
  it("resolves the root path", () => {
    const s = resolveSchemaForPath(root, registry, DOC, []);
    expect(s).toBe(root);
  });

  it("resolves schemaVersion to a string schema", () => {
    const s = resolveSchemaForPath(root, registry, DOC, ["schemaVersion"]);
    expect(effectiveSchema(root, s!).type).toBe("string");
  });

  it("resolves an application by class override", () => {
    const s = resolveSchemaForPath(root, registry, DOC, ["myApp"]);
    expect(s).toBe(root.definitions!.Application);
  });

  it("resolves a Service_HTTP member by class override", () => {
    const s = resolveSchemaForPath(root, registry, DOC, ["myApp", "web"]);
    expect(s).toBe(root.definitions!.Service_HTTP);
  });

  it("resolves into pool members array items", () => {
    const s = resolveSchemaForPath(root, registry, DOC, [
      "myApp",
      "pool1",
      "members",
      0,
    ]);
    const eff = effectiveSchema(root, s!, DOC.myApp.pool1.members[0]);
    expect(eff.required).toContain("servicePort");
    expect(eff.properties).toHaveProperty("serverAddresses");
  });

  it("returns undefined for unresolvable paths", () => {
    const s = resolveSchemaForPath(root, registry, DOC, [
      "schemaVersion",
      "nope",
    ]);
    expect(s).toBeUndefined();
  });
});

describe("context", () => {
  const text = JSON.stringify(DOC, null, 2);

  it("returns Service context with addable props when cursor is in the service", () => {
    const offset = text.indexOf('"Service_HTTP"');
    const ctx = getContext(root, registry, text, offset);
    expect(ctx.className).toBe("Service_HTTP");
    expect(ctx.breadcrumb).toBe("myApp › web (Service_HTTP)");
    const addable = ctx.addableProps.map((p) => p.name);
    expect(addable).toContain("virtualPort"); // absent in doc
    expect(addable).not.toContain("virtualAddresses"); // present in doc
    const present = ctx.presentProps.map((p) => p.name);
    expect(present).toContain("virtualAddresses");
    expect(present).toContain("pool");
  });

  it("normalizes a cursor inside a scalar array value to the enclosing object", () => {
    const offset = text.indexOf("10.0.0.1") + 2;
    const ctx = getContext(root, registry, text, offset);
    expect(ctx.className).toBe("Service_HTTP");
    expect(ctx.path).toEqual(["myApp", "web"]);
  });

  it("flags the Application context and lists member props", () => {
    const ctx = getContextForPath(root, registry, DOC, ["myApp"]);
    expect(ctx.isApplication).toBe(true);
    expect(ctx.className).toBe("Application");
    expect(ctx.addableProps.map((p) => p.name)).toContain("template");
  });

  it("detects enum props with values", () => {
    const ctx = getContextForPath(root, registry, DOC, ["myApp", "pool1"]);
    const lb = ctx.addableProps.find(
      (p) => p.name === "loadBalancingMode"
    );
    expect(lb).toBeDefined();
    expect(lb!.type).toBe("enum");
    expect(lb!.enumValues).toContain("round-robin");
  });

  it("marks pointer properties with xref classes", () => {
    const ctx = getContextForPath(root, registry, DOC, ["myApp", "web"]);
    const pool = ctx.presentProps.find((p) => p.name === "pool");
    expect(pool).toBeDefined();
    expect(pool!.xrefClasses).toContain("Pool");
  });

  it("handles the root context", () => {
    const ctx = getContextForPath(root, registry, DOC, []);
    expect(ctx.breadcrumb).toBe("(root)");
    expect(ctx.presentProps.map((p) => p.name)).toContain("schemaVersion");
  });
});

describe("stubber", () => {
  it("stubs a Pool with class preset and required props", () => {
    const stub = stubValue(root, registry.get("Pool")!.schema) as Record<
      string,
      unknown
    >;
    expect(stub.class).toBe("Pool");
    for (const req of registry.get("Pool")!.required) {
      expect(stub).toHaveProperty(req);
    }
  });

  it("stubs a Service_HTTP with its required props", () => {
    const info = registry.get("Service_HTTP")!;
    const stub = stubValue(root, info.schema) as Record<string, unknown>;
    expect(stub.class).toBe("Service_HTTP");
    expect(stub).toHaveProperty("virtualAddresses");
  });

  it("honors defaults and enum-first rules", () => {
    expect(stubValue(root, { type: "string", default: "x" })).toBe("x");
    expect(stubValue(root, { enum: ["a", "b"] })).toBe("a");
    expect(stubValue(root, { type: "integer", minimum: 10 })).toBe(10);
    expect(stubValue(root, { type: "boolean" })).toBe(false);
  });

  it("terminates on self-referential definitions (depth limit)", () => {
    // constants/irules style recursion — walk every class stub to prove none hang
    const selfRef: JsonSchemaRoot = {
      definitions: {
        Node: {
          type: "object",
          required: ["next"],
          properties: { next: { $ref: "#/definitions/Node" } },
        },
      },
    };
    const stub = stubValue(selfRef, selfRef.definitions!.Node);
    expect(JSON.stringify(stub).length).toBeLessThan(200);
  });
});

describe("unknown props (class change)", () => {
  it("flags leftovers after changing Pool → Service_HTTP", () => {
    const doc = {
      schemaVersion: "3.55.0",
      myApp: {
        class: "Application",
        pool1: {
          class: "Service_HTTP", // was Pool; members is now invalid
          members: [{ servicePort: 80 }],
          virtualAddresses: ["10.0.0.1"],
        },
      },
    };
    const ctx = getContextForPath(root, registry, doc, ["myApp", "pool1"]);
    expect(ctx.unknownProps.map((u) => u.name)).toEqual(["members"]);
    expect(ctx.unknownProps[0].valueType).toBe("array");
  });

  it("does not flag valid members of an Application", () => {
    const ctx = getContextForPath(root, registry, DOC, ["myApp"]);
    expect(ctx.unknownProps).toEqual([]);
  });
});

describe("validation", () => {
  it("validates ports via minimum/maximum", () => {
    const port = { type: "integer", minimum: 0, maximum: 65535 };
    expect(validateValue(port, 80).valid).toBe(true);
    expect(validateValue(port, 65535).valid).toBe(true);
    expect(validateValue(port, 65536).valid).toBe(false);
    expect(validateValue(port, -1).valid).toBe(false);
    expect(validateValue(port, 8.5).valid).toBe(false);
  });

  it("validates f5ip: plain, CIDR, route domain", () => {
    const ip = { type: "string", format: "f5ip" };
    expect(validateValue(ip, "10.0.0.1").valid).toBe(true);
    expect(validateValue(ip, "10.0.0.0/24").valid).toBe(true);
    expect(validateValue(ip, "10.0.0.1%2").valid).toBe(true);
    expect(validateValue(ip, "10.0.0.1%2/32").valid).toBe(true);
    expect(validateValue(ip, "::").valid).toBe(true);
    expect(validateValue(ip, "2001:db8::1/64").valid).toBe(true);
    expect(validateValue(ip, "256.1.1.1").valid).toBe(false);
    expect(validateValue(ip, "10.0.0.0/33").valid).toBe(false);
    expect(validateValue(ip, "not-an-ip").valid).toBe(false);
  });

  it("validates f5bigip paths and hostnames", () => {
    expect(validateValue({ format: "f5bigip" }, "/Common/pool1").valid).toBe(true);
    expect(validateValue({ format: "f5bigip" }, "Common/pool1").valid).toBe(false);
    expect(validateValue({ format: "hostname" }, "www.example.com").valid).toBe(true);
    expect(validateValue({ format: "hostname" }, "-bad-.example").valid).toBe(false);
  });

  it("validates pattern and length", () => {
    const s = { type: "string", pattern: "^[a-z]+$", minLength: 2 };
    expect(validateValue(s, "abc").valid).toBe(true);
    expect(validateValue(s, "ABC").valid).toBe(false);
    expect(validateValue(s, "a").valid).toBe(false);
  });
});

describe("docIndex", () => {
  it("finds every class-bearing object with name and path", () => {
    const idx = indexClassInstances(DOC);
    const byName = Object.fromEntries(idx.map((i) => [i.name, i]));
    expect(byName.myApp.className).toBe("Application");
    expect(byName.web.className).toBe("Service_HTTP");
    expect(byName.pool1.className).toBe("Pool");
    expect(byName.pool1.path).toEqual(["myApp", "pool1"]);
  });
});
