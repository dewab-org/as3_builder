import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import https from "node:https";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

// Browsers cannot call BIG-IP iControl REST directly (no CORS headers,
// usually self-signed certs), so the dev/preview server forwards requests:
//   <method> /bigip-proxy/<path>  →  https://<x-bigip-target>/<path>
// Headers: x-bigip-target (host[:port]), x-bigip-validate-cert ("1"/"0"),
// authorization (passed through).
// Buffer the request body so it can be forwarded with an explicit
// Content-Length — upstream servers (gunicorn behind NetBox, notably) do not
// accept the chunked transfer-encoding a naive req.pipe() would produce.
function withBody(
  req: IncomingMessage,
  cb: (body: Buffer) => void
): void {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => cb(Buffer.concat(chunks)));
}

function authHeader(req: IncomingMessage): Record<string, string> {
  return req.headers.authorization
    ? { authorization: String(req.headers.authorization) }
    : {};
}

function bigipProxyHandler(req: IncomingMessage, res: ServerResponse): void {
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

  withBody(req, (body) => {
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
function netboxProxyHandler(req: IncomingMessage, res: ServerResponse): void {
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
  withBody(req, (body) => {
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
function urlProxyHandler(req: IncomingMessage, res: ServerResponse): void {
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

function bigipProxy(): Plugin {
  return {
    name: "bigip-proxy",
    configureServer(server) {
      server.middlewares.use("/bigip-proxy", bigipProxyHandler);
      server.middlewares.use("/netbox-proxy", netboxProxyHandler);
      server.middlewares.use("/url-proxy", urlProxyHandler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/bigip-proxy", bigipProxyHandler);
      server.middlewares.use("/netbox-proxy", netboxProxyHandler);
      server.middlewares.use("/url-proxy", urlProxyHandler);
    },
  };
}

export default defineConfig({
  plugins: [react(), bigipProxy()],
});
