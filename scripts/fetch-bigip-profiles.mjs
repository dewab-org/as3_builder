#!/usr/bin/env node
// Builds the catalogue of /Common objects an AS3 declaration can point at but
// never defines: the profiles, persistence methods and monitors F5 ships with
// a BIG-IP. The builder offers these as external ({bigip: …}) options.
//
//   BIGIP_PASSWORD=… node scripts/fetch-bigip-profiles.mjs --host bigip01
//
// Re-run it after a BIG-IP upgrade; the output records which device and
// version it came from, so a stale catalogue is obvious.
//
// The password comes from the environment on purpose — a command-line
// argument is visible in the process list and shell history.

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { request } from "node:https";

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

const HOST = option("--host", "bigip01");
const USERNAME = option("--username", "admin");
const OUTPUT = resolve(
  option("--output", "src/schemas/bigip-common-catalog.json")
);
const VALIDATE_CERT = process.argv.includes("--validate-cert");
const PASSWORD = process.env.BIGIP_PASSWORD;

if (!PASSWORD) {
  console.error(
    "Set BIGIP_PASSWORD in the environment (not as an argument — it would be visible in the process list)."
  );
  process.exit(2);
}

// AS3 property ↔ iControl collection. Names AS3 does not expose are still
// catalogued (as3Property null) so the list stays complete for future use.
const PROFILE_TYPES = [
  { path: "ltm/profile/tcp", as3Property: "profileTCP" },
  { path: "ltm/profile/udp", as3Property: "profileUDP" },
  { path: "ltm/profile/fastl4", as3Property: "profileL4" },
  { path: "ltm/profile/http", as3Property: "profileHTTP" },
  { path: "ltm/profile/http2", as3Property: "profileHTTP2" },
  { path: "ltm/profile/http-compression", as3Property: "profileHTTPCompression" },
  { path: "ltm/profile/one-connect", as3Property: "profileMultiplex" },
  // AS3 names TLS from the declaration's point of view: serverTLS is the
  // client-side profile, clientTLS the server-side one.
  { path: "ltm/profile/client-ssl", as3Property: "serverTLS" },
  { path: "ltm/profile/server-ssl", as3Property: "clientTLS" },
  { path: "ltm/profile/ftp", as3Property: "profileFTP" },
  { path: "ltm/profile/sip", as3Property: "profileSIP" },
  { path: "ltm/profile/rtsp", as3Property: "profileRTSP" },
  { path: "ltm/profile/tftp", as3Property: "profileTFTP" },
  { path: "ltm/profile/icap", as3Property: "profileICAP" },
  { path: "ltm/profile/stream", as3Property: "profileStream" },
  { path: "ltm/profile/rewrite", as3Property: "profileRewrite" },
  { path: "ltm/profile/dns", as3Property: "profileDNS" },
  { path: "ltm/profile/radius", as3Property: "profileRADIUS" },
  { path: "ltm/profile/sctp", as3Property: "profileSCTP" },
  { path: "ltm/profile/ipother", as3Property: "profileIPOther" },
  { path: "ltm/profile/websocket", as3Property: null },
  { path: "ltm/profile/html", as3Property: null },
  { path: "ltm/profile/web-acceleration", as3Property: null },
  { path: "ltm/profile/request-log", as3Property: null },
  { path: "ltm/profile/statistics", as3Property: null },
];

const PERSISTENCE_TYPES = [
  "cookie",
  "dest-addr",
  "hash",
  "msrdp",
  "sip",
  "source-addr",
  "ssl",
  "universal",
].map((t) => ({ path: `ltm/persistence/${t}`, as3Property: "persistenceMethods" }));

const MONITOR_TYPES = [
  "http",
  "https",
  "tcp",
  "udp",
  "icmp",
  "gateway-icmp",
  "tcp-half-open",
  "external",
  "ldap",
  "dns",
  "sip",
  "smtp",
  "mysql",
  "postgresql",
].map((t) => ({ path: `ltm/monitor/${t}`, as3Property: "monitors" }));

