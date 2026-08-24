# AS3 Builder

A schema-aware web editor for F5 **AS3 per-app declarations**, with two-way
**NetBox** integration (read applications rendered as AS3, push edits back)
and **BIG-IP dry-run/apply** support.

Everything runs in the browser plus a small dev-server proxy — there is no
backend service.

```text
┌────────────────────────────────────────────────────────────────────┐
│ Schema ▾  Template ▾   Load from NetBox…  Push to NetBox…          │
│                        Validate on BIG-IP…  Open  Save  ☾          │
├───────────┬─────────────────────────────────┬──────────────────────┤
│ Document  │  Editor (JSON ⇄ Simple toggle)  │ Context panel        │
│ tree      │  Monaco with schema validation, │ schema-aware widgets │
│           │  autocomplete, click-to-pick    │ add-lists, docs      │
├───────────┴─────────────────────────────────┴──────────────────────┤
│ ◎ breadcrumb of cursor · drop target        ✓ schema valid / ✗ N   │
└────────────────────────────────────────────────────────────────────┘
```

## Running

```bash
npm install
npm run dev        # http://localhost:5173 (opens in the simplified view)
npm test           # engine test suite (vitest)
npm run lint       # eslint
npm run build      # production build in dist/
```

`npm install` points git at `.githooks/`, which installs a **pre-commit hook**
that scans staged content for credentials (`scripts/check-secrets.mjs`, plus
`gitleaks protect --staged` when gitleaks is installed), runs `trivy fs` for
dependency CVEs, runs `trivy config` when the Dockerfile changed, delegates
per-file-type linting to the **pre-commit framework**
(`.pre-commit-config.yaml`: eslint, hadolint for Dockerfiles, yamllint,
markdownlint, shellcheck, `docker compose config` validation, actionlint — run
everything by hand with `pre-commit run --all-files`), and — when TypeScript
or JavaScript is staged — runs `tsc -b` and the test suite. Enable it by hand
with `git config core.hooksPath .githooks`, bypass one commit with
`git commit --no-verify`. `brew install pre-commit` if the linter step reports
itself missing.

The trivy steps gate on CRITICAL/HIGH with a fix available, and are skipped
(with a note) when trivy isn't installed. Image scanning needs a full `docker
build`, so it stays out of the commit path: run `npm run scan:image` for it, or
set `AS3B_SCAN_IMAGE=1` to have the hook do it too. `npm run scan` runs the two
fast scans by hand.

The ephemeral NetBox container's `admin`/`admin` is allowlisted in the secret
scan, as are documentation placeholders; test fixtures and generated schema
artifacts under `src/schemas/` are skipped.

### Connection defaults

Copy `.env.example` to `.env` and fill in whatever you use often:

```bash
BIGIP_HOSTNAME=      BIGIP_USERNAME=      BIGIP_PASSWORD=      BIGIP_VALIDATE_CERTS=
NETBOX_URL=          NETBOX_TOKEN=                             NETBOX_VALIDATE_CERTS=
                     NETBOX_USERNAME=     NETBOX_PASSWORD=
