# Support policy plan: deployment configuration + unsupported-item blacklist

Two requested changes, planned as one feature area because the second is the
elaborated half of the first:

1. A **configuration file** with feature gates (NetBox on/off, BIG-IP apply
   on/off) and a blacklist of unsupported tree items with hard/soft modes.
2. The **blacklist behaviour** itself: hard = hidden/disabled, soft = usable
   but visibly flagged with an are-you-sure on add.

Written to be executable by any implementer without this conversation's
context. Follows the conventions already in the codebase; every file it names
exists today unless marked NEW.

## 1. Where the configuration lives

A JSON file on the **server's** filesystem, served to the page through the
existing `/app-config` endpoint — the same pattern `.env` connection defaults
use (`server/appConfig.ts`), for the same reason: nothing baked into the
published container image, one image serves every deployment.

- Path from `AS3B_CONFIG` (env or `--config` flag via `applyArgv`), default
  `./as3b-config.json`. Missing file = everything enabled, empty blacklist —
  today's behaviour, zero migration.
- A malformed file must NOT fall back silently to "everything enabled": that
  fails open. Serve the parse error in the existing `warnings` array AND
  treat gates as **closed** (netbox off, apply off) until fixed. Fail closed,
  loudly.
- `.env` stays for connection defaults and secrets. The config file is for
  policy, which is structured (lists, per-item modes) and not secret. Do not
  merge the two concerns.
- Committed in-repo: `as3b-config.example.json` (NEW) documenting every key.
  `docker-compose.yml` gains a commented volume-mount line for it.
- Loaded once at boot, like the rest of `/app-config`. Live reload is out of
  scope; a page refresh picks up changes.

### Schema (`as3b-config.json`)

```json
{
  "features": {
    "netbox": true,
    "bigipApply": true
  },
  "unsupported": [
    {
      "class": "Service_L4",
      "mode": "hard",
      "reason": "L4 services are handled by the NetScaler estate"
    },
    {
      "class": "Monitor",
      "when": { "monitorType": "sip" },
      "mode": "soft",
      "reason": "SIP monitors are untested here — verify with the LB team"
    }
  ]
}
```

- `features.*` absent → `true`. An entry's `mode` absent → `"soft"` (the
  less destructive default).
- `when` is an optional equality matcher on the object's own properties,
  because "specific types of monitors" is one class (`Monitor`) discriminated
  by `monitorType` — a class-only list cannot express it. Multiple `when`
  keys AND together. No operators beyond equality until a real need appears.
- `reason` feeds tooltips and the are-you-sure dialog. Optional but strongly
  encouraged; the UI falls back to "marked unsupported by this deployment's
  configuration".

## 2. Engine: `src/engine/supportPolicy.ts` (NEW)

Pure and unit-tested, like `readOnly.ts` which it deliberately mirrors:

```ts
export interface UnsupportedRule {
  class: string;
  when?: Record<string, unknown>;
  mode: "hard" | "soft";
  reason?: string;
}

export interface SupportPolicy {
  netbox: boolean;
  bigipApply: boolean;
  unsupported: UnsupportedRule[];
}

/** Everything-enabled policy: the absence of configuration. */
export const DEFAULT_POLICY: SupportPolicy;

/** Parse + validate the config file's JSON. Throws with a line-item message
 *  on bad shape (the server turns that into a warning + closed gates). */
export function parsePolicy(raw: unknown): SupportPolicy;

/** The rule matching a document value, or undefined. Class match first,
 *  then every `when` key equal on the value itself. First rule wins. */
export function unsupportedOf(
  policy: SupportPolicy,
  value: Record<string, unknown>
): UnsupportedRule | undefined;

/** For pickers, where there is no value yet. A class-only rule matches
 *  outright. Rules WITH a `when` clause cannot block adding the bare class
 *  (the discriminator property does not exist yet) but ARE surfaced: the
 *  result carries them as `variants`, so the picker can note "some variants
 *  unsupported (sip)" on the item and in its detail card. */
export function unsupportedClassOf(
  policy: SupportPolicy,
  className: string
): { rule?: UnsupportedRule; variants: UnsupportedRule[] };

/** Audit a whole document: every path whose object matches a rule. Feeds
 *  the issues bar and the apply-time summary. */
export function auditUnsupported(
  policy: SupportPolicy,
  doc: unknown
): { path: JsonPath; rule: UnsupportedRule }[];
```

