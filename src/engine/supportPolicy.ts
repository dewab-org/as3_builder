import type { JsonPath } from "./types";
import { isPlainObject } from "./types";

/**
 * Deployment support policy: which features this installation exposes, and
 * which AS3 classes it considers unsupported (see SUPPORT-POLICY-PLAN.md).
 *
 * Pure on purpose, like readOnly.ts: the server parses the config file with
 * it, the UI asks it questions, and the tests exercise it without either.
 */

export type PolicyMode = "hard" | "soft" | "review";

export interface UnsupportedRule {
  class: string;
  /** Optional equality matcher on the object's own properties — "Monitor
   * with monitorType sip". Multiple keys AND together. */
  when?: Record<string, unknown>;
  /** hard: cannot be added here at all. soft: usable, but flagged as
   * unsupported and confirmed. review: supported, but each use needs a
   * human review — flagged in the warning palette and confirmed. */
  mode: PolicyMode;
  /** Shown in tooltips and the are-you-sure dialog. */
  reason?: string;
}

export interface SupportPolicy {
  netbox: boolean;
  bigipApply: boolean;
  unsupported: UnsupportedRule[];
}

/** The absence of configuration: everything enabled, nothing blacklisted. */
export const DEFAULT_POLICY: SupportPolicy = {
  netbox: true,
  bigipApply: true,
  unsupported: [],
};

/** What a malformed config file degrades to: gates closed, loudly. Failing
 * open ("everything enabled") is the one wrong answer for a policy file. */
export const CLOSED_POLICY: SupportPolicy = {
  netbox: false,
  bigipApply: false,
  unsupported: [],
};

/**
 * Validate the config file's parsed JSON into a policy. Throws with a message
 * naming the offending entry — the server turns that into a visible warning
 * and closed gates rather than a silent fallback.
 */
export function parsePolicy(raw: unknown): SupportPolicy {
  if (raw === undefined || raw === null) return DEFAULT_POLICY;
  if (!isPlainObject(raw)) throw new Error("config must be a JSON object");

  const features = raw.features ?? {};
  if (!isPlainObject(features)) throw new Error("features must be an object");
  const gate = (key: string): boolean => {
    const value = (features as Record<string, unknown>)[key];
    if (value === undefined) return true;
    if (typeof value !== "boolean")
      throw new Error(`features.${key} must be true or false`);
    return value;
  };

  const rawRules = raw.unsupported ?? [];
  if (!Array.isArray(rawRules)) throw new Error("unsupported must be an array");
  const unsupported = rawRules.map((entry, i): UnsupportedRule => {
    const at = `unsupported[${i}]`;
    if (!isPlainObject(entry)) throw new Error(`${at} must be an object`);
    if (typeof entry.class !== "string" || entry.class.trim() === "")
      throw new Error(`${at}.class must be a non-empty string`);
    const mode = entry.mode ?? "soft";
    if (mode !== "hard" && mode !== "soft" && mode !== "review")
      throw new Error(`${at}.mode must be "hard", "soft" or "review"`);
    if (entry.when !== undefined && !isPlainObject(entry.when))
      throw new Error(`${at}.when must be an object of property equalities`);
    if (entry.reason !== undefined && typeof entry.reason !== "string")
      throw new Error(`${at}.reason must be a string`);
    return {
      class: entry.class,
      mode,
      ...(entry.when ? { when: { ...entry.when } } : {}),
      ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
    };
  });

  return { netbox: gate("netbox"), bigipApply: gate("bigipApply"), unsupported };
}

/** The reason shown when a rule carries none. */
export function ruleReason(rule: UnsupportedRule): string {
  if (rule.reason) return rule.reason;
  return rule.mode === "review"
    ? "marked as requiring review by this deployment's configuration"
    : "marked unsupported by this deployment's configuration";
}

/** The badge/label vocabulary for a mode: review items are supported but
 * flagged, so they never read as "unsupported". */
export function modeLabel(mode: PolicyMode): string {
  return mode === "review" ? "requires review" : "unsupported";
}

/**
 * The first rule matching a document value: class equal, and every `when`
 * key strictly equal on the value itself. First rule in the list wins.
 */
export function unsupportedOf(
  policy: SupportPolicy,
  value: Record<string, unknown>
): UnsupportedRule | undefined {
  if (typeof value.class !== "string") return undefined;
  return policy.unsupported.find(
    (rule) =>
      rule.class === value.class &&
      (!rule.when ||
        Object.entries(rule.when).every(([k, v]) => value[k] === v))
  );
}

export interface ClassSupport {
  /** A class-wide rule (no `when`): governs whether the class may be added. */
  rule?: UnsupportedRule;
  /** Variant-scoped rules (`when` present). They cannot block adding the
   * bare class — the discriminator property does not exist yet — but the
   * picker notes them ("some variants unsupported: sip"). */
  variants: UnsupportedRule[];
}

/** What the pickers need to know about a class before any value exists. */
export function unsupportedClassOf(
  policy: SupportPolicy,
  className: string
): ClassSupport {
  const rules = policy.unsupported.filter((r) => r.class === className);
  return {
    rule: rules.find((r) => !r.when),
    variants: rules.filter((r) => r.when !== undefined),
  };
}

/** One line summarising the variant rules, for the picker note. */
export function variantNote(variants: UnsupportedRule[]): string | undefined {
  if (variants.length === 0) return undefined;
  const parts = variants.map((r) =>
    Object.entries(r.when ?? {})
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ")
  );
  const label = variants.every((r) => r.mode === "review")
    ? "some variants require review"
    : "some variants unsupported";
  return `${label}: ${parts.join("; ")}`;
}

/** Every path in the document whose object matches a rule. Feeds the issues
 * bar and the validate/apply dialogs. */
export function auditUnsupported(
  policy: SupportPolicy,
  doc: unknown
): { path: JsonPath; rule: UnsupportedRule }[] {
  if (policy.unsupported.length === 0) return [];
  const out: { path: JsonPath; rule: UnsupportedRule }[] = [];
  const visit = (node: unknown, path: JsonPath) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, [...path, i]));
      return;
    }
    if (!isPlainObject(node)) return;
    const rule = unsupportedOf(policy, node);
    if (rule) out.push({ path, rule });
    for (const [key, value] of Object.entries(node))
      visit(value, [...path, key]);
  };
  visit(doc, []);
  return out;
}
