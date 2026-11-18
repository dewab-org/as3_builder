// BIG-IP connection details for the dialog. In memory only — they survive
// closing and reopening it, and are cleared on refresh, never persisted.
//
// Kept out of the dialog so that file exports only components (see chips.ts).

const STORE_KEY = "as3b-bigip-session";

interface BigipSession {
  host: string;
  username: string;
  password: string;
  tenant: string;
  validateCert: boolean;
  connected: boolean;
  as3Version: string;
}

function restore(): Partial<BigipSession> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}") as Record<
      string,
      never
    >;
  } catch {
    return {};
  }
}

const stored = restore();

export const remembered: BigipSession = {
  host: stored.host ?? "",
  username: stored.username ?? "",
  password: stored.password ?? "",
  tenant: stored.tenant ?? "Applications",
  validateCert: stored.validateCert ?? true,
  /** True once "Connect to BIG-IP…" has verified the device this session. */
  connected: stored.connected ?? false,
  /** AS3 version reported by the device at connect time. */
  as3Version: stored.as3Version ?? "",
};

/** Mirror the session to this tab's storage, so a reload stays connected.
 * Per-tab, gone when the tab closes; same CSP boundary as the in-memory
 * copy. The password is included because every BIG-IP call sends basic
 * auth — without it a restored "connection" could not make a single call. */
export function persistBigipSession(): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(remembered));
  } catch {
    /* storage unavailable: the in-memory session still works */
  }
}

/** Request headers for the dev/production server's BIG-IP proxy. */
export function bigipAuthHeaders(): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${remembered.username}:${remembered.password}`)}`,
    "x-bigip-target": remembered.host.trim(),
    "x-bigip-validate-cert": remembered.validateCert ? "1" : "0",
    "content-type": "application/json",
  };
}

/** Seed the fields from the server's environment, without overwriting
 * anything the user has already typed this session. */
export function applyBigipDefaults(defaults: {
  host: string;
  username: string;
  password: string;
  validateCert: boolean;
}): void {
  remembered.host ||= defaults.host;
  remembered.username ||= defaults.username;
  remembered.password ||= defaults.password;
  remembered.validateCert = defaults.validateCert;
}
