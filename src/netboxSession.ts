// Shared NetBox session state: connection details, provisioned token, cached
// application list, and provenance manifests for loaded applications.
// In memory only — cleared on page refresh, never persisted.

import type { AppManifest } from "./engine";

export interface AppEntry {
  id: string;
  name: string;
  description?: string;
}

export const netboxSession = {
  url: "http://localhost:8080",
  username: "",
  password: "",
  /** An API token, used as-is when present — no provisioning round trip. */
  token: "",
  validateCert: true,
  authHeader: "",
  apps: undefined as AppEntry[] | undefined,
  /** declaration id → provenance manifest from the load-time render. */
  manifests: new Map<string, AppManifest>(),
};

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
    throw new Error(
      res.status === 403 || res.status === 401
        ? "Authentication failed (check username/password)"
        : (body.error ?? body.detail ?? `HTTP ${res.status}`)
    );
  }
  const header = body.token
    ? `Bearer nbt_${body.key}.${body.token}`
    : `Token ${body.key}`;
  netboxSession.authHeader = header;
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
export async function ensureIpAddress(addressWithMask: string): Promise<number> {
  const found = await netboxRest<{ results: { id: number }[] }>(
    `/api/ipam/ip-addresses/?address=${encodeURIComponent(addressWithMask)}`
  );
  if (found.results.length > 0) return found.results[0].id;
  const created = await netboxRest<{ id: number }>(`/api/ipam/ip-addresses/`, {
    method: "POST",
    body: { address: addressWithMask },
  });
  return created.id;
}

export function invalidateNetboxAuth(): void {
  netboxSession.authHeader = "";
  netboxSession.apps = undefined;
}