// Bookkeeping iControl returns on every object; none of it describes settings.
const NOISE = new Set([
  "kind",
  "selfLink",
  "generation",
  "fullPath",
  "name",
  "partition",
  "subPath",
  "appService",
  "tmPartition",
  "certReference",
  "keyReference",
  "chainReference",
  "defaultsFromReference",
  "sslProfileReference",
]);

function get(path) {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      {
        host: HOST,
        port: 443,
        path: `/mgmt/tm/${path}`,
        method: "GET",
        rejectUnauthorized: VALIDATE_CERT,
        timeout: 30000,
        headers: {
          authorization: `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64")}`,
          accept: "application/json",
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode !== 200) {
            reject(new Error(`GET ${path} → HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          try {
            resolvePromise(JSON.parse(body));
          } catch {
            reject(new Error(`GET ${path} → unparseable response`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** Settings of an object, minus links and bookkeeping. */
function settingsOf(item) {
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    if (NOISE.has(key)) continue;
    if (key.endsWith("Reference")) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) continue;
    out[key] = value;
  }
  return out;
}

async function collect({ path, as3Property }) {
  let body;
  try {
    body = await get(path);
  } catch (err) {
    // A profile type can be absent when its module is not provisioned.
    console.warn(`  skipped ${path}: ${err.message.split("\n")[0]}`);
    return [];
  }
  const items = (body.items ?? []).filter((i) => i.partition === "Common");
  const byFullPath = new Map(items.map((i) => [i.fullPath, i]));
  return items.map((item) => {
    const settings = settingsOf(item);
    const parent = item.defaultsFrom ? byFullPath.get(item.defaultsFrom) : undefined;
    // What this profile changes relative to the one it derives from is the
    // part an operator actually chooses on.
    let differsFromParent;
    if (parent) {
      const parentSettings = settingsOf(parent);
      differsFromParent = {};
      for (const [key, value] of Object.entries(settings)) {
        if (key === "defaultsFrom") continue;
        if (JSON.stringify(parentSettings[key]) !== JSON.stringify(value))
          differsFromParent[key] = value;
      }
    }
    return {
      name: item.name,
      fullPath: item.fullPath,
      collection: path,
      as3Property,
      defaultsFrom: item.defaultsFrom ?? null,
      settings,
      ...(differsFromParent ? { differsFromParent } : {}),
    };
  });
}

const version = await get("sys/version");
const versionEntry = Object.values(version.entries ?? {})[0]?.nestedStats?.entries ?? {};
const deviceVersion = versionEntry.Version?.description ?? "unknown";
const deviceBuild = versionEntry.Build?.description ?? "unknown";

const ready = await get("sys/ready").catch(() => null);
const readyEntries =
  Object.values(ready?.entries ?? {})[0]?.nestedStats?.entries ?? {};
const notReady = Object.entries(readyEntries)
  .filter(([, v]) => v.description !== "yes")
  .map(([k]) => k);
if (notReady.length > 0) {
  console.error(
    `${HOST} reports ${notReady.join(", ")} — an unlicensed or unloaded device has no built-in profiles to read. Aborting rather than writing an empty catalogue.`
  );
  process.exit(3);
}

const entries = [];
for (const type of [...PROFILE_TYPES, ...PERSISTENCE_TYPES, ...MONITOR_TYPES]) {
  const found = await collect(type);
  entries.push(...found);
  console.log(`  ${type.path}: ${found.length}`);
}
entries.sort((a, b) => a.fullPath.localeCompare(b.fullPath));

const catalog = {
  format: "bigip-common-catalog",
  formatVersion: 1,
  generatedFrom: {
    host: HOST,
    version: deviceVersion,
    build: deviceBuild,
    // Identifies the exact content without embedding a timestamp, so an
    // unchanged device produces an unchanged file.
    digest: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
  },
  entries,
};

await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(
  `wrote ${entries.length} objects from ${HOST} (${deviceVersion} build ${deviceBuild}) to ${OUTPUT}`
);
