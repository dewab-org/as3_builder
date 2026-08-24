import { describe, expect, it } from "vitest";
import {
  CLOSED_POLICY,
  DEFAULT_POLICY,
  auditUnsupported,
  parsePolicy,
  unsupportedClassOf,
  modeLabel,
  ruleReason,
  unsupportedOf,
  variantNote,
  type SupportPolicy,
} from "../supportPolicy";

const policy: SupportPolicy = {
  netbox: true,
  bigipApply: true,
  unsupported: [
    { class: "Service_L4", mode: "hard", reason: "NetScaler handles L4" },
    { class: "Monitor", when: { monitorType: "sip" }, mode: "soft" },
    { class: "Monitor", when: { monitorType: "external" }, mode: "hard" },
  ],
};

describe("parsePolicy", () => {
  it("absent config is everything-enabled", () => {
    expect(parsePolicy(undefined)).toEqual(DEFAULT_POLICY);
    expect(parsePolicy({})).toEqual(DEFAULT_POLICY);
  });

  it("reads gates and rules, defaulting mode to soft", () => {
    const parsed = parsePolicy({
      features: { netbox: false },
      unsupported: [{ class: "Service_L4" }],
    });
    expect(parsed.netbox).toBe(false);
    expect(parsed.bigipApply).toBe(true);
    expect(parsed.unsupported).toEqual([{ class: "Service_L4", mode: "soft" }]);
  });

  it("names the offending entry when the shape is wrong", () => {
    expect(() => parsePolicy({ unsupported: [{ mode: "hard" }] })).toThrow(
      /unsupported\[0\]\.class/
    );
    expect(() =>
      parsePolicy({ unsupported: [{ class: "X", mode: "maybe" }] })
    ).toThrow(/unsupported\[0\]\.mode/);
    expect(() => parsePolicy({ features: { netbox: "yes" } })).toThrow(
      /features\.netbox/
    );
  });

  it("accepts the review mode", () => {
    const parsed = parsePolicy({
      unsupported: [{ class: "iRule", mode: "review" }],
    });
    expect(parsed.unsupported).toEqual([{ class: "iRule", mode: "review" }]);
  });

  it("the closed policy has both gates off", () => {
    expect(CLOSED_POLICY.netbox).toBe(false);
    expect(CLOSED_POLICY.bigipApply).toBe(false);
  });
});

describe("unsupportedOf", () => {
  it("matches a class-wide rule", () => {
    expect(unsupportedOf(policy, { class: "Service_L4" })?.mode).toBe("hard");
    expect(unsupportedOf(policy, { class: "Service_HTTP" })).toBeUndefined();
  });

  it("matches when-rules only when the property agrees", () => {
    expect(
      unsupportedOf(policy, { class: "Monitor", monitorType: "sip" })?.mode
    ).toBe("soft");
    expect(
      unsupportedOf(policy, { class: "Monitor", monitorType: "http" })
    ).toBeUndefined();
    // The property must exist — a bare Monitor matches nothing.
    expect(unsupportedOf(policy, { class: "Monitor" })).toBeUndefined();
  });

  it("first rule wins", () => {
    const overlapping: SupportPolicy = {
      ...policy,
      unsupported: [
        { class: "Monitor", mode: "soft", reason: "first" },
        { class: "Monitor", mode: "hard", reason: "second" },
      ],
    };
    expect(unsupportedOf(overlapping, { class: "Monitor" })?.reason).toBe(
      "first"
    );
  });
});

describe("unsupportedClassOf (pickers)", () => {
  it("a class-wide rule governs the class; when-rules are variants", () => {
    expect(unsupportedClassOf(policy, "Service_L4").rule?.mode).toBe("hard");
    const monitor = unsupportedClassOf(policy, "Monitor");
    expect(monitor.rule).toBeUndefined();
    expect(monitor.variants).toHaveLength(2);
    expect(unsupportedClassOf(policy, "Pool")).toEqual({
      rule: undefined,
      variants: [],
    });
  });

  it("summarises variants for the picker note", () => {
    expect(variantNote(unsupportedClassOf(policy, "Monitor").variants)).toBe(
      "some variants unsupported: monitorType sip; monitorType external"
    );
    expect(variantNote([])).toBeUndefined();
  });

  it("says 'require review' when every variant is review-mode", () => {
    expect(
      variantNote([
        { class: "Monitor", when: { monitorType: "sip" }, mode: "review" },
      ])
    ).toBe("some variants require review: monitorType sip");
  });
});

describe("review vocabulary", () => {
  it("labels review as such, never as unsupported", () => {
    expect(modeLabel("review")).toBe("requires review");
    expect(modeLabel("soft")).toBe("unsupported");
    expect(modeLabel("hard")).toBe("unsupported");
  });

  it("the fallback reason matches the mode", () => {
    expect(ruleReason({ class: "iRule", mode: "review" })).toMatch(
      /requiring review/
    );
    expect(ruleReason({ class: "iRule", mode: "soft" })).toMatch(
      /unsupported/
    );
  });
});

describe("auditUnsupported", () => {
  it("finds every matching object with its path", () => {
    const doc = {
      app: {
        class: "Application",
        l4: { class: "Service_L4" },
        mon: { class: "Monitor", monitorType: "sip" },
        ok: { class: "Pool" },
      },
    };
    const hits = auditUnsupported(policy, doc);
    expect(hits.map((h) => h.path)).toEqual([
      ["app", "l4"],
      ["app", "mon"],
    ]);
    expect(hits[0].rule.reason).toBe("NetScaler handles L4");
  });

  it("is a cheap no-op with an empty blacklist", () => {
    expect(auditUnsupported(DEFAULT_POLICY, { a: { class: "X" } })).toEqual([]);
  });
});
