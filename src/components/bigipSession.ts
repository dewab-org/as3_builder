// BIG-IP connection details for the dialogs. They survive closing and
// reopening a dialog. The non-secret ones (host, username, tenant, TLS
// choice, AS3 version) are mirrored to sessionStorage so a reload in the
// same tab prefills them; the password lives in memory only, so after a
// reload the session is Not connected until the user connects again.
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

/** The fields that may be written to browser storage. The password must
 * never be; nor `connected`, which without the password would be a lie. */
type StoredBigipSession = Pick<
  BigipSession,
  "host" | "username" | "tenant" | "validateCert" | "as3Version"
>;

/** Read the non-secret connection details. A record written by an older
 * build may also hold the password: rewrite it without it. */
function restore(): Partial<StoredBigipSession> {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    raw = parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  const kept: Partial<StoredBigipSession> = {};
  for (const key of ["host", "username", "tenant", "as3Version"] as const) {
    if (typeof raw[key] === "string") kept[key] = raw[key];
  }
  if (typeof raw.validateCert === "boolean") kept.validateCert = raw.validateCert;
  if (Object.keys(raw).some((k) => !(k in kept))) {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(kept));
    } catch {
      /* storage unavailable: nothing to scrub */
    }
  }
  return kept;
}

const stored = restore();

/** True when this tab restored BIG-IP connection details on load. */
const bigipSessionRestored = Boolean(stored.host);

export const remembered: BigipSession = {
  host: stored.host ?? "",
  username: stored.username ?? "",
  password: "",
  tenant: stored.tenant ?? "Applications",
  validateCert: stored.validateCert ?? true,
  /** True once "Connect to BIG-IP…" has verified the device this session.
   * Never restored: without the password a reload cannot be connected. */
  connected: false,
  /** AS3 version reported by the device at connect time. */
  as3Version: stored.as3Version ?? "",
};

/** Mirror the non-secret connection details to this tab's storage. */
export function persistBigipSession(): void {
  const record: StoredBigipSession = {
    host: remembered.host,
    username: remembered.username,
    tenant: remembered.tenant,
    validateCert: remembered.validateCert,
    as3Version: remembered.as3Version,
  };
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(record));
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
  // The server's credentials belong to the server's device: never hand them
  // to a different host restored from this tab.
  if (remembered.host.trim() === defaults.host.trim()) {
    remembered.username ||= defaults.username;
    remembered.password ||= defaults.password;
  }
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
