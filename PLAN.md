# AS3 Builder — Implementation Plan

> **Audience:** This document is written for an AI coding assistant (or human developer)
> with NO prior context about this project. Follow it literally. Do not skip steps.
> Do not substitute libraries. When a step says "verify", actually run the check
> before moving on. Complete phases in order; each phase leaves the app working.

---

## 1. What we are building (read this first)

A single-page web application (no backend) called **AS3 Builder**. It edits
**AS3 declarations** — JSON documents that configure F5 BIG-IP load balancers.
The structure of a valid declaration is defined by a **JSON Schema** (draft-07).

The UI has three columns:

```text
┌──────────────────────────────────────────────────────────────┐
│ Toolbar: [schema version ▾] [template ▾] [Open] [Save]       │
├────────────┬──────────────────────────┬──────────────────────┤
│ Document   │  Monaco JSON text editor │ Context panel        │
│ tree view  │  (the source of truth)   │ (schema-aware forms) │
├────────────┴──────────────────────────┴──────────────────────┤
│ Validation error bar (click an error → cursor jumps to it)   │
└──────────────────────────────────────────────────────────────┘
```

Core behavior:

1. The user types JSON in the middle (Monaco) editor.
2. The app continuously figures out **which schema rule governs the JSON node
   under the cursor** ("context resolution").
3. The right panel shows, for that node: properties already present (as editable
   form widgets) and properties that could be added (as draggable chips).
4. Dragging a chip into the editor inserts that property — into the nearest
   ancestor object where it is schema-valid — pre-filled with defaults and
   required children.
5. The tree view (left) and the editor cursor stay in sync: clicking a tree node
   moves the cursor; moving the cursor highlights the tree node.

**Single source of truth: the editor's text.** The tree and the context panel
are always derived FROM the text. They never hold independent state. All edits
(from form widgets, drag-drop, templates) are applied as text edits to the
editor content.

---

## 2. Fixed decisions (do not revisit)

| Decision | Value |
| --- | --- |
| Framework | React 18 + TypeScript, scaffolded with Vite |
| Location | Root of this repository (`/Users/daniel/work/customers/homedepot/as3_builder`) |
| Editor component | Monaco via npm package `@monaco-editor/react` |
| JSON text parsing/editing | npm package `jsonc-parser` (Microsoft). Use it for AST, cursor→path, and ALL programmatic text edits |
| Validation engine | npm package `ajv` (draft-07 mode) for the error bar; Monaco's built-in JSON schema support for squiggles/autocomplete |
| Drag & drop | Native HTML5 drag events (`draggable`, `onDragStart`, `onDrop`). No drag library |
| Schema delivery | Schema files are copied into `src/schemas/` and bundled. A toolbar dropdown switches between them. No file-upload of schemas |
| Backend | None. Everything runs in the browser |
| State management | React state/context only. No Redux/Zustand |
| Styling | Plain CSS or CSS modules. No Tailwind, no component library |

Schema source files (copy from
`/Users/daniel/work/customers/homedepot/baseconfig/docs/bigip_as3/`):

- `per-app-schema.json` ← **default selection**
- `as3-schema-3.55.0-12.json`
- `as3-schema-3.56.0-10.json`

---

## 3. Facts about the AS3 schema you MUST know

These facts drive the design. Do not write schema-handling code without
understanding them.

1. **Draft-07 JSON Schema, ~1.2 MB, 524 definitions**, heavy use of `$ref`
   (all internal, of the form `#/definitions/Name`). Resolve refs lazily
   (on access), never by deep-copying the whole schema.

2. **The root of a per-app document** is an object whose keys are
   application names (arbitrary, matching a name pattern) mapped through
   `additionalProperties: {"$ref": "#/definitions/Application"}`, plus a
   required `schemaVersion` string property. Example document:

   ```json
   {
     "schemaVersion": "3.55.0",
     "myApp": {
       "class": "Application",
       "web": {
         "class": "Service_HTTP",
         "virtualAddresses": ["10.0.0.1"],
         "pool": "pool1"
       },
       "pool1": {
         "class": "Pool",
         "members": [
           { "servicePort": 80, "serverAddresses": ["10.0.1.10"] }
         ]
       }
     }
   }
   ```

3. **Discrimination by `class`.** An `Application`'s members are arbitrary
   named objects. Which definition applies to each object is determined by
   its `"class"` property value (e.g. `"class": "Pool"` → definition `Pool`).
   The schema expresses this with `anyOf`/`if-then` unions. Generic schema
   walkers get lost here. **Rule: when resolving which subschema governs an
   object, if the object in the DOCUMENT has a `class` property whose value
   matches a definition name in the class registry (see §5.2), use that
   definition directly.**

