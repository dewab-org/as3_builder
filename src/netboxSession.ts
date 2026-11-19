// Shared NetBox session state: connection details, provisioned token, cached
// application list, and provenance manifests for loaded applications.
//
// Only the non-secret connection details (URL, username, TLS choice) are
// mirrored to sessionStorage, so a page reload in the same tab prefills the
// Connect dialog. The token, the Authorization header built from it and the
// password live in memory only: after a reload the user connects again.

import type { AppManifest } from "./engine";

export interface AppEntry {
  id: string;
  name: string;
  description?: string;
}

const STORE_KEY = "as3b-netbox-session";

/** The fields that may be written to browser storage. Anything else — the
 * token, the auth header, the password — must never be persisted. */
interface StoredNetboxSession {
  url: string;
  username: string;
  validateCert: boolean;
}

/** Read the non-secret connection details. A record written by an older
 * build may also hold the token and auth header: rewrite it without them. */
function restore(): Partial<StoredNetboxSession> {
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null) return {};
    raw = parsed as Record<string, unknown>;
  } catch {
    return {};
  }
  const kept: Partial<StoredNetboxSession> = {};
  if (typeof raw.url === "string") kept.url = raw.url;
  if (typeof raw.username === "string") kept.username = raw.username;
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

/** True when this tab restored NetBox connection details on load: the
 * server's startup defaults must then not replace the restored URL and TLS
 * choice, and its credentials apply only if they belong to that URL. No
 * credential is ever restored, so this never means "connected". */
export const netboxSessionRestored = Boolean(stored.url);

export const netboxSession = {
  url: stored.url || "http://localhost:8080",
  username: stored.username ?? "",
  password: "",
  /** An API token, used as-is when present — no provisioning round trip. */
  token: "",
  validateCert: stored.validateCert ?? true,
  authHeader: "",
  apps: undefined as AppEntry[] | undefined,
  /** declaration id → provenance manifest from the load-time render. */
  manifests: new Map<string, AppManifest>(),
};

/** Mirror the non-secret connection details to this tab's storage. */
export function persistNetboxSession(): void {
  const record: StoredNetboxSession = {
    url: netboxSession.url,
    username: netboxSession.username,
    validateCert: netboxSession.validateCert,
  };
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch {
    /* storage full or unavailable: the in-memory session still works */
  }
}

export function proxyHeaders(auth: string): Record<string, string> {
  return {
    authorization: auth,
    "x-netbox-target": netboxSession.url.trim().replace(/\/+$/, ""),
    "x-netbox-validate-cert": netboxSession.validateCert ? "1" : "0",
    "content-type": "application/json",
  };
}

/**
 * The Authorization header for a token the user supplied. NetBox 4.3+ issues
 * v2 tokens (`nbt_<key>.<secret>`, sent as Bearer); anything else is a classic
 * 40-character key sent as `Token`. Accepting a full header verbatim means a
 * value pasted from elsewhere still works.
 */
export function tokenAuthHeader(token: string): string {
  const value = token.trim();
  if (/^(Bearer|Token)\s/i.test(value)) return value;
  return value.startsWith("nbt_") ? `Bearer ${value}` : `Token ${value}`;
}

// Provision an API token from username/password. NetBox ≥4.3 returns a v2
// token (Bearer nbt_<key>.<token>); older versions return a 40-char key used
// as `Token <key>`.
export async function provisionAuth(): Promise<string> {
  if (netboxSession.authHeader) return netboxSession.authHeader;
  // A supplied token skips provisioning entirely — and is the only option
  // when the account cannot provision tokens for itself.
  if (netboxSession.token.trim()) {
    netboxSession.authHeader = tokenAuthHeader(netboxSession.token);
    return netboxSession.authHeader;
  }
  const res = await fetch("/netbox-proxy/api/users/tokens/provision/", {
    method: "POST",
    headers: proxyHeaders(""),
    body: JSON.stringify({
      username: netboxSession.username,
      password: netboxSession.password,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // DRF field errors ({username: ["This field is required."]}) carry the
    // actual reason — a bare "HTTP 400" hides it.
    const fallback =
      typeof body === "object" && body !== null && Object.keys(body).length > 0
        ? `HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`
        : `HTTP ${res.status}`;
    throw new Error(
      res.status === 403 || res.status === 401
        ? "Authentication failed (check username/password)"
        : (body.error ?? body.detail ?? fallback)
    );
  }
  const header = body.token
    ? `Bearer nbt_${body.key}.${body.token}`
    : `Token ${body.key}`;
  netboxSession.authHeader = header;
  persistNetboxSession();
  return header;
}

export async function netboxGraphql<T>(query: string): Promise<T> {
  const auth = await provisionAuth();
  const res = await fetch("/netbox-proxy/graphql/", {
    method: "POST",
    headers: proxyHeaders(auth),
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? body.detail ?? `HTTP ${res.status}`);
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data as T;
}

export async function netboxRest<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const auth = await provisionAuth();
  const res = await fetch(`/netbox-proxy${path}`, {
    method: init?.method ?? "GET",
    headers: proxyHeaders(auth),
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      body.error ??
      body.detail ??
      (typeof body === "object" ? JSON.stringify(body).slice(0, 200) : "");
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return body as T;
}

// IPAM get-or-create: pool member nodes and VIPs are ipam.IPAddress FKs.
// `created` lets a failed push roll back the addresses it minted without
// ever touching pre-existing ones.
export async function ensureIpAddress(
  addressWithMask: string
): Promise<{ id: number; created: boolean }> {
  const found = await netboxRest<{ results: { id: number }[] }>(
    `/api/ipam/ip-addresses/?address=${encodeURIComponent(addressWithMask)}`
  );
  if (found.results.length > 0) return { id: found.results[0].id, created: false };
  const created = await netboxRest<{ id: number }>(`/api/ipam/ip-addresses/`, {
    method: "POST",
    body: { address: addressWithMask },
  });
  return { id: created.id, created: true };
}

const listeners = new Set<(connected: boolean) => void>();

/** Follow the Connected state (toolbar button). Returns an unsubscribe. */
export function onNetboxConnectionChange(
  fn: (connected: boolean) => void
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function notifyNetboxConnected(connected: boolean): void {
  for (const fn of listeners) fn(connected);
}

export function invalidateNetboxAuth(): void {
  netboxSession.authHeader = "";
  netboxSession.apps = undefined;
  persistNetboxSession();
  notifyNetboxConnected(false);
}
