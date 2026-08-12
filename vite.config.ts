import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import https from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";

// Browsers cannot call BIG-IP iControl REST directly (no CORS headers,
// usually self-signed certs), so the dev/preview server forwards requests:
//   <method> /bigip-proxy/<path>  →  https://<x-bigip-target>/<path>
// Headers: x-bigip-target (host[:port]), x-bigip-validate-cert ("1"/"0"),
// authorization (passed through).
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

  const upstream = https.request(
    {
      host,
      port: portStr ? Number(portStr) : 443,
      path,
      method: req.method,
      rejectUnauthorized: validateCert,
      timeout: 20000,
      headers: {
        authorization: String(req.headers.authorization ?? ""),
        "content-type": "application/json",
        accept: "application/json",
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
  req.pipe(upstream);
}

function bigipProxy(): Plugin {
  return {
    name: "bigip-proxy",
    configureServer(server) {
      server.middlewares.use("/bigip-proxy", bigipProxyHandler);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/bigip-proxy", bigipProxyHandler);
    },
  };
}

export default defineConfig({
  plugins: [react(), bigipProxy()],
});