4. Definitions use draft-07 constructs: `allOf` (merge all branches),
   `oneOf`/`anyOf` (pick branch — use `class` or `required`-key overlap as
   heuristics), `if/then/else` (apply `then` when `if` matches the document
   node, else `else`), `additionalProperties` as a schema, `items` for arrays,
   `const`, `enum`, `default`, `description`.

5. Many string properties are **cross-references**: they name another object
   in the same document (e.g. a Service's `"pool": "pool1"` names a Pool
   defined as a sibling). Some are wrapped forms like `{ "use": "poolName" }`
   or `{ "bigip": "/Common/thing" }`. The context panel turns these into
   dropdowns of matching objects present in the document (Phase 5).

---

## 4. Repository layout (target state)

```text
as3_builder/
├── PLAN.md                  ← this file
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx              ← 3-column layout + toolbar + state wiring
│   ├── schemas/
│   │   ├── index.ts         ← registry: id → {label, schema (imported JSON)}
│   │   ├── per-app-schema.json
│   │   ├── as3-schema-3.55.0-12.json
│   │   └── as3-schema-3.56.0-10.json
│   ├── templates/
│   │   ├── index.ts
│   │   ├── empty.json
│   │   ├── http-app.json
│   │   └── https-app.json
│   ├── engine/              ← PURE LOGIC, NO REACT, fully unit-tested
│   │   ├── refResolver.ts   ← resolve $ref, merge allOf, apply if/then
│   │   ├── classRegistry.ts ← map class name → definition
│   │   ├── pathResolver.ts  ← document path → governing subschema
│   │   ├── context.ts       ← cursor offset → NodeContext (see §5.4)
│   │   ├── stubber.ts       ← subschema → stub JSON value (see §5.5)
│   │   ├── inserter.ts      ← drag-drop insertion logic (see §8)
│   │   └── docIndex.ts      ← scan document for class instances (xref picker)
│   ├── components/
│   │   ├── EditorPane.tsx
│   │   ├── TreePane.tsx
│   │   ├── ContextPanel.tsx
│   │   ├── PropertyWidget.tsx
│   │   ├── AddableChip.tsx
│   │   ├── Toolbar.tsx
│   │   └── ErrorBar.tsx
│   └── hooks/
│       ├── useDocument.ts   ← text state + debounced parse + last-good tree
│       └── useValidation.ts ← ajv wiring
└── src/engine/__tests__/    ← vitest tests for everything in engine/
```

---

## 5. Core engine specification (`src/engine/`)

Everything in `engine/` is plain TypeScript: **no React imports, no DOM
access**. It must be testable with vitest in node.

### 5.1 `refResolver.ts`

```ts
// Resolve one level: if schema has $ref, look it up in root.definitions.
// Cache by ref string. Throw a descriptive error on unknown ref.
export function deref(root: JsonSchemaRoot, schema: JsonSchema): JsonSchema

// Produce an "effective schema" for a node:
// 1. deref
// 2. if allOf: deref+merge every branch (properties, required union;
//    scalar keywords: first branch wins)
// 3. if if/then/else AND a document node is supplied: test `if` against the
//    node (only class/const/required checks needed — full ajv not required)
//    and merge the matching branch
// anyOf/oneOf are NOT auto-picked here; they are returned as-is for the
// pathResolver to discriminate (see 5.3 rule D).
export function effectiveSchema(
  root: JsonSchemaRoot, schema: JsonSchema, docNode?: unknown
): JsonSchema
```

### 5.2 `classRegistry.ts`

At schema load, walk `root.definitions`. A definition is a **class
definition** if (after `effectiveSchema` without a doc node) it has
`properties.class` with a `const` or single-value `enum`. Build:

```ts
export interface ClassInfo {
  className: string;        // e.g. "Service_HTTP"
  definitionName: string;   // key in definitions
  schema: JsonSchema;       // the effective schema
  description?: string;
  required: string[];
}
export function buildClassRegistry(root: JsonSchemaRoot): Map<string, ClassInfo>
```

Also export `applicationMemberClasses(registry)`: the subset of classes valid
as members of an `Application` (derive from the Application definition's
`additionalProperties`; if that is too permissive to narrow, return all
classes).

### 5.3 `pathResolver.ts`

