import type { JsonSchema } from "./types";

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const OK: ValidationResult = { valid: true };
const bad = (message: string): ValidationResult => ({ valid: false, message });

const IPV4_OCTET = "(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
// Loose IPv6 shape check (full grammar is overkill for inline feedback).
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;

export function isIPv4(s: string): boolean {
  return IPV4_RE.test(s);
}

export function isIPv6(s: string): boolean {
  return IPV6_RE.test(s) && s.includes(":");
}

// F5 "f5ip": IPv4/IPv6, optional %routeDomain, optional /prefix (CIDR).
export function validateF5Ip(s: string): ValidationResult {
  const m = /^(.+?)(?:%(\d+))?(?:\/(\d+))?$/.exec(s);
  if (!m) return bad("Not a valid IP address");
  const [, addr, routeDomain, prefix] = m;
  const v4 = isIPv4(addr);
  const v6 = !v4 && isIPv6(addr);
  if (!v4 && !v6) return bad("Not a valid IPv4/IPv6 address");
  if (routeDomain !== undefined && Number(routeDomain) > 65534)
    return bad("Route domain must be 0–65534");
  if (prefix !== undefined) {
    const p = Number(prefix);
    const max = v4 ? 32 : 128;
    if (p > max) return bad(`CIDR prefix must be 0–${max}`);
  }
  return OK;
}

const FORMAT_VALIDATORS: Record<string, (s: string) => ValidationResult> = {
  f5ip: validateF5Ip,
  ipv4: (s) => (isIPv4(s) ? OK : bad("Not a valid IPv4 address (x.x.x.x)")),
  ipv6: (s) => (isIPv6(s) ? OK : bad("Not a valid IPv6 address")),
  f5bigip: (s) =>
    /^(\/[^\s/]+)+$/.test(s)
      ? OK
      : bad("Must be an absolute BIG-IP path like /Common/name"),
  hostname: (s) =>
    /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/.test(s)
      ? OK
      : bad("Not a valid hostname"),
  uri: (s) => {
    try {
      new URL(s);
      return OK;
    } catch {
      return bad("Not a valid URI");
    }
  },
  email: (s) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? OK : bad("Not a valid email address"),
  "date-time": (s) =>
    !Number.isNaN(Date.parse(s)) ? OK : bad("Not a valid date-time"),
};

// Validate a scalar against the constraints its (effective) schema declares.
// Only checks what it understands; unknown constraints pass.
export function validateValue(
  schema: JsonSchema,
  value: unknown
): ValidationResult {
  if (schema.const !== undefined && value !== schema.const)
    return bad(`Must be ${JSON.stringify(schema.const)}`);
  if (typeof value === "number") {
    if (schema.type === "integer" && !Number.isInteger(value))
      return bad("Must be an integer");
    if (schema.minimum !== undefined && value < schema.minimum)
      return bad(`Must be ≥ ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      return bad(`Must be ≤ ${schema.maximum}`);
    if (
      schema.exclusiveMinimum !== undefined &&
      value <= schema.exclusiveMinimum
    )
      return bad(`Must be > ${schema.exclusiveMinimum}`);
    if (
      schema.exclusiveMaximum !== undefined &&
      value >= schema.exclusiveMaximum
    )
      return bad(`Must be < ${schema.exclusiveMaximum}`);
    if (schema.multipleOf !== undefined && schema.multipleOf > 0) {
      // Tolerate float error (e.g. 0.1 steps).
      const q = value / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9)
        return bad(`Must be a multiple of ${schema.multipleOf}`);
    }
    return OK;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      return bad(`Must have at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      return bad(`Must have at most ${schema.maxItems} item${schema.maxItems === 1 ? "" : "s"}`);
    return OK;
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      return bad(`Must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      return bad(`Must be at most ${schema.maxLength} characters`);
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value))
          return bad(`Must match pattern ${schema.pattern}`);
      } catch {
        /* invalid regex in schema — skip */
      }
    }
    if (typeof schema.format === "string") {
      const fv = FORMAT_VALIDATORS[schema.format];
      if (fv) return fv(value);
    }
    if (schema.enum && !schema.enum.includes(value))
      return bad(`Must be one of: ${schema.enum.slice(0, 8).join(", ")}`);
    return OK;
  }
  return OK;
}