Wire through `src/engine/index.ts` like every other module.

## 3. Serving and client plumbing

- `server/appConfig.ts`: read `AS3B_CONFIG`, parse with `parsePolicy`, attach
  as `policy` on the `/app-config` response. Parse failure → `warnings` entry
  - gates closed (see §1). Add to `applyArgv`: `--config`.
- `src/appConfig.ts`: extend `AppConfig` with `policy: SupportPolicy`;
  `EMPTY_APP_CONFIG.policy = DEFAULT_POLICY`.
- `src/App.tsx`: hold `policy` in state from `loadAppConfig()` (exactly like
  `configWarnings` today) and pass it down. No context provider — the app
  passes props everywhere else; stay consistent.

## 4. Feature gates

### 4.1 NetBox gate (`features.netbox: false`)

- Toolbar: "Load from NetBox…" and "Push to NetBox…" not rendered (hidden,
  not disabled — a disabled button invites "why?", a hidden one doesn't
  advertise a capability the deployment has switched off). The push-preview
  badge computation short-circuits to undefined.
- Deep-link params (`?netbox=…`) ignored, with a console warning.
- **Server enforcement** (`server/index.ts` + vite middleware): when the gate
  is off, `/netbox-proxy/*` returns 403
  `{"error":"NetBox support is disabled by this deployment's configuration"}`.
  The hidden buttons are UX; the 403 is the actual control — anyone can talk
  to the proxy with curl.

### 4.2 BIG-IP apply gate (`features.bigipApply: false`)

- `BigipDialog`: the Apply… button is not rendered; the three-gate confirm
  flow is unreachable. Validate/dry-run untouched — that is the explicit
  requirement.
- **Server enforcement**: the bigip proxy inspects `POST`/`PATCH` bodies to
  `/mgmt/shared/appsvcs/declare*`. The body is already buffered (`withBody`
  in `server/proxy.ts`), so parse it: allow only when
  `controls.dryRun === true`; otherwise 403
  `{"error":"Applying to a BIG-IP is disabled by this deployment's configuration (dry-run is allowed)"}`.
  GETs (Load from BIG-IP) and `/info` pass. Non-JSON or unparseable bodies
  are rejected when the gate is off — fail closed.
- Note in code why enforcement lives in the proxy: the client sets
  `controls.dryRun` itself, so a client-only gate would be decorative.

## 5. Blacklist behaviour in the UI

New badge vocabulary entry: **`unsupported`** — joins `read-only`,
`external`, `linked`, `edited`. Style like `.obj-readonly` but in the danger
palette (border `var(--danger)`, text `var(--danger-dark)`; dark-theme
equivalents exist). Tooltip = rule `reason`.

### 5.1 Soft mode

- **Pickers** (`ContextPanel` classItems, class dropdown, `AddableList`):
  item stays listed, tagged `unsupported`, detail card shows the reason.
  Classes with only `when`-scoped rules carry a lighter note — "some
  variants unsupported (sip)" — on the picker item and detail card, per
  decision #4.
- **Adding** (the `+` button, drag-drop via `handleChipDrop`, class change
  via `handleClassChange`): one are-you-sure. Reuse the `modal-confirm`
  pattern from `BigipDialog` (single gate, not three):
  "Service_L4 is marked unsupported: *<reason>*. Add it anyway?" /
  [Cancel] [Add anyway]. The drag path must funnel through the same guard —
  put the guard in `App`'s add/drop/class-change handlers, not in each
  widget.
- **Rendering** (`SimplifiedPane` cards/rows, `TreePane` labels): matching
  objects get the badge + a `.unsupported-item` tint (danger-soft
  background). `immutabilityOf`-style helper call in `ObjectCard`; the
  `when`-matcher means a Monitor card gains/loses the badge live as its
  `monitorType` changes — that falls out free because badges compute from
  the value on every render.