```ts
// path: from jsonc-parser, e.g. ["myApp", "web", "virtualAddresses", 0]
// doc:  the parsed document (may be partially invalid; tolerate undefined lookups)
// returns the subschema governing the node at `path`, or undefined.
export function resolveSchemaForPath(
  root: JsonSchemaRoot, registry: ClassRegistry, doc: unknown, path: (string|number)[]
): JsonSchema | undefined
```

Walk from the root schema, one path segment at a time. At each object step,
compute `effectiveSchema(root, current, docNodeAtThisLevel)`, then locate the
child schema by these rules, **in order**:

- **A.** `properties[segment]` exists → use it.
- **B.** `patternProperties` has a pattern matching the segment → use it.
- **C.** `additionalProperties` is a schema object → use it.
- **D.** current schema is an `anyOf`/`oneOf` union → if the document node at
  this level has a `class` property found in the registry, use that class's
  schema and retry A–C; otherwise try each branch in order and use the first
  branch where A–C succeeds.
- **E.** numeric segment and schema has `items` → use `items` (or
  `items[i]` if items is an array).
- Nothing matches → return `undefined` (caller shows "unknown context").

**Class override rule:** independent of the above, whenever the DOCUMENT node
being stepped into is an object with a string `class` property present in the
registry, prefer the registry schema for that class. This handles Application
members without fighting the anyOf union.

### 5.4 `context.ts`

```ts
export interface PropertyInfo {
  name: string;
  schema: JsonSchema;          // effective, deref'd
  type: string;                // "string" | "number" | "integer" | "boolean" | "object" | "array" | "enum"
  description?: string;
  required: boolean;
  enumValues?: (string|number)[];
  default?: unknown;
  present: boolean;            // already in the document node?
}
export interface NodeContext {
  path: (string|number)[];
  breadcrumb: string;          // "myApp › web (Service_HTTP)"
  className?: string;
  schema?: JsonSchema;
  presentProps: PropertyInfo[];
  addableProps: PropertyInfo[];   // allowed but absent; required-missing first
  isApplication: boolean;         // true → panel also offers "Add <class>" chips
}
export function getContext(
  root, registry, text: string, offset: number
): NodeContext
```

Implementation: `jsonc-parser.getLocation(text, offset)` → path. If the
cursor is on a property VALUE, context is the enclosing OBJECT (trim the last
path segment if it addresses a scalar). Then `resolveSchemaForPath`, then
enumerate `properties` of the effective schema into present/addable lists.

### 5.5 `stubber.ts`

```ts
// Produce a placeholder value for a schema, for insertion into the document.
export function stubValue(root, schema: JsonSchema, depth?: number): unknown
```

Rules (first match wins): `default` → use it. `const` → use it. `enum` → first
entry. type `string` → `""`. `number`/`integer` → `minimum` ?? `0`.
`boolean` → `false`. `array` → `[]`, but if `minItems >= 1`, one stubbed
item. `object` → `{}` plus every REQUIRED property stubbed recursively.
**Depth limit 4** (beyond that, emit `{}`/`""`) to prevent runaway recursion
on self-referential definitions. When stubbing a class object, set `class`
first.

### 5.6 `docIndex.ts`

```ts
// Scan the parsed document; return every object that has a string `class`,
// with its name (the key it sits under) and path.
export function indexClassInstances(doc: unknown):
  { name: string; className: string; path: (string|number)[] }[]
```

---

## 6. UI state model

`useDocument.ts` owns:

- `text: string` — the editor content. THE single source of truth.
- `tree` — `jsonc-parser.parseTree(text)`, recomputed debounced **150 ms**
  after text changes. jsonc-parser is fault-tolerant; it returns a tree even
  for broken JSON.
- `lastGoodDoc: unknown` — result of `jsonc-parser.parse` from the most recent
  text that parsed without errors. When current text is broken, tree pane and
  context panel keep rendering from `lastGoodDoc` with a subtle "stale — fix
  JSON" banner.
- `applyEdit(path, value | undefined)` — uses `jsonc-parser.modify(text, path,
  value, {formattingOptions})` + `applyEdits` to produce new text
  (`value === undefined` deletes the property). **Never** rewrite the whole
  document with `JSON.stringify` — `modify` preserves the user's formatting.
- `cursorOffset: number` — pushed from Monaco `onDidChangeCursorPosition`.

Derived per render (memoized on `[text-debounced, cursorOffset, schemaId]`):
`context = getContext(...)`.

---

## 7. Component specifications

