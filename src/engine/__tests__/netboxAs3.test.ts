import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import goldenInput from "./fixtures/netbox-golden-input.json";
import goldenExpected from "./fixtures/netbox-golden-expected.json";
import perAppSchema from "../../schemas/per-app-schema.json";
import { renderNetboxApp, sanitizeKey } from "../netboxAs3";

type Dict = Record<string, unknown>;

const app = (
  (goldenInput as { data: { application_list: Dict[] } }).data.application_list
)[0];
const expected = goldenExpected as Dict;
const appName = "fixture-lb_vserver_ssl-10_0_0_2-sample-bigip-a_01-1321c639";

describe("netbox → AS3 renderer (golden fixture)", () => {
  const { declaration, warnings } = renderNetboxApp(app);
  const rendered = declaration[appName] as Dict;
  const expectedApp = expected[appName] as Dict;

  it("produces the per-app envelope", () => {
    expect(declaration.id).toBe(`18-${appName}`);
    expect(declaration.schemaVersion).toBe("3.55.0");
    expect(rendered.class).toBe("Application");
    expect(rendered.label).toBe(expectedApp.label); // 64-char truncation
  });

  it("renders the pool with grouped members like f5_toolbox", () => {
    const pool = rendered.sg_web as Dict;
    const expectedPool = expectedApp.sg_web as Dict;
    expect(pool.class).toBe("Pool");
    expect(pool.loadBalancingMode).toBe(expectedPool.loadBalancingMode);
    expect(pool.members).toEqual(expectedPool.members);
  });

  it("decodes base64 certificate PEM into text form", () => {
    const cert = rendered.PLACEHOLDER_cert_app as Dict;
    const expectedCert = expectedApp.PLACEHOLDER_cert_app as Dict;
    expect(cert.certificate).toEqual(expectedCert.certificate);
    expect(cert.privateKey).toEqual(expectedCert.privateKey);
  });

  it("renders TLS_Server with joined ciphers and non-default TLS flags", () => {
    const tls = rendered.ssl_vs_ssl_app as Dict;
    const expectedTls = expectedApp.ssl_vs_ssl_app as Dict;
    expect(tls.class).toBe("TLS_Server");
    expect(tls.certificates).toEqual(expectedTls.certificates);
    expect(tls.ciphers).toBe(expectedTls.ciphers);
    // fixture profile allows TLSv1.1+1.2 → 1.0 off (default on) emitted;
    // 1.1/1.2 stay default-on, 1.3 stays default-off → all omitted
    expect(tls.tls1_0Enabled).toBe(false);
    expect(tls.tls1_1Enabled).toBeUndefined();
    expect(tls.tls1_2Enabled).toBeUndefined();
    expect(tls.tls1_3Enabled).toBeUndefined();
  });

  it("renders the Service_Address and wires it via use", () => {
    const addr = rendered.vs_ssl_app_service_address as Dict;
    expect(addr).toMatchObject({
      class: "Service_Address",
      virtualAddress: "10.0.0.2/32",
      routeAdvertisement: "selective",
    });
    const svc = rendered.vs_ssl_app as Dict;
    expect(svc.virtualAddresses).toEqual([{ use: "vs_ssl_app_service_address" }]);
  });

  it("renders the HTTPS service core", () => {
    const svc = rendered.vs_ssl_app as Dict;
    expect(svc.class).toBe("Service_HTTPS");
    expect(svc.virtualPort).toBe(443);
    expect(svc.pool).toBe("sg_web");
    expect(svc.persistenceMethods).toEqual(["cookie"]);
    expect(svc.serverTLS).toEqual({ use: "ssl_vs_ssl_app" });
  });

  it("emits no warnings for the golden fixture", () => {
    expect(warnings).toEqual([]);
  });

  it("validates against the per-app AS3 schema", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(perAppSchema);
    const ok = validate(declaration);
    if (!ok) {
      const messages = (validate.errors ?? [])
        .map((e) => `${e.instancePath} ${e.message}`)
        .slice(0, 10);
      expect.fail(`schema errors: ${messages.join(" | ")}`);
    }
  });
});

