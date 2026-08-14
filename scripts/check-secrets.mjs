#!/usr/bin/env node
// Scans staged content for credentials. gitleaks does the heavy lifting when
// it is installed; these rules run everywhere and cover what this project is
// actually likely to leak — BIG-IP and NetBox credentials.
//
// Test fixtures and this file's own patterns are excluded, and the ephemeral
// NetBox container's admin/admin is explicitly allowed (documented in README).

import { execFileSync } from "node:child_process";

// Generous: the generated schema artifacts are excluded by path anyway, and a
// scanner that skips silently is worse than no scanner.
const MAX_BYTES = 64_000_000;

const SKIP_PATH = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)__tests__\//,
  /(^|\/)scripts\/check-secrets\.mjs$/,
  /^src\/schemas\//,
  /^dist\//,
];

// Values that look like secrets but are not: the throwaway NetBox container,
// documentation placeholders, and schema example hostnames.
const ALLOW_VALUE =
  /^(admin|password|passwd|secret|token|bearer|none|null|undefined|changeme|example|placeholder|your[-_]?\w*|<[^>]+>|\$\{[^}]+\}|\*+|x+|1234\d*)$/i;

// SCREAMING_SNAKE values are environment variable names, not their values —
// a mapping table like {"--netbox-password": "NETBOX_PASSWORD"} is config, not
// a leak. A real secret in that shape would have to be all-caps with no
// lowercase at all, which no generated credential is.
const ENV_VAR_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

const RULES = [
  {
    name: "private key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
  },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "NetBox API token", re: /\bnbt_[A-Za-z0-9]{10,}\.[A-Za-z0-9]{10,}\b/ },
  { name: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  // key = "value" / "key": "value" — the value is captured so it can be
  // checked against ALLOW_VALUE before we cry wolf.
  {
    name: "hardcoded credential",
    // No leading \b: camelCase names like bigipPassword must match too.
    re: /(?:password|passwd|passphrase|secret|api[-_]?key|auth[-_]?token|access[-_]?token|credential)["'\s]*[:=]\s*["'`]([^"'`\n]{4,})["'`]/i,
    valueGroup: 1,
  },
];

function staged() {
  const out = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { encoding: "utf8" }
  );
  return out.split("\0").filter(Boolean);
}

const skipped = [];

function stagedContent(file) {
  try {
    return execFileSync("git", ["show", `:${file}`], {
      encoding: "utf8",
      maxBuffer: MAX_BYTES,
    });
  } catch (err) {
    // Binary content is genuinely nothing to scan; anything else (too large
    // to buffer, unreadable) is a gap the committer needs to know about.
    if (!/binary/i.test(String(err?.message))) skipped.push(file);
    return undefined;
  }
}

const findings = [];
for (const file of staged()) {
  if (SKIP_PATH.some((re) => re.test(file))) continue;
  const content = stagedContent(file);
  if (content === undefined) continue;
  const lines = content.split("\n");
  for (const rule of RULES) {
    for (const [i, line] of lines.entries()) {
      const m = rule.re.exec(line);
      if (!m) continue;
      const value = rule.valueGroup ? m[rule.valueGroup] : undefined;
      const trimmed = value?.trim();
      if (trimmed !== undefined && (ALLOW_VALUE.test(trimmed) || ENV_VAR_NAME.test(trimmed)))
        continue;
      findings.push({ file, line: i + 1, rule: rule.name, text: m[0] });
    }
  }
}

if (skipped.length > 0) {
  console.error(
    `check-secrets: NOT scanned (too large or unreadable): ${skipped.join(", ")}`
  );
}

if (findings.length > 0) {
  console.error("Possible secrets in staged changes:\n");
  for (const f of findings) {
    const shown = f.text.length > 80 ? `${f.text.slice(0, 77)}…` : f.text;
    console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${shown}`);
  }
  console.error(
    "\nRemove them, or if these are false positives commit with --no-verify."
  );
  process.exit(1);
}