### Toolbar

- **Schema dropdown**: options from `src/schemas/index.ts`; switching re-runs
  registry build + revalidates + updates Monaco schema association.
- **Template dropdown**: options from `src/templates/index.ts`; selecting one
  REPLACES editor text after a `window.confirm` if the current text differs
  from the last loaded/saved state.
- **Open**: `<input type="file" accept=".json">` → read → set editor text.
- **Save**: create a `Blob` from editor text → temporary `<a download="declaration.json">` → click it.

### EditorPane (Monaco)

- Language `json`. Register the ACTIVE schema:

  ```ts
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true, enableSchemaRequest: false,
    schemas: [{ uri: "inmemory://schema/active", fileMatch: ["*"], schema: activeSchema }]
  })
  ```

  This alone provides squiggles + autocomplete while typing.
- Report cursor offset changes upward (`model.getOffsetAt(position)`).
- Handle `onDrop` (see §8). Set `dragover` handler with `preventDefault` so
  drops are allowed.

### TreePane

- Render `lastGoodDoc` recursively: application keys, then member objects
  labeled `name (className)`, one level of children for objects/arrays.
- Click → compute the node's text offset from the jsonc `tree` (`findNodeAtLocation(tree, path).offset`) → move Monaco cursor there.
- Highlight the node containing the current cursor path.

### ContextPanel

- Shows `context.breadcrumb`.
- **Present properties** → `PropertyWidget` each (see below).
- **Addable properties** → `AddableChip` each: shows name + type badge;
  `title` attr = description; `draggable`; required-missing ones get a red
  dot and sort first.
- When `context.isApplication`: an "Add object" section with one chip per
  class from `applicationMemberClasses` (chip payload includes
  `isClassObject: true`).

### PropertyWidget (content-aware value editing)

Choose the widget by `PropertyInfo`:

| Schema shape | Widget |
| --- | --- |
| `enumValues` present | `<select>` |
| type boolean | checkbox/toggle |
| type integer/number | `<input type="number">` with min/max from schema |
| type string | `<input type="text">`; validate `pattern` on blur, red outline on mismatch |
| type object / array | non-editable summary row ("{…} 3 props" / "[…] 2 items") + a "go to" button that moves the cursor into it |
| cross-ref (Phase 5, see §9) | `<select>` of matching document objects |

On change → `applyEdit(context.path.concat(name), coercedValue)`.
Each widget row has a small ✕ button → `applyEdit(path, undefined)` (delete),
disabled when `required` is true.

### ErrorBar

- Runs ajv (compiled once per schema selection; `allErrors: true`,
  `strict: false`) on `lastGoodDoc` (debounced with the parse).
- If text is currently unparseable, show the jsonc-parser syntax errors instead.
- Each row: `instancePath — message`. Click → convert instancePath to a path
  array → `findNodeAtLocation` → move cursor.

---

## 8. Drag-and-drop insertion (the signature feature)

Chip `onDragStart` sets
`event.dataTransfer.setData("application/x-as3-prop", JSON.stringify(payload))`
where payload is:

```ts
{ name: string; sourcePath: (string|number)[];   // context path the chip came from
  isClassObject?: boolean; className?: string }
```

Editor `onDrop` handler (`src/engine/inserter.ts` does the logic):

1. Convert drop coordinates to text offset: `editor.getTargetAtClientPoint(x, y)` → position → offset.
2. `getLocation(text, offset)` → drop path.
3. **Find the insertion parent:** starting at the object containing the drop
   offset, walk UP the ancestor chain. At each ancestor object, resolve its
   schema (`resolveSchemaForPath`) and check whether `payload.name` is an
   allowed, not-already-present property there. First match wins.
   - For `isClassObject` chips the target must be an Application object; the
     inserted key is a generated unique name (`newService1`, `newPool1`, …,
     incrementing until unused) and the value is `stubValue` of the class
     schema (which sets `"class"`).
4. No valid ancestor → do NOT insert. Show a transient toast: `"<name>" is not
   valid here — valid under: <breadcrumb of chip's sourcePath>`.
5. Valid parent found → `applyEdit(parentPath.concat(key), stubValue(schema))`.
6. After the edit, move the cursor to the newly inserted value
   (`findNodeAtLocation` on the fresh tree) so the context panel immediately
   shows the new node's widgets.

Also support **double-click on a chip** as a no-drag alternative: inserts into
the chip's own `sourcePath` context directly (same steps 5–6).

---

