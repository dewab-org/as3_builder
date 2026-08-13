import { describe, expect, it } from "vitest";
import { substituteDryRunCertificates } from "../dryRunSubstitution";
import { DRY_RUN_CERTIFICATE_PEM } from "../dryRunCertificate";

describe("dry-run certificate substitution", () => {
  const declaration = {
    class: "ADC",
    app: {
      class: "Application",
      cert_a: {
        class: "Certificate",
        certificate: { bigip: "/Common/real.crt" },
        privateKey: { bigip: "/Common/real.key" },
        passphrase: { ciphertext: "secret" },
      },
      nested: {
        class: "TLS_Server",
        certificates: [{ certificate: "cert_a" }],
      },
      pool1: { class: "Pool" },
    },
  };

  it("replaces certificate material and drops the passphrase", () => {
    const { declaration: out, substituted } =
      substituteDryRunCertificates(declaration);
    const cert = (out.app as Record<string, Record<string, unknown>>).cert_a;
    expect(substituted).toEqual(["cert_a"]);
    expect(cert.certificate).toEqual({ text: DRY_RUN_CERTIFICATE_PEM });
    expect(cert.privateKey).toHaveProperty("text");
    expect(cert.passphrase).toBeUndefined();
  });

  it("leaves the original declaration untouched", () => {
    const before = JSON.stringify(declaration);
    substituteDryRunCertificates(declaration);
    expect(JSON.stringify(declaration)).toBe(before);
  });

  it("touches nothing when there are no certificates", () => {
    const plain = { class: "ADC", app: { class: "Application", p: { class: "Pool" } } };
    const { declaration: out, substituted } = substituteDryRunCertificates(plain);
    expect(substituted).toEqual([]);
    expect(out).toEqual(plain);
  });

  it("emits a structurally complete PEM", () => {
    expect(DRY_RUN_CERTIFICATE_PEM).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(DRY_RUN_CERTIFICATE_PEM.trimEnd()).toMatch(
      /-----END CERTIFICATE-----$/
    );
  });
});
