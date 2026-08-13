import { useEffect, useMemo, useState } from "react";
import Ajv, { type ValidateFunction } from "ajv";
import type { JsonPath } from "../engine";

export interface ValidationIssue {
  path: JsonPath;
  instancePath: string;
  message: string;
}

// "/myApp/web/pool" → ["myApp", "web", "pool"] (with ~0/~1 unescaping and
// numeric segments as numbers, so findNodeAtLocation works).
export function instancePathToJsonPath(instancePath: string): JsonPath {
  if (!instancePath) return [];
  return instancePath
    .slice(1)
    .split("/")
    .map((seg) => {
      const decoded = seg.replace(/~1/g, "/").replace(/~0/g, "~");
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded;
    });
}

const MAX_ISSUES = 50;

export function useValidation(
  schema: Record<string, unknown>,
  schemaId: string,
  doc: unknown
): { issues: ValidationIssue[]; ready: boolean } {
  const [validator, setValidator] = useState<ValidateFunction | undefined>();

  // Compiling the 1.2MB schema takes noticeable time — do it per schema
  // selection, off the initial render path.
  useEffect(() => {
    setValidator(undefined);
    const handle = setTimeout(() => {
      try {
        const ajv = new Ajv({ strict: false, allErrors: true, verbose: false });
        setValidator(() => ajv.compile(schema));
      } catch {
        setValidator(undefined);
      }
    }, 50);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaId]);

  const issues = useMemo(() => {
    if (!validator || doc === undefined) return [];
    validator(doc);
    const errors = validator.errors ?? [];
    // anyOf unions make ajv noisy: drop pure "must match ..." union chatter
    // when a more specific error exists for the same location, and dedupe.
    const seen = new Set<string>();
    const out: ValidationIssue[] = [];
    const interesting = errors.filter(
      (e) => !["anyOf", "oneOf", "if"].includes(e.keyword)
    );
    for (const e of interesting.length > 0 ? interesting : errors) {
      const key = `${e.instancePath}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        path: instancePathToJsonPath(e.instancePath),
        instancePath: e.instancePath || "(root)",
        message: e.message ?? "invalid",
      });
      if (out.length >= MAX_ISSUES) break;
    }
    return out;
  }, [validator, doc]);

  return { issues, ready: validator !== undefined };
}
