// Proxy handlers shared by the Vite dev/preview server (vite.config.ts) and
// the production server (server/index.ts), so the containerised build keeps
// the NetBox and BIG-IP features the dev server has.
import https from "node:https";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

/** The gates the proxies enforce (SUPPORT-POLICY-PLAN.md §4). Hidden buttons
 * are UX; these 403s are the control — anyone can reach a proxy with curl. */
export interface ProxyGates {
  netbox: boolean;
  bigipApply: boolean;
}

export const OPEN_GATES: ProxyGates = { netbox: true, bigipApply: true };

function forbid(res: ServerResponse, error: string): void {
  res.statusCode = 403;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error }));
}

/**
 * Whether a BIG-IP request may pass when applying is disabled. Pure so the
 * tests can exercise it without sockets.
 *
 * Reads (GET/HEAD) always pass — Load-from-BIG-IP and /info are reads. A
 * write to the AS3 declare endpoints passes only when its body is JSON with
 * controls.dryRun === true; anything else — a real apply, a DELETE, an
 * unparseable body — is refused. Fail closed.
 */
export function bigipWriteAllowed(
  gates: ProxyGates,
  method: string | undefined,
  path: string,
  body: Buffer
): { allowed: boolean; error?: string } {
  if (gates.bigipApply) return { allowed: true };
  if (method === "GET" || method === "HEAD") return { allowed: true };
  if (!/^\/mgmt\/shared\/appsvcs\/declare/.test(path))
    return { allowed: true };
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { controls?: { dryRun?: unknown } }).controls ===
        "object" &&
      (parsed as { controls: { dryRun?: unknown } }).controls?.dryRun === true
    )
      return { allowed: true };
  } catch {
    // Unparseable body: refuse below.
  }
  return {
    allowed: false,
    error:
      "Applying to a BIG-IP is disabled by this deployment's configuration (dry-run is allowed).",
  };
}

// Browsers cannot call BIG-IP iControl REST directly (no CORS headers,
// usually self-signed certs), so the dev/preview server forwards requests:
//   <method> /bigip-proxy/<path>  →  https://<x-bigip-target>/<path>
// Headers: x-bigip-target (host[:port]), x-bigip-validate-cert ("1"/"0"),
// authorization (passed through).
// Buffer the request body so it can be forwarded with an explicit
// Content-Length — upstream servers (gunicorn behind NetBox, notably) do not
// accept the chunked transfer-encoding a naive req.pipe() would produce.
// AS3 declarations are large but not unbounded; refuse anything absurd so a
// single request can't exhaust the server's memory.
const MAX_BODY_BYTES = 16 * 1024 * 1024;

function withBody(
  req: IncomingMessage,
  res: ServerResponse,
  cb: (body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size > MAX_BODY_BYTES) {
      res.statusCode = 413;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "Request body too large" }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => {
    if (!res.writableEnded) cb(Buffer.concat(chunks));
  });
}

function authHeader(req: IncomingMessage): Record<string, string> {
  return req.headers.authorization
    ? { authorization: String(req.headers.authorization) }
    : {};
}

export function bigipProxyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  gates: ProxyGates = OPEN_GATES
): void {
  const target = String(req.headers["x-bigip-target"] ?? "");
  const validateCert = req.headers["x-bigip-validate-cert"] === "1";
  if (!target || !/^[A-Za-z0-9_.:\-[\]]+$/.test(target)) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Missing or invalid x-bigip-target header" }));
    return;
  }
  const [host, portStr] = target.startsWith("[")
    ? [target.replace(/^\[(.+)\](?::(\d+))?$/, "$1"), target.match(/\]:(\d+)$/)?.[1]]
    : target.split(":");
  const path = (req.url ?? "").replace(/^\/bigip-proxy/, "") || "/";

  withBody(req, res, (body) => {
    const verdict = bigipWriteAllowed(gates, req.method, path, body);
    if (!verdict.allowed) {
      forbid(res, verdict.error ?? "Forbidden");
      return;
    }
    const upstream = https.request(
      {
        host,
        port: portStr ? Number(portStr) : 443,
        path,
        method: req.method,
        rejectUnauthorized: validateCert,
        timeout: 20000,
        headers: {
          ...authHeader(req),
          "content-type": "application/json",
          accept: "application/json",
          "content-length": body.length,
        },
      },
      (upRes) => {
        res.statusCode = upRes.statusCode ?? 502;
        res.setHeader("content-type", upRes.headers["content-type"] ?? "application/json");
        upRes.pipe(res);
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("Connection timed out")));
    upstream.on("error", (err) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: `Cannot reach ${target}: ${err.message}` }));
    });
    upstream.end(body);
  });
}

