// Production server for the container image: serves the built SPA and mounts
// the same BIG-IP/NetBox/URL proxies the Vite dev server uses, so a deployed
// image keeps every feature. Bundled by esbuild into a single file, so the
// runtime image needs no node_modules at all.
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  bigipProxyHandler,
  netboxProxyHandler,
  urlProxyHandler,
} from "./proxy";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROOT = resolve(process.env.STATIC_ROOT ?? "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// Everything the app talks to goes through this origin's own proxy routes, so
// connect-src can stay 'self'. Monaco needs blob: workers and injects its
// styles inline; nothing else is allowed to load.
//
// 'unsafe-eval' is unavoidable, not an oversight: Ajv compiles each JSON
// Schema into a JavaScript function at runtime, and "load schema from URL"
// means that compilation cannot be moved to build time. Without it the app
// throws EvalError and renders nothing. The remaining directives keep the
// blast radius small — no third-party script origin is allowed, so there is
// no external code to eval in the first place.
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: 'unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function securityHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()"
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.removeHeader("X-Powered-By");
}

/** Resolve a URL path inside ROOT, or undefined if it escapes (traversal). */
function safePath(urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return undefined;
  return candidate;
}

async function sendFile(
  res: ServerResponse,
  file: string,
  { immutable }: { immutable: boolean }
): Promise<boolean> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  res.statusCode = 200;
  res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
  res.setHeader("content-length", info.size);
  // Hashed asset filenames can be cached forever; index.html never is, or
  // clients would pin themselves to a stale build.
  res.setHeader(
    "cache-control",
    immutable ? "public, max-age=31536000, immutable" : "no-cache"
  );
  createReadStream(file).pipe(res);
  return true;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  securityHeaders(res);
  const url = req.url ?? "/";

  if (url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  // Strip the mount prefix the way connect's middleware layer would, since
  // the handlers were written against Vite's middleware stack.
  for (const [prefix, handler] of [
    ["/bigip-proxy", bigipProxyHandler],
    ["/netbox-proxy", netboxProxyHandler],
    ["/url-proxy", urlProxyHandler],
  ] as const) {
    if (url === prefix || url.startsWith(prefix + "/") || url.startsWith(prefix + "?")) {
      handler(req, res);
      return;
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("allow", "GET, HEAD");
    res.end();
    return;
  }

  const file = safePath(url === "/" ? "/index.html" : url);
  if (!file) {
    res.statusCode = 400;
    res.end();
    return;
  }
  const isAsset = url.startsWith("/assets/");
  if (await sendFile(res, file, { immutable: isAsset })) return;

  // Unknown asset paths are a 404; anything else falls back to the SPA shell.
  if (isAsset || extname(file)) {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }
  if (!(await sendFile(res, join(ROOT, "index.html"), { immutable: false }))) {
    res.statusCode = 500;
    res.end("Missing index.html");
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error("request failed:", err);
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
});

// Slowloris guards.
server.headersTimeout = 20_000;
server.requestTimeout = 60_000;
server.keepAliveTimeout = 10_000;

server.listen(PORT, HOST, () => {
  console.log(`as3-builder listening on http://${HOST}:${PORT} (root ${ROOT})`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Don't let a hung connection block the shutdown forever.
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
