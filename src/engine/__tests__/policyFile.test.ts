import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppConfig, readPolicy } from "../../../server/appConfig";

const dir = mkdtempSync(join(tmpdir(), "as3b-policy-"));
const file = (name: string, content: string) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

describe("policy file loading", () => {
  it("no file and none named: the unconfigured default, no warning", () => {
    const load = readPolicy({ AS3B_CONFIG: undefined });
    expect(load.policy.netbox).toBe(true);
    expect(load.policy.bigipApply).toBe(true);
    expect(load.warning).toBeUndefined();
  });

  it("reads a valid file", () => {
    const load = readPolicy({
      AS3B_CONFIG: file(
        "good.json",
        JSON.stringify({
          features: { bigipApply: false },
          unsupported: [{ class: "Service_L4", mode: "hard" }],
        })
      ),
    });
    expect(load.warning).toBeUndefined();
    expect(load.policy.bigipApply).toBe(false);
    expect(load.policy.netbox).toBe(true);
    expect(load.policy.unsupported[0].class).toBe("Service_L4");
  });

  it("a named-but-missing file closes the gates, loudly", () => {
    const load = readPolicy({ AS3B_CONFIG: join(dir, "nope.json") });
    expect(load.policy.netbox).toBe(false);
    expect(load.policy.bigipApply).toBe(false);
    expect(load.warning).toMatch(/does not exist/);
  });

  it("a malformed file closes the gates, loudly — never fails open", () => {
    for (const content of ["{not json", '{"unsupported":[{"mode":"hard"}]}']) {
      const load = readPolicy({ AS3B_CONFIG: file("bad.json", content) });
      expect(load.policy.netbox).toBe(false);
      expect(load.policy.bigipApply).toBe(false);
      expect(load.warning).toMatch(/disabled until it is fixed/);
    }
  });

  it("the warning and policy travel on /app-config", () => {
    const load = readPolicy({ AS3B_CONFIG: file("bad2.json", "{{") });
    const config = readAppConfig({}, true, undefined, load);
    expect(config.policy.netbox).toBe(false);
    expect(config.warnings.join(" ")).toMatch(/not a valid policy file/);
  });
});
