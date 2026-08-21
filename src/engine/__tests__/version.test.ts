import { describe, expect, it } from "vitest";
import { APP_VERSION, displayFromSemver } from "../../version";
import { version as packageVersion } from "../../../package.json";

describe("version bookkeeping", () => {
  it("package.json mirrors the display version (0.05 <-> 0.5.0)", () => {
    // Bumping one without the other is the mistake this test exists for.
    expect(displayFromSemver(packageVersion)).toBe(APP_VERSION);
  });

  it("the mapping survives two-digit minors and patch releases", () => {
    expect(displayFromSemver("0.5.0")).toBe("0.05");
    expect(displayFromSemver("0.10.0")).toBe("0.10");
    expect(displayFromSemver("0.5.1")).toBe("0.05.1");
  });
});
