import { describe, expect, it } from "vitest";
import { OPEN_GATES, bigipWriteAllowed } from "../../../server/proxy";

const CLOSED = { netbox: false, bigipApply: false };
const declare = "/mgmt/shared/appsvcs/declare/Applications/applications";
const body = (value: unknown) => Buffer.from(JSON.stringify(value));

describe("BIG-IP apply gate (proxy decision)", () => {
  it("everything passes when the gate is open", () => {
    expect(
      bigipWriteAllowed(OPEN_GATES, "POST", declare, body({})).allowed
    ).toBe(true);
  });

  it("reads always pass: Load-from-BIG-IP and /info are reads", () => {
    expect(bigipWriteAllowed(CLOSED, "GET", declare, Buffer.alloc(0)).allowed).toBe(true);
    expect(
      bigipWriteAllowed(CLOSED, "GET", "/mgmt/shared/appsvcs/info", Buffer.alloc(0))
        .allowed
    ).toBe(true);
  });

  it("a dry-run POST passes; a real apply does not", () => {
    expect(
      bigipWriteAllowed(CLOSED, "POST", declare, body({ controls: { dryRun: true } }))
        .allowed
    ).toBe(true);
    const applied = bigipWriteAllowed(
      CLOSED,
      "POST",
      declare,
      body({ controls: { dryRun: false } })
    );
    expect(applied.allowed).toBe(false);
    expect(applied.error).toMatch(/dry-run is allowed/);
    expect(bigipWriteAllowed(CLOSED, "POST", declare, body({})).allowed).toBe(false);
  });

  it("fails closed on what it cannot read", () => {
    // Unparseable body, and a body-less DELETE, are both refused.
    expect(
      bigipWriteAllowed(CLOSED, "POST", declare, Buffer.from("not json")).allowed
    ).toBe(false);
    expect(bigipWriteAllowed(CLOSED, "DELETE", declare, Buffer.alloc(0)).allowed).toBe(
      false
    );
  });

  it("writes to non-declare endpoints are not this gate's business", () => {
    expect(
      bigipWriteAllowed(CLOSED, "POST", "/mgmt/shared/authn/login", body({}))
        .allowed
    ).toBe(true);
  });
});
