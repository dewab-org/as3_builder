import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  bigipProxyHandler,
  netboxProxyHandler,
  urlProxyHandler,
} from "./server/proxy";

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
