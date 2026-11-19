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

/** True when this tab restored BIG-IP connection details on load. */
const bigipSessionRestored = Boolean(stored.host);

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

/** Request headers for the dev/production server's BIG-IP proxy — for the
 * given connection fields, or the remembered session by default. */
export function bigipAuthHeaders(
  fields: {
    host: string;
    username: string;
    password: string;
    validateCert: boolean;
  } = remembered
): Record<string, string> {
  return {
    authorization: `Basic ${btoa(`${fields.username}:${fields.password}`)}`,
    "x-bigip-target": fields.host.trim(),
    "x-bigip-validate-cert": fields.validateCert ? "1" : "0",
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
  // A session restored from this tab keeps its own TLS choice.
  if (!bigipSessionRestored) remembered.validateCert = defaults.validateCert;
}

const listeners = new Set<(connected: boolean) => void>();

/** Follow the Connected state (toolbar button). Returns an unsubscribe. */
export function onBigipConnectionChange(
  fn: (connected: boolean) => void
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setBigipConnected(connected: boolean): void {
  if (remembered.connected === connected) return;
  remembered.connected = connected;
  persistBigipSession();
  for (const fn of listeners) fn(connected);
}

/** Record the dialog's connection fields. Changing the device or the
 * credentials means the verified connection no longer applies. */
export function rememberBigip(fields: {
  host: string;
  username: string;
  password: string;
  validateCert: boolean;
}): void {
  const changed =
    fields.host !== remembered.host ||
    fields.username !== remembered.username ||
    fields.password !== remembered.password ||
    fields.validateCert !== remembered.validateCert;
  if (!changed) return;
  Object.assign(remembered, fields);
  persistBigipSession();
  setBigipConnected(false);
}
