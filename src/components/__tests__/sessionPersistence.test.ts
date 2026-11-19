// Connection sessions must never write a credential to browser storage:
// only non-secret details survive a reload, and records written by older
// builds (which held the token, auth header or password) are scrubbed.
// Lives under components/__tests__ for the jsdom environment (storage APIs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NETBOX_KEY = "as3b-netbox-session";
const BIGIP_KEY = "as3b-bigip-session";
const SECRETS = ["s3cret-pass", "nbt_abc.def", "Bearer nbt_abc.def", "0123456789abcdef"];

/** Every value in both storage areas, as one string to search. */
function allStorage(): string {
  const dump: string[] = [];
  for (const store of [sessionStorage, localStorage]) {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)!;
      dump.push(key, store.getItem(key) ?? "");
    }
  }
  return dump.join("\n");
}

function expectNoSecrets(): void {
  const dump = allStorage();
  for (const secret of SECRETS) expect(dump).not.toContain(secret);
  expect(dump).not.toMatch(/"(password|token|authHeader)"/);
}

function stored(key: string): Record<string, unknown> {
  return JSON.parse(sessionStorage.getItem(key) ?? "null") as Record<
    string,
    unknown
  >;
}

/** A plain in-memory Storage. Node ≥22 ships its own `localStorage` global,
 * which shadows jsdom's and is undefined without --localstorage-file, so
 * the suite brings its own for both areas. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.resetModules(); // the session modules read storage at import time
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NetBox session persistence", () => {
  it("persists only url, username and validateCert", async () => {
    const mod = await import("../../netboxSession");
    Object.assign(mod.netboxSession, {
      url: "https://netbox.example",
      username: "alice",
      password: "s3cret-pass",
      token: "nbt_abc.def",
      authHeader: "Bearer nbt_abc.def",
      validateCert: false,
    });
    mod.persistNetboxSession();
    expect(stored(NETBOX_KEY)).toEqual({
      url: "https://netbox.example",
      username: "alice",
      validateCert: false,
    });
    expectNoSecrets();
  });

  it("keeps secrets out of storage through provisioning and invalidation", async () => {
    const mod = await import("../../netboxSession");
    mod.netboxSession.username = "alice";
    mod.netboxSession.password = "s3cret-pass";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ key: "abc", token: "def" }), { status: 200 })
    );
    expect(await mod.provisionAuth()).toBe("Bearer nbt_abc.def");
    expectNoSecrets();
    mod.invalidateNetboxAuth();
    expectNoSecrets();
  });

  it("scrubs a legacy record and restores a disconnected session", async () => {
    sessionStorage.setItem(
      NETBOX_KEY,
      JSON.stringify({
        url: "https://netbox.example",
        username: "alice",
        token: "nbt_abc.def",
        authHeader: "Bearer nbt_abc.def",
        validateCert: false,
      })
    );
    const mod = await import("../../netboxSession");
    expect(stored(NETBOX_KEY)).toEqual({
      url: "https://netbox.example",
      username: "alice",
      validateCert: false,
    });
    expectNoSecrets();
    expect(mod.netboxSession).toMatchObject({
      url: "https://netbox.example",
      username: "alice",
      token: "",
      authHeader: "",
      validateCert: false,
    });
    expect(mod.netboxSession.apps).toBeUndefined();
    expect(mod.netboxSessionRestored).toBe(true);
  });

  it("is not restored when nothing was stored", async () => {
    const mod = await import("../../netboxSession");
    expect(mod.netboxSessionRestored).toBe(false);
    expect(sessionStorage.getItem(NETBOX_KEY)).toBeNull();
  });
});

describe("BIG-IP session persistence", () => {
  it("persists only non-secret fields, through every write path", async () => {
    const mod = await import("../bigipSession");
    mod.rememberBigip({
      host: "10.0.0.1",
      username: "admin",
      password: "s3cret-pass",
      validateCert: false,
    });
    mod.remembered.as3Version = "3.50.0";
    mod.setBigipConnected(true);
    mod.persistBigipSession();
    expect(stored(BIGIP_KEY)).toEqual({
      host: "10.0.0.1",
      username: "admin",
      tenant: "Applications",
      validateCert: false,
      as3Version: "3.50.0",
    });
    expectNoSecrets();
  });

  it("scrubs a legacy record and restores Not connected", async () => {
    sessionStorage.setItem(
      BIGIP_KEY,
      JSON.stringify({
        host: "10.0.0.1",
        username: "admin",
        password: "s3cret-pass",
        tenant: "T1",
        validateCert: false,
        connected: true,
        as3Version: "3.50.0",
      })
    );
    const mod = await import("../bigipSession");
    expect(stored(BIGIP_KEY)).toEqual({
      host: "10.0.0.1",
      username: "admin",
      tenant: "T1",
      validateCert: false,
      as3Version: "3.50.0",
    });
    expectNoSecrets();
    expect(mod.remembered).toMatchObject({
      host: "10.0.0.1",
      username: "admin",
      password: "",
      tenant: "T1",
      connected: false,
    });
  });

  it("never applies the server's credentials to a different restored host", async () => {
    sessionStorage.setItem(BIGIP_KEY, JSON.stringify({ host: "10.0.0.1" }));
    const mod = await import("../bigipSession");
    mod.applyBigipDefaults({
      host: "10.9.9.9",
      username: "svc",
      password: "s3cret-pass",
      validateCert: true,
    });
    expect(mod.remembered.host).toBe("10.0.0.1");
    expect(mod.remembered.password).toBe("");
    expect(mod.remembered.username).toBe("");
  });

  it("fills server defaults, credentials included, for a fresh session", async () => {
    const mod = await import("../bigipSession");
    mod.applyBigipDefaults({
      host: "10.9.9.9",
      username: "svc",
      password: "s3cret-pass",
      validateCert: false,
    });
    expect(mod.remembered).toMatchObject({
      host: "10.9.9.9",
      username: "svc",
      password: "s3cret-pass",
      validateCert: false,
    });
    expect(sessionStorage.getItem(BIGIP_KEY)).toBeNull();
  });
});