## 9. Cross-reference pickers (Phase 5 detail)

A property is a **cross-ref candidate** when its effective schema (or an
`anyOf` branch of it) matches any of:

- type `string` and the property name is one of: `pool`, `monitor`,
  `profileTCP`, `profileHTTP`, `snat`, or the schema description contains
  "pointer" / "reference" (case-insensitive) — heuristic list, keep it in one
  exported constant `XREF_PROP_HINTS` so it's easy to extend.
- an object schema whose only/main property is `use` (type string) or `bigip`.

Widget: `<select>` listing `indexClassInstances(lastGoodDoc)` entries filtered
to plausible classes (e.g. property `pool` → class `Pool`; mapping constant
`XREF_CLASS_MAP = { pool: ["Pool"], monitor: ["Monitor"], ... }`, fall back to
all instances). Selecting writes the plain string name; if the existing value
was `{"use": ...}`, preserve that wrapper shape.

---

## 10. Build phases — DO THESE IN ORDER

Each phase ends with the app running (`npm run dev`) and all tests passing
(`npm test`). Commit at the end of each phase with the message given.

### Phase 1 — Scaffold + editor shell

1. `npm create vite@latest . -- --template react-ts`, then
   `npm i @monaco-editor/react jsonc-parser ajv` and `npm i -D vitest`.
2. Copy the three schema files into `src/schemas/`; write `schemas/index.ts`.
3. Build the 3-column layout (tree pane can be an empty placeholder), Toolbar
   with schema dropdown + Open + Save, Monaco wired with diagnostics options.
4. Templates: `empty.json` = `{ "schemaVersion": "3.55.0" }`; http-app and
   https-app as in §3.2's example (https adds `Service_HTTPS` +
   `Monitor` with `monitorType: "https"`). Template dropdown replaces text.
5. **Verify:** typing `"class": "` inside an app member offers completions;
   an invalid property shows a squiggle; Open/Save round-trips a file.
   Commit: `phase 1: scaffold, monaco editor, schemas, templates, open/save`.

### Phase 2 — Schema engine (pure logic + tests)

1. Implement `refResolver`, `classRegistry`, `pathResolver`, `context`,
   `stubber`, `docIndex` exactly per §5.
2. Write vitest tests importing the REAL `per-app-schema.json`. Minimum cases:
   - registry contains `Service_HTTP`, `Pool`, `Application`, and >100 classes total
   - path `[]` resolves to root; `["schemaVersion"]` to a string schema
   - `["myApp"]` (doc node has `class: "Application"`) → Application schema
   - `["myApp","web"]` with `class: "Service_HTTP"` → that class's schema;
     its context lists `virtualAddresses` addable when absent
   - `["myApp","pool1","members",0]` → Pool member schema; `servicePort`
     required
   - `stubValue` of `Pool` → `{"class":"Pool"}` plus required props; depth
     limit honored on a self-referential definition
   - `getContext` with cursor mid-way inside `"virtualAddresses"` value returns
     the enclosing Service context, not a string context
3. **Verify:** `npm test` green. Commit: `phase 2: schema engine + tests`.

### Phase 3 — Context panel + tree + sync

1. `useDocument` per §6; wire cursor → `getContext` → ContextPanel with
   PropertyWidget + AddableChip per §7.
2. TreePane with click-to-jump and cursor-follow highlight.
3. Stale-doc banner when JSON is broken.
4. **Verify manually:** cursor inside a Service shows its props; editing a
   widget updates the text WITHOUT reformatting the rest; deleting via ✕
   works; tree click jumps. Commit: `phase 3: context panel, tree, sync`.

### Phase 4 — Drag & drop + class creation

1. Implement §8 in full, including ancestor-walk parent finding, unique-name
   generation, invalid-drop toast, post-insert cursor move, chip double-click.
2. **Verify manually:** dragging `virtualAddresses` from a Service context
   into pool text inserts it into the Service (nearest valid ancestor
   fails → walks up correctly); dragging "Add Pool" into an app creates
   `newPool1`. Commit: `phase 4: drag-drop insertion`.

### Phase 5 — Cross-refs, error bar, polish

1. §9 cross-ref pickers. 2. ErrorBar per §7 with click-to-jump.
2. Polish: keyboard focus into first stub value after insert, required-missing
   chips styled, panel scroll containment.
3. **Verify:** setting a Service's `pool` via dropdown lists existing Pools;
   ajv errors appear and click-jump. Commit: `phase 5: xref pickers, error bar, polish`.