- Editing inside a soft item stays fully enabled. Soft = "you may, and
  everyone will see that you did".

### 5.2 Hard mode

- **Pickers**: the class does not appear at all — filtered out of
  `classItems`, the class dropdown, and drop resolution rejects the payload
  with a toast-style message rather than silently no-op'ing.
- **Already-present items** (loaded from NetBox, a BIG-IP, or a file): NOT
  hidden. Hiding misrepresents the document and silently drops the object on
  the next save/apply round-trip — worse than any inconsistency. Instead:
  badge `unsupported` + the danger tint, inline editing disabled for the
  subtree (same mechanism as read-only would use), delete still allowed so
  the user can bring the document into compliance. ⚠ DECISION POINT: this
  deviates from the letter of "hide completely" for existing content; see §8.
- **JSON view**: Monaco cannot hide lines usefully. Hard items present in
  the text surface in the issues bar (§5.3). Typing one in raw JSON cannot
  be prevented — the audit is the net.

### 5.3 Audit surface

`auditUnsupported` runs where the Ajv issues list is built
(`useValidation` / issues bar): each match appears as a warning row —
"`web` (Service_L4) is unsupported here: *<reason>*" — click-to-jump like
schema errors. The BIG-IP dialog's dry-run/apply step lists unsupported items
present in the declaration before submitting (informational for dry-run;
for apply it is one more thing the three-gate confirm shows). Nothing is
ever silently stripped from a payload.

## 6. Tests

- `src/engine/__tests__/supportPolicy.test.ts` (NEW): parsePolicy happy/`
  malformed paths, class match, `when` match (monitorType), first-rule-wins,
  class-only picker match excluding `when` rules, auditUnsupported paths.
- `src/engine/__tests__/appConfig.test.ts`: extend — file merge, malformed
  file → warning + gates closed, `--config` flag.
- Component tests (`src/components/__tests__/`): soft item tagged in picker;
  variant-scoped note shown on a class whose rules are all `when`-scoped;
  add-anyway dialog appears and cancel adds nothing; hard class absent from
  picker; existing hard item badged, edit-locked, deletable; toolbar without
  NetBox buttons when gated.
- Server: unit-test the proxy decision function (extract
  `applyAllowed(method, path, body, policy)` so it is testable without
  sockets); manual curl verification of both 403s against the dev server and
  the container.

## 7. Delivery: two PRs

- **PR A — config + gates.** §1–§4: file, parsing, serving, engine module,
  NetBox gate, apply gate, server enforcement, example file, compose mount,
  README. Ships value alone (the gates) and everything B needs.
- **PR B — blacklist UI.** §5–§6 UI parts: badges, picker filtering/tagging,
  add-anyway guard, hard lock, audit surface. Depends on A.

## 8. Decision points — RESOLVED (user, 2026-08-18)

1. **Hard mode vs. already-present items:** badge + lock + deletable, never
   hidden. Confirmed as recommended.
2. **Apply gate scope:** proxy-level 403 enforcement is right — deployment
   policy for this tool, not a device ACL. Confirmed as recommended.
3. **Hard items vs. Validate:** allowed; the dialog lists them before
   submitting. Confirmed as recommended.
4. **`when` rules in pickers:** warn at the picker too — items whose class
   has variant-scoped rules carry a "some variants unsupported (…)" note in
   the picker and detail card, in addition to flagging when the property is
   actually set. (User chose the stronger option over the recommendation;
   `unsupportedClassOf` returns the variant rules to make this cheap.)

## 9. Out of scope (named so nobody wanders in)

- Per-user or per-role policy — this is per-deployment.
- Live config reload.
- Property-level blacklists beyond the `when` equality matcher (e.g. "no
  `virtualPort` below 1024") — that is validation's job, not policy's.
- Enforcing policy inside NetBox write-back (unsupported items push like
  anything else; the badge and audit are the signal).
