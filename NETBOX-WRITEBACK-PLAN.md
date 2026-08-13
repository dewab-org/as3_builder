# NetBox Write-Back — Design Plan

> Status: PLANNING. Nothing in this document is implemented yet.
> Audience: an AI coding assistant or developer with no prior context.
> Prerequisite reading: PLAN.md (the builder) and src/engine/netboxAs3.ts
> (the NetBox→AS3 renderer this plan inverts).

## 1. Goal

Today the builder READS load-balancer applications from NetBox (rendered as
per-app AS3). This plan adds the reverse: after editing the declaration in
the builder, push the changes BACK to NetBox so NetBox remains the source of
truth. BIG-IP deployment stays f5_toolbox's job; we only write NetBox.

## 2. Facts that shape the design

1. **The plugin API is full CRUD.** Every endpoint under
   `/api/plugins/netbox-load-balancer/` is a stock `NetBoxModelViewSet`
   (POST/PATCH/DELETE all work). There is no AS3-ingest endpoint — we must
   write per-object.
2. **AS3 keys are sanitized NetBox names** (lossy: truncation, character
   replacement). Guessing NetBox objects from AS3 keys is unreliable.
3. **We render the AS3 ourselves at load time.** This is the crucial
   advantage: while rendering we can record exactly which NetBox object
   (endpoint + id) produced each AS3 object. No name guessing needed.
4. **Some NetBox fields are relations to IPAM**, not plain values:
   `VirtualServer.virtual_addresses` → `ipam.IPAddress` FKs, and
   `PoolMember.node` → `ipam.IPAddress`. Changing an address in AS3 implies
   get-or-create of an `ipam.IPAddress` first.
5. **`extra_parameters`** (Application, VirtualServer, BackendPool,
   PoolMember) is a JSON catch-all the renderer spreads into AS3. Its
   inverse absorbs edited AS3 properties that have no modeled NetBox field.
6. **Tokens**: the provisioned API token has `write_enabled: true` by
   default; the same auth path used for reading works for writing.
7. Not everything in AS3 comes from NetBox (e.g. hand-added objects with
   classes the plugin doesn't model, like `HTTP_Profile` beyond
   protocol-profile options). Write-back must say clearly what it CANNOT
   push instead of silently dropping it.

## 3. Architecture

```
load time                                  push time
─────────                                  ─────────
GraphQL graph ──► renderNetboxApp ──►      edited AS3 text
                  AS3 declaration          │
                  + PROVENANCE MANIFEST    ▼
                    (as3Key → {endpoint,   invertAs3(declaration, manifest)
                     id, netboxFields,     │  per-object NetBox field values
                     last_updated})        ▼
                                           diff(manifest.fields, inverted)
                                           │  ChangeSet: create/update/delete
                                           ▼
                                           drift check (re-fetch last_updated)
                                           ▼
                                           preview UI → user approves
                                           ▼
                                           ordered REST writes via proxy
```

### 3.1 Provenance manifest (extend the loader)

`renderNetboxApp` gains a second output: for every AS3 object it emits,
record

```ts
interface Provenance {
  as3Key: string;            // key in the Application object
  endpoint: string;          // "virtual-servers" | "backend-pools" | …
  id: number;                // NetBox pk
  class: string;             // AS3 class it was rendered as
  netboxSnapshot: Record<string, unknown>; // fields as loaded (for 3-way diff)
  lastUpdated: string;       // NetBox last_updated at load time
}
```

Stored in module memory next to the NetBox connection cache, keyed by the
declaration `id`. Also persisted into the declaration itself under
`controls.userAgent`? NO — keep the document clean; manifest lives outside
the text. Consequence: write-back only works in the session that loaded the
app (acceptable; re-loading refreshes the manifest).

### 3.2 Inverse mapping (`invertAs3`)

A pure engine module (`src/engine/as3ToNetbox.ts`) that walks the edited
declaration and produces per-object NetBox field values. Mapping tables are
the exact inverse of `netboxAs3.ts`:

| AS3 | NetBox write |
|---|---|
| `Service_*` class | `virtual_servers.protocol` (inverse of protocol map) |
| `virtualPort` | `service_port` |
| `remark` | `description` |
| `enable: false` | `enabled: false` (absence → true) |
| `virtualType` | `vs_type` (absence → "standard") |
| `persistenceMethods` | `persistence` |
| `pool: "x"` | `backend_pool` → id via manifest lookup of key "x" |
| `snat: {bigip: /Common/Shared/S}` | `snat_pool` → id by name S |
| `serverTLS/clientTLS {use}` | `ssl_profile` / `server_ssl_profile` ids |
| `virtualAddresses [{use}]` → Service_Address.virtualAddress | `virtual_addresses`: get-or-create `ipam.IPAddress` for each address |
| Pool `loadBalancingMode` | `load_balancing_algorithm` |
| Pool `label` | `description` |
| Pool `minimumMembersActive` | `priority_group_threshold` (+activation) |
| Pool `monitors [{use}]` | `monitors` M2M ids via manifest |
| member entries (per servicePort/state group, ungrouped back to one row per address) | `pool-members`: `service_port`, `node` (get-or-create IP), `enabled` (adminState), `ratio`, `priority_group` |
| Monitor `monitorType/interval/timeout/label` | `monitor_type/interval/timeout/description`; other props → `conditions` JSON |
| TLS profile flags/ciphers/cipherGroup/authenticationMode | `tls_versions` (labels→ints), `ciphers`, `cipher_group`, `mtls` |
| Endpoint_Policy `rules`/`strategy`/`label` | `policies.rules` (the complete AS3 object) + `description`, for 1:1 policies; MERGED multi-policies stay read-only — see limits |
| iRule `iRule` (base64) | `policies.rules` as `{class: "iRule", iRule: "<tcl>"}`, decoded; legacy `rules.rules` records keep their shape |
| TCP_Profile / HTTP_Profile | `protocol-profiles.options` (the complete AS3 object) |
| Cipher_Rule `cipherSuites`/`namedGroups`/`signatureAlgorithms`/`label` | `cipher-rules.ciphers`/`dh_groups`/`signature_algorithms`/`description` |
| Cipher_Group `label` | `cipher-groups.description` |
| any unmapped property on App/Service/Pool/member | `extra_parameters` JSON |