// NetBox proxy: same CORS problem as BIG-IP. Target is a full origin
// (http://host:8080 or https://host) in x-netbox-target; the Authorization
// header is passed through (Bearer nbt_… v2 tokens or Token … v1 tokens).
export function netboxProxyHandler(
  req: IncomingMessage,
  res: ServerResponse,
  gates: ProxyGates = OPEN_GATES
): void {
  if (!gates.netbox) {
    forbid(
      res,
      "NetBox support is disabled by this deployment's configuration."
    );
    return;
  }
  const target = String(req.headers["x-netbox-target"] ?? "");
  let base: URL;
  try {
    base = new URL(target);
    if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error();
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "x-netbox-target must be a http(s) origin URL" }));
    return;
  }
  const validateCert = req.headers["x-netbox-validate-cert"] === "1";
  const path = (req.url ?? "").replace(/^\/netbox-proxy/, "") || "/";
  const lib = base.protocol === "https:" ? https : http;
  withBody(req, res, (body) => {
    const upstream = lib.request(
      {
        host: base.hostname,
        port: base.port || (base.protocol === "https:" ? 443 : 80),
        path,
        method: req.method,
        timeout: 20000,
        ...(base.protocol === "https:" ? { rejectUnauthorized: validateCert } : {}),
        headers: {
          ...authHeader(req),
          "content-type": "application/json",
          accept: "application/json",
          "content-length": body.length,
        },
      },
      (upRes) => {
        res.statusCode = upRes.statusCode ?? 502;
        res.setHeader("content-type", upRes.headers["content-type"] ?? "application/json");
        upRes.pipe(res);
      }
    );
    upstream.on("timeout", () => upstream.destroy(new Error("Connection timed out")));
    upstream.on("error", (err) => {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: `Cannot reach ${target}: ${err.message}` }));
    });
    upstream.end(body);
  });
}

// Generic GET passthrough for schema URLs whose hosts don't send CORS
// headers. GET-only, http(s)-only, target via ?url=.
export function urlProxyHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end();
    return;
  }
  const query = new URL(req.url ?? "/", "http://x").searchParams;
  let target: URL;
  try {
    target = new URL(query.get("url") ?? "");
    if (target.protocol !== "http:" && target.protocol !== "https:")
      throw new Error();
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "url must be an http(s) URL" }));
    return;
  }
  const lib = target.protocol === "https:" ? https : http;
  const upstream = lib.get(
    target,
    { timeout: 30000, headers: { accept: "application/json" } },
    (upRes) => {
      // Follow one level of redirects (GitHub raw etc.).
      if (
        upRes.statusCode &&
        [301, 302, 307, 308].includes(upRes.statusCode) &&
        upRes.headers.location
      ) {
        upRes.resume();
        const redirected = lib.get(
          new URL(upRes.headers.location, target),
          { timeout: 30000 },
          (r2) => {
            res.statusCode = r2.statusCode ?? 502;
            res.setHeader("content-type", r2.headers["content-type"] ?? "application/json");
            r2.pipe(res);
          }
        );
        redirected.on("error", (err) => {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: err.message }));
        });
        return;
      }
      res.statusCode = upRes.statusCode ?? 502;
      res.setHeader("content-type", upRes.headers["content-type"] ?? "application/json");
      upRes.pipe(res);
    }
  );
  upstream.on("timeout", () => upstream.destroy(new Error("Connection timed out")));
  upstream.on("error", (err) => {
    res.statusCode = 502;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: `Cannot reach ${target.host}: ${err.message}` }));
  });
}
