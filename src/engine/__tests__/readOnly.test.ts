import { describe, expect, it } from "vitest";
import { isReadOnlyClass, readOnlyReason } from "../readOnly";

describe("read-only classes", () => {
  it("marks the classes NetBox does not own", () => {
    expect(isReadOnlyClass("Certificate")).toBe(true);
    expect(isReadOnlyClass("SNAT_Pool")).toBe(true);
  });

  it("leaves writable classes alone", () => {
    for (const cls of ["Pool", "Service_HTTPS", "Monitor", "TLS_Server"])
      expect(isReadOnlyClass(cls)).toBe(false);
  });

  it("explains why, for the tooltip", () => {
    expect(readOnlyReason("Certificate")).toMatch(/certificate estate/);
    expect(readOnlyReason("Pool")).toBeUndefined();
    expect(readOnlyReason(undefined)).toBeUndefined();
  });
});
