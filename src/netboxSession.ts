// Shared NetBox session state: connection details, provisioned token, cached
// application list, and provenance manifests for loaded applications.
//
// The connection itself (URL, token/auth header — not the password, not the
// manifests) is mirrored to sessionStorage so a page reload in the same tab
// keeps the session connected. sessionStorage is per-tab and gone when the
// tab closes; the app's strict CSP is what stands between it and script
// injection, the same boundary the in-memory copy lives behind.

import type { AppManifest } from "./engine";

export interface AppEntry {
  id: string;
  name: string;
  description?: string;
}

const STORE_KEY = "as3b-netbox-session";

function restore(): Partial<{
  url: string;
  username: string;
  token: string;
  authHeader: string;
  validateCert: boolean;
}> {
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

export const netboxSession = {
  url: stored.url || "http://localhost:8080",
  username: stored.username ?? "",
  password: "",
  /** An API token, used as-is when present — no provisioning round trip. */
  token: stored.token ?? "",
  validateCert: stored.validateCert ?? true,
  authHeader: stored.authHeader ?? "",
  apps: undefined as AppEntry[] | undefined,
  /** declaration id → provenance manifest from the load-time render. */
  manifests: new Map<string, AppManifest>(),
};

/** Mirror the reload-safe parts of the session to this tab's storage. */
export function persistNetboxSession(): void {
  try {
    sessionStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        url: netboxSession.url,
        username: netboxSession.username,
        token: netboxSession.token,
        authHeader: netboxSession.authHeader,
        validateCert: netboxSession.validateCert,
      })
    );
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

export function invalidateNetboxAuth(): void {
  netboxSession.authHeader = "";
  netboxSession.apps = undefined;
  persistNetboxSession();
}