```

The dialogs prefill from these. NetBox takes **either** an API token (v2
`nbt_key.secret`, a classic 40-character key, or a full `Bearer …`/`Token …`
header pasted verbatim) **or** a username and password, which provisions a
token on connect — pick one in the dialog's "Authenticate with" selector.

Precedence is `.env` → real environment → command-line flags, so a single run
can target something else without editing anything:

```bash
npm run dev -- --bigip-host bigip02 --netbox-url https://netbox.example.com
```

Values are served at runtime from `/app-config`, never compiled into the
bundle — which is why the published image carries none of them. A deployed
server withholds passwords and tokens from the page (hostnames and usernames
still prefill) unless you set `AS3B_EXPOSE_CREDENTIALS=1`; the dev server
exposes them, since a local `.env` is the whole point. `.env` is gitignored.

### Deployment policy

`as3b-config.json` (path via `AS3B_CONFIG` or `--config`; see
`as3b-config.example.json`) sets per-deployment policy: `features.netbox`
and `features.bigipApply` gates, plus an `unsupported` class blacklist with
hard/soft/review modes. **Soft** items stay usable but carry an
`unsupported` badge (danger palette) wherever they appear — cards, tree,
picker — with the rule's reason as tooltip, and adding a soft-blacklisted
class asks once. **Review** items are supported but each use needs a human
look: same behaviour as soft, badged `requires review` in the warning
palette instead, and the add prompt is worded accordingly. **Hard** classes
vanish from the pickers entirely; already-present hard items are badged
`unsupported · locked` with editing disabled and delete still available
(never hidden — hiding drops them silently on the next round-trip). Variant rules (`when`) note themselves on the class's picker row
and flag the object the moment the property matches. Every match is listed
in the issues bar (click-to-jump), counted in the status bar, and enumerated
in the BIG-IP dialog before a dry-run or apply — payloads are never silently
stripped.

Gating is enforced in the server, not just the UI: with NetBox off the
NetBox proxy answers 403, and with apply off the BIG-IP proxy refuses any
write to the AS3 declare endpoints unless its body carries
`controls.dryRun: true` — validate keeps working, applying does not, and an
unparseable body is refused rather than trusted. A missing file means
everything enabled; a **malformed or missing-but-named file closes both
gates** and says so in the Load dialog — a policy file must never fail open.

The **dev/preview server is required** for the NetBox and BIG-IP features:
browsers cannot call iControl REST or the NetBox API directly (no CORS
headers, self-signed certs), so `vite.config.ts` ships two proxy middlewares
(`/bigip-proxy/*`, `/netbox-proxy/*`) that forward requests with credentials
passed through per request. If you host `dist/` statically, put an
equivalent proxy in front.

## Docker

```bash
docker compose pull && docker compose up -d   # http://127.0.0.1:8088
```

The deployment compose runs the **published image**
(`ghcr.io/dewab-org/as3_builder:latest`); `pull` picks up new releases. To run
a build of your local checkout instead, use `docker-compose.testing.yml`.

Compose reads the same `.env` and sets `AS3B_EXPOSE_CREDENTIALS=1`, so the
container prefills exactly like the dev server. Two things differ inside a
container: it publishes on **8088**, because NetBox commonly holds 8080; and
`localhost` means the container, not your machine — a `NETBOX_URL` of
`http://localhost:8080` there resolves to the app itself and quietly returns
the SPA's HTML. The server detects that case and says so in the Load dialog;
use `host.docker.internal` (Docker Desktop) or NetBox's real hostname.

Prebuilt multi-arch images (linux/amd64 + linux/arm64) are published to GHCR by
`.github/workflows/docker-publish.yml` on every push to `main`, tagged `:main`,
`:sha-<commit>` and `:latest`; a `v*` tag adds the semver tags.

```bash
docker run --rm -p 8080:8080 --read-only --cap-drop ALL \
  --security-opt no-new-privileges ghcr.io/dewab-org/as3_builder:latest
```

The workflow runs lint, types and tests first, then builds, scans the image
with trivy (fixable CRITICAL/HIGH fails the run) and only then publishes with
build provenance and an SBOM attached. Pull requests build and scan but never
push.

The image is built in two stages: a Node builder that compiles the SPA and
bundles the server, and a **distroless** runtime (`nonroot`, uid 65532) with no
shell, no package manager and no `node_modules` — `server/index.ts` is bundled
into a single ~10KB file by esbuild, so nothing but Node and the built output
ships. Both base images are pinned by digest — the runtime is the Debian 13
(trixie) distroless variant, whose only trivy findings are unfixed MEDIUMs
shared by every glibc; the bookworm variant ships a libssl3 with a CRITICAL
that has an upstream fix but no rebuilt image. The container runs read-only with
all capabilities dropped and `no-new-privileges`; `docker-compose.yml` sets
those, a 16MB noexec tmpfs for `/tmp`, CPU/memory limits and log rotation, and
binds to loopback (the proxy routes reach whatever the container can route to,
so don't expose it wider by accident).

`server/index.ts` serves `dist/` and mounts the same `/bigip-proxy`,
`/netbox-proxy` and `/url-proxy` handlers the dev server uses — they live in
`server/proxy.ts` and are imported by both — so a deployed image keeps the
NetBox and BIG-IP features. It also sets a strict CSP, `nosniff`, `DENY`
framing, no-referrer and COOP/CORP, caps proxied request bodies at 16MB, and
exposes `/healthz` for the healthcheck. Hashed assets are cached immutably,
`index.html` never is.

Assets are precompressed at build time (`npm run precompress` writes `.br` and
`.gz` siblings) and served by content negotiation with `Vary: Accept-Encoding`,
so the runtime never compresses per request: the 5.2MB main bundle goes out as
1.0MB brotli or 1.3MB gzip. A `dist/` that hasn't been precompressed still
serves fine, just uncompressed.

One deliberate CSP concession: `script-src` includes `'unsafe-eval'` because
Ajv compiles each JSON Schema into a function at runtime, and "load schema from
URL" means that can't move to build time. Without it the app throws `EvalError`
and renders nothing. No third-party script origin is allowed, so there is no
external code to eval.

Scan it with `npm run scan:image` after a build. Expect 0 secrets,
0 misconfigurations, and 0 fixable OS vulnerabilities; anything else means the
pinned base digest has aged and wants refreshing.

## Editing features

- **Schema engine** (`src/engine/`, pure TypeScript, fully unit-tested):
  resolves which schema rule governs the JSON node under the cursor,
  including AS3's class-discriminated unions, `allOf` chains, and
  draft-07 `if/then/else`.
- **Context panel**: properties of the current object as typed widgets
  (enums/booleans as dropdowns, bounded numbers, live-validated strings —
  ports, `f5ip`/CIDR, hostnames, patterns), an alphabetical filterable
  add-list with drag/double-click/+ insertion, class-aware object creation,
  and cross-reference dropdowns (a Service's `pool` offers the Pools defined
  in the document).
- **Editor intelligence**: schema validation squiggles and autocomplete
  (Monaco), click an enum/boolean/reference value to get a pick list,
  hover a row for a margin ✕ that deletes the property/element, drag rows
  from the panel into the editor (nearest-valid-ancestor insertion).
- **Simple view**: JSON ⇄ Simple toggle renders the document as indented
  key-value pairs without JSON syntax. Click a key to focus, click a value
  to edit in place (schema-appropriate widget, popover for long text),
  Enter in a list commits and starts the next item, `+ add member`-style
  rows append schema-stubbed objects.
- **iRules edit as Tcl**: the `iRule` value opens a multi-line editor with
  Tcl syntax highlighting (Monaco, loaded on demand); the document keeps the
  `{"base64": …}` form at all times — encoding happens automatically on save,
  so NetBox pushes and BIG-IP submissions always carry base64. A plain-string
  iRule gets the same surface and becomes the wrapper on first save.
- **Class changes** populate missing required properties and list
  now-invalid leftovers with one-click removal. **Modified objects** (vs the
  loaded baseline) highlight amber in the tree and editor margin.
- **Docs everywhere**: hover/ⓘ cards show the full schema description,
  expanded behavior, rules (ranges, patterns, formats), defaults, union
  alternatives, documented TMOS/tmsh equivalencies, and a link to the exact
  section of the official F5 schema reference. The normalized, machine-readable
  index covers every definition and field in the bundled 3.56 schema.
- Light/dark theme (Home Depot palette), status-bar breadcrumb, Ajv error
  list with click-to-jump.

## NetBox integration

Works against the `netbox-load-balancer` plugin (tested with NetBox 4.6 /
plugin 0.7.0).

- **Load from NetBox…** — connect with URL + username/password (an API token
  is provisioned automatically; v1 and v2 token formats supported), pick an
  application (fuzzy search), and it renders as a per-app AS3 declaration —
  a TypeScript port of f5_toolbox's `graphql_to_as3` mapping, validated
  against its golden fixtures.
- **Push to NetBox…** — a provenance manifest recorded at load maps every
  AS3 object back to its NetBox endpoint/id. The push preview shows
  CREATE / UPDATE / DELETE rows with field-level diffs, granular ops
  (members, virtual addresses, monitor links, relation rewiring,
  `extra_parameters`), per-object drift detection (`last_updated`), and
  explicit "not pushed" notes for anything unsupported. Deletions are never
  pre-selected. IPs and certificate stubs are get-or-created as needed.
  Applying re-fetches and re-renders so the editor shows the round-tripped
  truth.
- **Deep links** (see `NETBOX-DEEPLINK-PLAN.md`):
  `/?netbox=<origin>&app=<id>&object=<endpoint>:<id>&focus=extra_parameters`
  opens the dialog prefilled, auto-loads the app, and jumps to the object.
  Credentials never ride in URLs.

Write-back requires loading through this tool in the same session (the
manifest is in-memory only). See `NETBOX-WRITEBACK-PLAN.md` for the design
and current limits (snat pools, policies, cipher groups, protocol profiles,
GSLB are read-only for now).

### Knowing what a push will do

The **Push to NetBox…** button carries two counts, computed from the live
document: how many writes a push would make, and — in warn colour — how many
edits it cannot push (a certificate, a merged policy, a pointer with no NetBox
row of its own). Both are visible before the dialog is opened.

When a run finishes it says what happened: `2 applied · 1 failed · 3 skipped
after the failure`. A failure stops the sequence, because later writes can
depend on earlier ones, so the rows it never reached are marked **skipped**
rather than left looking like they might still happen.

## Loading from a BIG-IP

**Load from BIG-IP…** reads the running configuration back through AS3's
per-application API: `GET /declare` names the tenants, and
`GET /declare/<tenant>/applications` returns each tenant's applications
already in the per-app shape this editor works on — no conversion, this is
what the device is actually serving. The picker groups applications by tenant
with a fuzzy filter; the loaded document's `id` records the device, tenant and
application it came from.

Two caveats. NetBox write-back does not apply to a document loaded this way
(it has no NetBox provenance — the Push dialog will say so), and the device
must have AS3 installed with something deployed through it; a device where
AS3 has never run has nothing to list. Credentials are shared with the
Validate/Apply dialog and prefill from `.env` like everything else.

## BIG-IP object catalogue

Profiles, persistence methods and monitors that ship in `/Common` are estate
objects: a declaration points at one with `{bigip: "/Common/tcp-lan-optimized"}`
and can never create or change it. `src/schemas/bigip-common-catalog.json` is
the list of them, generated from a real device:

```bash
BIGIP_PASSWORD=… npm run fetch:profiles -- --host bigip01
```

Re-run it after a BIG-IP upgrade — the file records the device, version and
build it came from, so a stale catalogue is visible rather than silently wrong.
The password comes from the environment because a command-line argument would
be visible in the process list. The script refuses to write anything if the
device reports `configReady`/`licenseReady`/`provisionReady` as no: an
unlicensed BIG-IP has no built-in profiles to read, and an empty catalogue
would look like "there are none" rather than "nothing was read".

For each object it records the full path, the AS3 property that accepts it,
every setting, and — for a derived profile — just the settings that differ from
the profile it derives from, which is the part an operator actually chooses on.

The shipped catalogue holds 108 objects read from `bigip01` (17.5.1.4 build
0.0.20). In the simplified view, any `use`/`bigip` pointer row offers them
under **"On the BIG-IP (/Common) — external"**; picking one rewrites the whole
pointer to `{bigip: "/Common/…"}`, and the card immediately takes the external
styling. NetBox write-back reports such a pointer as "not a NetBox object of
its own" rather than trying to relink to something that has no row there.

## BIG-IP validation

**Validate on BIG-IP…** asks for host, credentials, tenant (default
`Applications`), and a TLS-verification checkbox; it checks
`/mgmt/shared/appsvcs/info` first, then submits the declaration with
`controls.dryRun: true` (no changes) to
`/mgmt/shared/appsvcs/declare/<tenant>/applications`.

Certificates are swapped for a disposable placeholder **on dry runs only**
(`src/engine/dryRunCertificate.ts`): NetBox stores certificate metadata, not
the material, so AS3 would fail on the certificate and tell you nothing about
the rest of the declaration. The dialog names every key it substituted — what
the BIG-IP validated is not your real certificate. An apply always sends the
declaration as written.

**Applying belongs in the Ansible workflow.** The **Apply…** button here is a
deliberate exception and is gated three times: an explanation that this
bypasses Ansible, then a prompt to type the target host (which also reports
whether a dry run was done against that host/tenant this session and whether it
passed), then a final confirmation naming the host and warning that AS3 removes
applications missing from the declaration.

## Contributing

New features and major changes go on a branch and through a pull request —
a new capability, a new dependency, a new deployment surface, or a change to
how write-back or apply behaves. Small fixes, doc tweaks and follow-up
corrections can land on `main` directly.

The pre-commit hook runs on either path; see **Running** above for what it
checks and how to bypass it when you must.

## Repository documents

| File | Purpose |
| --- | --- |
| `PLAN.md` | Original build specification (phases 1–5, engine contracts) |
| `NETBOX-WRITEBACK-PLAN.md` | Write-back design (manifest, ChangeSet, phases W1–W4 — all implemented) |
| `NETBOX-DEEPLINK-PLAN.md` | NetBox→builder deep-link contract + future plugin callout |
| `SUPPORT-POLICY-PLAN.md` | Planned: deployment config file (feature gates) + unsupported-item blacklist with hard/soft modes |

## Notes

- Schemas live in `src/schemas/`; the per-app schema is the default, the two
  full AS3 schemas are code-split and load on selection.
- `src/schemas/as3-documentation-3.56.0-10.json` is the generated documentation
  overlay consumed by the detail cards. Run `npm run generate:docs` after
  changing the source schema or curated behavior/tmsh mappings in
  `scripts/generate-as3-documentation.mjs`.
- The bundled schemas mirror the authoritative local copies under
  `../baseconfig/docs/bigip_as3/`. To generate directly from that source and
  record its SHA-256 provenance, run
  `npm run generate:docs -- --schema ../baseconfig/docs/bigip_as3/as3-schema-3.56.0-10.json`.
- Expanded behavior and tmsh names come from the Apache-2.0-licensed AS3
  v3.56 implementation's `src/lib/classes.js` and `src/lib/properties.json`.
  Their normalized snapshot is bundled as
  `src/schemas/as3-implementation-mappings-3.56.0-10.json`. Refresh it from an
  AS3 source checkout with `--as3-source <path> --mappings-output
  src/schemas/as3-implementation-mappings-3.56.0-10.json`; normal generation
  uses the snapshot and therefore never degrades to schema-only mappings.
- Versioning uses a two-part scheme (0.05, 0.06, …) shown in the About
  dialog (click the **AS3 Builder** title in the toolbar). `src/version.ts` is the source of truth;
  `package.json` carries the semver mirror (0.05 → 0.5.0, semver forbids
  leading zeros) and a test keeps the two in lockstep — bump both.
- Monaco is bundled locally (no CDN) for restricted environments, and loaded
  on demand: the simplified view is the default, so the editor and its workers
  are only fetched when the JSON view is first opened. That keeps the entry
  chunk at ~1.2MB (254kB gzipped) instead of ~5.2MB (1.29MB). Once opened it
  stays mounted so its undo stack and scroll position survive toggling.
- Tests come in two flavours: `src/engine/__tests__/` is pure and runs in
  node; `src/components/__tests__/` renders real components in jsdom
  (`vitest.config.ts` picks the environment per path). Component tests drive
  the DOM the way a person does — clicking a value, not calling the handler —
  because the bug that motivated them was a click that never reached the
  cursor.
- The engine test suite (`src/engine/__tests__/`) runs against the real
  1.2MB per-app schema and f5_toolbox's golden render fixture; the
  render→invert round trip producing an empty ChangeSet is a test invariant.