describe("policy rendering (NetBox stores the whole AS3 object in rules)", () => {
  const standardPolicy = (name: string, ruleName: string) => ({
    id: "1",
    name,
    policy_type: "standard",
    description: `desc ${name}`,
    rules: {
      class: "Endpoint_Policy",
      strategy: "first-match",
      rules: [
        {
          name: ruleName,
          actions: [{ type: "forward", event: "request" }],
          conditions: [],
        },
      ],
    },
  });

  const irulePolicy = (name: string, tcl: string) => ({
    id: "2",
    name,
    policy_type: "irule",
    rules: { class: "iRule", iRule: tcl },
  });

  function renderWith(policies: unknown[]) {
    return renderNetboxApp({
      id: "600",
      name: "app600",
      virtual_servers: [
        {
          name: "vs1",
          protocol: "https",
          service_port: 443,
          virtual_addresses: [{ address: "10.0.0.20/32" }],
          policies,
        },
      ],
    });
  }

  it("unwraps rules.rules for a single standard policy", () => {
    const { declaration, warnings } = renderWith([
      standardPolicy("pol-web", "rule-web"),
    ]);
    const app = declaration.app600 as Dict;
    const policy = app["pol-web"] as Dict;
    expect(policy.class).toBe("Endpoint_Policy");
    expect(policy.rules).toHaveLength(1);
    expect((policy.rules as Dict[])[0].name).toBe("rule-web");
    expect(policy.strategy).toBe("first-match");
    expect((app.vs1 as Dict).policyEndpoint).toEqual({ use: "pol-web" });
    expect(warnings).toEqual([]);
  });

  it("merges several standard policies, preserving every rule", () => {
    const { declaration } = renderWith([
      standardPolicy("pol-api", "rule-api"),
      standardPolicy("pol-web", "rule-web"),
    ]);
    const app = declaration.app600 as Dict;
    const merged = app["vs1-endpoint-policy"] as Dict;
    expect(merged.rules).toHaveLength(2);
    expect((merged.rules as Dict[]).map((r) => r.name)).toEqual([
      "rule-api",
      "rule-web",
    ]);
    expect(merged.strategy).toBe("first-match");
    expect((app.vs1 as Dict).policyEndpoint).toEqual({
      use: "vs1-endpoint-policy",
    });
  });

  it("base64-encodes the Tcl itself, not the wrapper JSON", () => {
    const tcl = 'when HTTP_REQUEST {\n  HTTP::respond 301\n}';
    const { declaration } = renderWith([irulePolicy("rs-pol-redirect", tcl)]);
    const app = declaration.app600 as Dict;
    const rule = app["rs-pol-redirect"] as Dict;
    const encoded = (rule.iRule as Dict).base64 as string;
    expect(Buffer.from(encoded, "base64").toString("utf-8")).toBe(tcl);
    expect((app.vs1 as Dict).iRules).toEqual(["rs-pol-redirect"]);
  });

  it("accepts the legacy iRule shape (rules.rules as a string)", () => {
    const tcl = "when CLIENT_ACCEPTED { log local0. hi }";
    const { declaration } = renderWith([
      { id: "3", name: "legacy", policy_type: "irule", rules: { rules: tcl } },
    ]);
    const rule = (declaration.app600 as Dict).legacy as Dict;
    expect(
      Buffer.from((rule.iRule as Dict).base64 as string, "base64").toString("utf-8")
    ).toBe(tcl);
  });

  it("warns instead of emitting an empty policy when the shape is wrong", () => {
    const { declaration, warnings } = renderWith([
      { id: "4", name: "broken", policy_type: "standard", rules: [] },
    ]);
    expect((declaration.app600 as Dict).broken).toBeUndefined();
    expect(warnings.some((w) => w.includes("broken"))).toBe(true);
  });
});

describe("netbox renderer edge cases", () => {
  it("sanitizes AS3 keys", () => {
    expect(sanitizeKey("9bad name!")).toBe("A_9bad_name_");
    expect(sanitizeKey("x".repeat(100)).length).toBe(64);
  });

  it("skips unsupported protocols with a warning", () => {
    const { declaration, warnings } = renderNetboxApp({
      id: "1",
      name: "app1",
      virtual_servers: [{ name: "vs1", protocol: "generic" }],
    });
    expect(warnings.some((w) => w.includes("not supported"))).toBe(true);
    expect((declaration.app1 as Dict).vs1).toBeUndefined();
  });

  it("references BIG-IP certs when NetBox has no PEM", () => {
    const { declaration } = renderNetboxApp({
      id: "2",
      name: "app2",
      virtual_servers: [
        {
          name: "vs1",
          protocol: "https",
          service_port: 443,
          virtual_addresses: [{ address: "10.0.0.1/32" }],
          ssl_profile: {
            name: "sslp",
            profile_type: "client",
            certificates: [{ name: "mycert" }],
            tls_versions: [],
          },
        },
      ],
    });
    const cert = (declaration.app2 as Dict).mycert as Dict;
    expect(cert.certificate).toEqual({ bigip: "/Common/mycert.crt" });
    expect(cert.privateKey).toEqual({ bigip: "/Common/mycert.key" });
  });

  it("disabled members get adminState disable and separate grouping", () => {
    const { declaration } = renderNetboxApp({
      id: "3",
      name: "app3",
      virtual_servers: [
        {
          name: "vs1",
          protocol: "http",
          service_port: 80,
          virtual_addresses: [{ address: "10.0.0.1/32" }],
          backend_pool: {
            name: "p1",
            members: [
              { node: { address: "10.1.1.1/32" }, service_port: 80, enabled: true },
              { node: { address: "10.1.1.2/32" }, service_port: 80, enabled: true },
              { node: { address: "10.1.1.3/32" }, service_port: 80, enabled: false },
            ],
          },
        },
      ],
    });
    const pool = (declaration.app3 as Dict).p1 as Dict;
    expect(pool.members).toEqual([
      { servicePort: 80, serverAddresses: ["10.1.1.1", "10.1.1.2"] },
      { servicePort: 80, serverAddresses: ["10.1.1.3"], adminState: "disable" },
    ]);
  });
});
