import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  bigipProxyHandler,
  netboxProxyHandler,
  urlProxyHandler,
} from "./server/proxy";
import { applyArgv, readPolicy, serveAppConfig } from "./server/appConfig";

function bigipProxy(env: Record<string, string>): Plugin {
  // .env values, then real environment, then --flags: the last one wins, so a
  // single run can target a different device without editing anything.
  const settings = applyArgv({ ...env, ...process.env }, process.argv);
  const policyLoad = readPolicy(settings);
  const gates = policyLoad.policy;
  const mount = (server: {
    middlewares: {
      use: (path: string, handler: typeof urlProxyHandler) => void;
    };
  }) => {
    server.middlewares.use("/bigip-proxy", (req, res) =>
      bigipProxyHandler(req, res, gates)
    );
    server.middlewares.use("/netbox-proxy", (req, res) =>
      netboxProxyHandler(req, res, gates)
    );
    server.middlewares.use("/url-proxy", urlProxyHandler);
    server.middlewares.use("/app-config", (_req, res) =>
      serveAppConfig(res, settings, true, undefined, policyLoad)
    );
  };
  return {
    name: "bigip-proxy",
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig(({ mode }) => ({
  // "" loads every variable, not just VITE_-prefixed ones; nothing here is
  // compiled into the bundle, it is only served at runtime.
  plugins: [react(), bigipProxy(loadEnv(mode, process.cwd(), ""))],
}));
