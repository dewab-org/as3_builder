// Startup defaults for the BIG-IP and NetBox dialogs, taken from the
// environment (a .env file in dev, real env vars or --flags in production).
//
// This is served at runtime rather than compiled in on purpose: the container
// image is published to a registry, and anything baked into the bundle would
// ship with it. The server reads its own environment instead, so the same
// image is safe to publish and still prefills for whoever runs it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CLOSED_POLICY,
  DEFAULT_POLICY,
  parsePolicy,
  type SupportPolicy,
} from "../src/engine/supportPolicy";

export interface AppConfig {
  bigip: {
    host: string;
    username: string;
    password: string;
    validateCert: boolean;
  };
  netbox: {
    url: string;
    token: string;
    username: string;
    password: string;
    validateCert: boolean;
  };
  /** False when the server withheld secrets (see credentialsAllowed). */
  includesCredentials: boolean;
  /** Configuration problems worth showing before a connection is attempted. */
  warnings: string[];
  /** Deployment support policy (SUPPORT-POLICY-PLAN.md). */
  policy: SupportPolicy;
}

export interface PolicyLoad {
  policy: SupportPolicy;
  /** Set when the file existed but could not be used — the gates are then
   * CLOSED, not defaulted: a malformed policy file must fail loudly, never
   * open. */
  warning?: string;
}

/**
 * Read the policy file named by AS3B_CONFIG (default ./as3b-config.json).
 * Called once at server startup; a page refresh picks up edits after a
 * restart, and that is the intended cadence.
 */
export function readPolicy(env: Env): PolicyLoad {
  const path = resolve(env.AS3B_CONFIG ?? "as3b-config.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" && env.AS3B_CONFIG === undefined)
      // No file, none named: the unconfigured default.
      return { policy: DEFAULT_POLICY };
    if (code === "ENOENT")
      return {
        policy: CLOSED_POLICY,
        warning: `AS3B_CONFIG names ${path}, which does not exist — NetBox and BIG-IP apply are disabled until it is fixed.`,
      };
    return {
      policy: CLOSED_POLICY,
      warning: `Could not read ${path}: ${(err as Error).message} — NetBox and BIG-IP apply are disabled until it is fixed.`,
    };
  }
  try {
    return { policy: parsePolicy(JSON.parse(text)) };
  } catch (err) {
    return {
      policy: CLOSED_POLICY,
      warning: `${path} is not a valid policy file (${(err as Error).message}) — NetBox and BIG-IP apply are disabled until it is fixed.`,
    };
  }
}

type Env = Record<string, string | undefined>;

/** "0"/"false"/"no"/"off" are false; anything else set is true. */
function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(value.trim());
}

/**
 * Passwords and tokens are only handed to the page when the operator opts in.
 * Hostnames and usernames always prefill — they are not secrets, and they are
 * the tedious part to retype.
 *
 * Dev defaults to allowing them: a .env on a developer's own machine is the
 * whole point. A deployed server defaults to withholding them, so running the
 * published image with credentials in its environment does not hand them to
 * every browser that loads the page.
 */
export function credentialsAllowed(env: Env, isDev: boolean): boolean {
  return flag(env.AS3B_EXPOSE_CREDENTIALS, isDev);
}

/**
 * A NetBox URL pointing at this server's own origin is always a mistake, and a
 * silent one: the request lands on the SPA fallback and comes back as HTML
 * with a 200 rather than an error. It happens whenever a .env written for the
 * dev server is handed to the container, where "localhost" is the container.
 */
function selfReferenceWarning(url: string, selfPort: number | undefined): string | undefined {
  if (!url.trim() || selfPort === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    parsed.hostname
  );
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  if (!isLoopback || port !== selfPort) return undefined;
  return `NETBOX_URL is ${url}, which is this server itself — inside a container "localhost" is the container, not your machine. Use the host's address (host.docker.internal on Docker Desktop) or NetBox's real hostname.`;
}

export function readAppConfig(
  env: Env,
  isDev: boolean,
  selfPort?: number,
  policyLoad: PolicyLoad = { policy: DEFAULT_POLICY }
): AppConfig {
  const withSecrets = credentialsAllowed(env, isDev);
  const secret = (value: string | undefined) =>
    withSecrets ? (value ?? "") : "";
  return {
    bigip: {
      host: env.BIGIP_HOSTNAME ?? "",
      username: env.BIGIP_USERNAME ?? "",
      password: secret(env.BIGIP_PASSWORD),
      validateCert: flag(env.BIGIP_VALIDATE_CERTS, true),
    },
    netbox: {
      url: env.NETBOX_URL ?? "",
      token: secret(env.NETBOX_TOKEN),
      username: env.NETBOX_USERNAME ?? "",
      password: secret(env.NETBOX_PASSWORD),
      validateCert: flag(env.NETBOX_VALIDATE_CERTS, true),
    },
    includesCredentials: withSecrets,
    warnings: [
      selfReferenceWarning(env.NETBOX_URL ?? "", selfPort),
      policyLoad.warning,
    ].filter((w): w is string => w !== undefined),
    policy: policyLoad.policy,
  };
}

/** Command-line overrides, so a single run can target a different device. */
export function applyArgv(env: Env, argv: string[]): Env {
  const FLAGS: Record<string, string> = {
    "--bigip-host": "BIGIP_HOSTNAME",
    "--bigip-username": "BIGIP_USERNAME",
    "--bigip-password": "BIGIP_PASSWORD",
    "--bigip-validate-certs": "BIGIP_VALIDATE_CERTS",
    "--netbox-url": "NETBOX_URL",
    "--netbox-token": "NETBOX_TOKEN",
    "--netbox-username": "NETBOX_USERNAME",
    "--netbox-password": "NETBOX_PASSWORD",
    "--netbox-validate-certs": "NETBOX_VALIDATE_CERTS",
    "--config": "AS3B_CONFIG",
  };
  const out: Env = { ...env };
  for (let i = 0; i < argv.length; i++) {
    const key = FLAGS[argv[i]];
    if (key && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

export function serveAppConfig(
  res: ServerResponse,
  env: Env,
  isDev: boolean,
  selfPort?: number,
  policyLoad?: PolicyLoad
): void {
  const body = JSON.stringify(readAppConfig(env, isDev, selfPort, policyLoad));
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  // Credentials must never sit in a cache.
  res.setHeader("cache-control", "no-store");
  res.end(body);
}

export function isAppConfigRequest(req: IncomingMessage): boolean {
  return (req.url ?? "").split("?")[0] === "/app-config";
}