### Phase 6 — Relationship graph pane (read-only "map", not a node editor)

**Why:** JSON nesting is already well served by the tree pane, but AS3's
cross-references (`pool`, `serverTLS {use}`, `monitors [{use}]`, certificate →
cipher group chains) are SIBLINGS in the JSON — the tree shows no relationship
between a Service and the Pool it points at. A graph view shows exactly that.
**Scope guard: this is a read-only map with click-to-navigate. Do NOT build
drag-to-rewire editing** — that would duplicate the context panel's editing
logic and fight layout stability on every keystroke.

1. **Data extraction (pure engine code, `src/engine/docGraph.ts`):**
   - Nodes: reuse `indexClassInstances(lastGoodDoc)` — one node per
     class-bearing object (name, className, path).
   - Edges: walk each object's properties; a property whose resolved schema
     has `xrefClasses` (the f5PostProcess pointer detection from §9) and whose
     value names another object in the document produces an edge
     `{from, to, propertyName}`. Handle all pointer shapes: bare string,
     `{use: name}`, and arrays of either. `{bigip: …}` pointers are external —
     render as a stub node, visually distinct.
   - Also emit: **dangling edges** (pointer names nothing in the document) and
     **orphan nodes** (nothing points at them and they are not Services).
   - Unit-test against the http-app/https-app templates and a NetBox-rendered
     app: Service → Pool → Monitor and Service → TLS_Server → Certificate
     chains must appear; a bogus `"pool": "nope"` must yield a dangling edge.
2. **Rendering (`src/components/GraphPane.tsx`):** toggle on the left column
   (Tree ⇄ Graph). Use left-to-right ranked layout (Service on the left,
   leaves right) — dagre or a simple longest-path layering is enough; avoid
   physics/force layouts (layout churn). One node = small card with name +
   class badge, matching the tree's styling.
3. **Sync exactly like the tree:** clicking a node calls `navigateToPath`
   (cursor jump + context panel update); the node containing the current
   cursor path gets the `selected` highlight. Re-derive the graph from
   `lastGoodDoc` on the same debounce; keep last-good with the stale banner.
4. **Diagnostics styling:** dangling edges red + tooltip naming the missing
   target; orphan nodes dimmed with an "unreferenced" badge.
5. **Verify:** load the https-app template → graph shows
   `web → webtls → webcert` and `web → pool1 → (monitor)`; break the `pool`
   value → red edge; click any node → cursor jumps. Commit:
   `phase 6: relationship graph pane`.

Pitfall for this phase: derive edges from the SCHEMA's pointer metadata
(`xrefClasses`), not from string matching — a pool member IP that happens to
equal an object name must not create an edge.

---

## 11. Pitfalls — read before coding, reread when stuck

1. **Never `JSON.parse` the raw editor text and re-serialize it.** You will
   destroy user formatting and key order. All edits go through
   `jsonc-parser.modify` + `applyEdits`.
2. **The schema is huge.** Never deep-clone it. `deref` returns references
   into the original object; treat all schema objects as immutable.
3. `anyOf` unions in this schema are effectively discriminated by `class`.
   If your resolver tries generic anyOf exploration first, it will pick wrong
   branches. Apply the class override rule (§5.3) FIRST.
4. jsonc-parser's `getLocation().path` for an offset inside a property NAME
   vs VALUE differs; normalize to the enclosing object per §5.4.
5. Monaco offsets are 0-based via `getOffsetAt`; jsonc-parser offsets are
   0-based too — but Monaco POSITIONS (line/column) are 1-based. Convert at
   the boundary only.
6. Debounce parsing (150 ms) or typing will feel sluggish with a 1.2 MB
   schema + ajv. Compile the ajv validator ONCE per schema selection, not per
   keystroke.
7. `if/then` handling only needs class/const/required tests to work for this
   schema — do not embed a full validator inside `effectiveSchema`.
8. On drop, Monaco may not focus/position as expected — call
   `editor.getTargetAtClientPoint`; if it returns null (drop below last line),
   treat the drop as targeting the LAST node in the document.
9. Ajv on this schema needs `strict: false` (it uses non-strict patterns) —
   expect and silence strict-mode warnings, not errors.

## 12. Definition of done

- All five phase commits exist and `npm test` + `npm run build` pass.
- A user can: pick a template, see live validation, click any node, edit
  every scalar via widgets, drag any addable property in, add a new Pool +
  Service via chips, point the Service at the Pool via the xref dropdown,
  and save a valid declaration file.
