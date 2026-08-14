import { describe, expect, it } from "vitest";
import {
  applyArgv,
  credentialsAllowed,
  readAppConfig,
} from "../../../server/appConfig";

const env = {
  BIGIP_HOSTNAME: "bigip01",
  BIGIP_USERNAME: "admin",
  BIGIP_PASSWORD: "secret",
  BIGIP_VALIDATE_CERTS: "0",
  NETBOX_URL: "http://netbox:8080",
  NETBOX_TOKEN: "nbt_abc.def",
  NETBOX_USERNAME: "nbuser",
  NETBOX_PASSWORD: "nbpass",
};

describe("startup configuration", () => {
  it("reads hosts, credentials and flags in dev", () => {
    const config = readAppConfig(env, true);
    expect(config.bigip).toEqual({
      host: "bigip01",
      username: "admin",
      password: "secret",
      validateCert: false,
    });
    expect(config.netbox.url).toBe("http://netbox:8080");
    expect(config.netbox.token).toBe("nbt_abc.def");
    expect(config.netbox.validateCert).toBe(true); // absent → verify
    expect(config.includesCredentials).toBe(true);
  });

  it("withholds secrets from a deployed server by default", () => {
    const config = readAppConfig(env, false);
    // The tedious-but-harmless parts still prefill.
    expect(config.bigip.host).toBe("bigip01");
    expect(config.bigip.username).toBe("admin");
    expect(config.netbox.username).toBe("nbuser");
    // The secrets do not.
    expect(config.bigip.password).toBe("");
    expect(config.netbox.token).toBe("");
    expect(config.netbox.password).toBe("");
    expect(config.includesCredentials).toBe(false);
  });

  it("exposes secrets in production only when told to", () => {
    expect(credentialsAllowed({}, false)).toBe(false);
    expect(credentialsAllowed({ AS3B_EXPOSE_CREDENTIALS: "1" }, false)).toBe(true);
    expect(readAppConfig({ ...env, AS3B_EXPOSE_CREDENTIALS: "1" }, false).bigip.password).toBe("secret");
    // …and can be switched off in dev.
    expect(credentialsAllowed({ AS3B_EXPOSE_CREDENTIALS: "0" }, true)).toBe(false);
  });

  it("treats the usual falsey spellings as false", () => {
    for (const value of ["0", "false", "no", "off", "FALSE"])
      expect(readAppConfig({ BIGIP_VALIDATE_CERTS: value }, true).bigip.validateCert).toBe(false);
    for (const value of ["1", "true", "yes", "on"])
      expect(readAppConfig({ BIGIP_VALIDATE_CERTS: value }, true).bigip.validateCert).toBe(true);
    // Empty means "not set" — keep the safe default.
    expect(readAppConfig({ BIGIP_VALIDATE_CERTS: "" }, true).bigip.validateCert).toBe(true);
  });

  it("lets command-line flags override the environment", () => {
    const merged = applyArgv(env, [
      "node",
      "server.mjs",
      "--bigip-host",
      "bigip02",
      "--netbox-url",
      "https://other:8443",
    ]);
    expect(merged.BIGIP_HOSTNAME).toBe("bigip02");
    expect(merged.NETBOX_URL).toBe("https://other:8443");
    expect(merged.BIGIP_USERNAME).toBe("admin"); // untouched
  });

  it("ignores a flag with no value", () => {
    expect(applyArgv({}, ["--bigip-host", "--netbox-url", "x"])).toEqual({
      NETBOX_URL: "x",
    });
  });
});