Unmappable constructs produce structured "cannot push" findings, never
silent drops.

### 3.3 ChangeSet computation

Three-way, per object:

- In manifest but not in edited AS3 → **delete** candidate.
- In edited AS3 with manifest entry → field-by-field diff of
  `invertAs3(object)` vs `netboxSnapshot` → **update** (PATCH only changed
  fields).
- In edited AS3 without manifest entry, class maps to a plugin model →
  **create** (POST), then fix up references that point at it.
- New/changed IP addresses → **get-or-create** steps in IPAM, emitted as
  explicit changes so the user sees them.

Ordering: creates first (monitors → certificates/cipher rules/groups →
ssl profiles → pools → pool members → policies → virtual servers), then
updates in the same order, then deletes in reverse. This satisfies every FK
direction in the plugin's model graph.

### 3.4 Drift protection

Before applying, re-fetch `last_updated` for every object in the ChangeSet.
Any object whose `last_updated` ≠ manifest value gets flagged "changed in
NetBox since you loaded it" and its changes are unchecked by default in the
preview. No global locking — per-object optimistic concurrency is enough
for this tool.

### 3.5 UI

"Push to NetBox…" toolbar button (enabled only when a manifest exists for
the current declaration id) → dialog in the BigipDialog style:

1. Reuses the cached NetBox connection.
2. Shows the ChangeSet as grouped rows: CREATE / UPDATE (with old → new per
   field) / DELETE / CANNOT PUSH (with reason), each with a checkbox;
   drifted rows highlighted amber and unchecked.
3. "Apply N changes" → confirm (same two-step pattern as BIG-IP Apply) →
   sequential writes with per-row ✓/✗ status; failures stop the sequence
   (later rows may depend on earlier ones).
4. On success: re-fetch the graph, re-render, reset baseline + manifest —
   the editor now shows the round-tripped truth and modified-highlighting
   clears.

## 4. Phasing (each phase ships usable)

- **Phase W1 — scalar updates on existing objects.** Manifest plumbing,
  invertAs3 for scalar fields, ChangeSet=updates only, preview dialog,
  PATCH via proxy. No creates/deletes/IPAM. Covers the most common edits
  (ports, LB mode, persistence, monitor tuning, enable flags, TLS flags).
- **Phase W2 — membership + IPAM.** Pool member add/remove/regroup,
  virtual address changes, ipam.IPAddress get-or-create.
- **Phase W3 — object create/delete.** New pools/monitors/VSs from the
  builder; deletes with the two-step confirm; reference fix-ups.
- **Phase W4 — extra_parameters + edge classes.** Unmapped-property
  absorption into extra_parameters; policies/cipher groups write; the
  "cannot push" report becomes exhaustive.
- **Phase W5 — relation objects.** Manifest entries and field updates for
  policies (endpoint policies and iRules), protocol profiles and cipher
  rules/groups, so editing them is an ordinary PATCH. Still out of scope:
  creating these objects from the builder, changing which policy/profile a
  virtual server points at, and SNAT pool membership.

## 5. Known limits (state up front, revisit later)

- Write-back requires loading through this tool first (manifest is
  session-local). A future option: derive a manifest by name-matching for
  declarations not loaded this session, with lower confidence.
- Merged multi-policy `<vs>-endpoint-policy` objects and generated
  `_service_address` objects are structural artifacts of the renderer;
  edits inside them map back, but renaming them breaks provenance.
- Certificates: NetBox stores metadata only; cert content edits (`{text}`)
  cannot be pushed (report as "cannot push — manage via Venafi").
- GSLB objects are out of scope until the reader supports them.
- An iRule policy's NetBox `description` has nowhere to live in AS3 (the
  renderer emits only `{class: "iRule", iRule}`), so it is never diffed —
  pushing an iRule edit leaves the description untouched rather than
  blanking it.
- `snat`, `policyEndpoint`, `iRules`, `profileTCP`/`profileHTTP` still point
  at whatever NetBox already links; retargeting them from the builder is not
  implemented, so those edits are reported, not written.

## 6. Test strategy

- Round-trip property tests against the live test NetBox: load app →
  invertAs3(rendered) must produce an EMPTY ChangeSet (the inverse is
  consistent with the renderer) for all 21 fixture apps.
- Golden ChangeSet tests: scripted edits (change port, add member, delete
  monitor) → expected create/update/delete JSON bodies.
- A scratch application in the ephemeral NetBox for apply-path integration
  tests (create → verify via GraphQL → delete).
