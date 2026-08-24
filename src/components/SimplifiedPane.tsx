import { useEffect, useRef, useState } from "react";
import type { JsonPath, JsonSchema } from "../engine";
import {
  decodeBase64Safely,
  encodeBase64,
  isBase64Wrapper,
  isPlainObject,
  readOnlyReason,
  validateValue,
} from "../engine";
import Base64Editor from "./Base64Editor";
import { revealRelated } from "./revealRelated";

// Indented key-value rendering of the document, without JSON syntax.
// Clicking a KEY focuses the node (panel/tree/status bar sync); clicking a
// VALUE edits it in place with the schema-appropriate widget. Enter on a
// list item appends the next one. The JSON text stays the source of truth —
// every edit goes through the same applyEdit path the panel widgets use.

export interface InlineSpec {
  kind: "string" | "longtext" | "number" | "boolean" | "enum" | "xref";
  enumValues?: (string | number)[];
  xrefOptions?: { name: string; className: string }[];
  /** Objects that exist on the BIG-IP rather than in this declaration. Picking
   * one rewrites the whole pointer to {bigip: fullPath}, so it is committed at
   * `externalTargetPath`, not at the row being edited. */
  externalOptions?: { fullPath: string; label: string; summary: string }[];
  externalTargetPath?: JsonPath;
  schema?: JsonSchema;
}

interface SimplifiedPaneProps {
  doc: unknown;
  cursorPath: JsonPath;
  isModified: (path: JsonPath) => boolean;
  onSelect: (path: JsonPath) => void;
  getInlineSpec: (path: JsonPath, value: unknown) => InlineSpec;
  /** Single edit (value === undefined deletes). */
  onEditValue: (path: JsonPath, value: unknown) => void;
  /** Several edits applied atomically (commit + append). */
  onEditMany: (edits: [JsonPath, unknown][]) => void;
  /** Append a schema-stubbed object item (e.g. a pool member) and focus it. */
  onAppendObjectItem: (arrayPath: JsonPath, index: number) => void;
  /** Reports what the pointer is over, with its position, for the hover card. */
  onHoverPath: (
    anchor: { path: JsonPath; x: number; y: number } | null
  ) => void;
  /** Path keys on the other end of the selected reference. */
  relatedKeys: Set<string>;
  /** Find-in-document match paths (with ancestors); null when not searching. */
  searchKeys?: Set<string> | null;
  /** Deployment blacklist rule for a value, if any (SUPPORT-POLICY-PLAN §5). */
  unsupportedForValue?: (
    value: Record<string, unknown>
  ) => { mode: "hard" | "soft" | "review"; reason?: string } | undefined;
  /** Paths of hard-blacklisted objects: editing inside is disabled, delete
   * stays (badge+lock, never hide — resolved decision #1). */
  lockedKeys?: Set<string>;
}

// Fold state lives outside the component so it survives switching to the
// JSON view and back (the pane unmounts when hidden).
const collapsedPaths = new Set<string>();

function collectFoldablePaths(value: unknown, path: JsonPath, out: string[]) {
  if (Array.isArray(value)) {
    if (path.length > 1) out.push(pathKey(path));
    value.forEach((v, i) => collectFoldablePaths(v, [...path, i], out));
    return;
  }
  if (isPlainObject(value) && !isBase64Wrapper(value)) {
    // Leave the declaration root and the Application itself open: folding
    // those would hide everything.
    if (path.length > 1) out.push(pathKey(path));
    for (const [k, v] of Object.entries(value))
      collectFoldablePaths(v, [...path, k], out);
  }
}

function pathsEqual(a: JsonPath, b: JsonPath): boolean {
  return a.length === b.length && a.every((s, i) => String(s) === String(b[i]));
}

function pathKey(p: JsonPath): string {
  return p.map(String).join("\u0000");
}

function ScalarValue({ value }: { value: unknown }) {
  const cls =
    typeof value === "string"
      ? "sv-string"
      : typeof value === "number"
        ? "sv-number"
        : typeof value === "boolean"
          ? "sv-boolean"
          : "sv-null";
  const text = typeof value === "string" && value === "" ? "(empty)" : String(value);
  return <span className={`sv ${cls}`}>{text}</span>;
}

// "virtualAddresses" -> "virtualAddress", "rules" -> "rule".
function singularize(key: string): string {
  if (/ses$/.test(key)) return key.slice(0, -2);
  if (/s$/.test(key) && !/ss$/.test(key)) return key.slice(0, -1);
  return key || "item";
}

function isScalarArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.every((x) => !isPlainObject(x) && !Array.isArray(x));
}

// ---- inline editor ---------------------------------------------------------

const EXTERNAL_PREFIX = "\u0000bigip:";

function InlineEditor({
  spec,
  initial,
  onCommit,
  onCommitExternal,
  onCancel,
}: {
  spec: InlineSpec;
  initial: unknown;
  /** wasEnter distinguishes Enter-commit (may append the next list item). */
  onCommit: (value: unknown, wasEnter: boolean) => void;
  /** An estate object was picked: replace the pointer with {bigip: …}. */
  onCommitExternal: (fullPath: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(
    initial === undefined || initial === null ? "" : String(initial)
  );
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, []);

  const error =
    spec.schema && (spec.kind === "string" || spec.kind === "longtext")
      ? validateValue(spec.schema, draft).message
      : spec.schema && spec.kind === "number" && draft !== ""
        ? validateValue(spec.schema, Number(draft)).message
        : undefined;

  const commit = (wasEnter: boolean) => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (spec.kind === "number") {
      const n = Number(draft);
      onCommit(draft === "" || Number.isNaN(n) ? initial : n, wasEnter);
    } else {
      onCommit(draft, wasEnter);
    }
  };
  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  const externals = spec.externalOptions ?? [];
  if (
    spec.kind === "enum" ||
    spec.kind === "xref" ||
    spec.kind === "boolean" ||
    externals.length > 0
  ) {
    const options =
      spec.kind === "boolean"
        ? [
            { value: "true", label: "true" },
            { value: "false", label: "false" },
          ]
        : spec.kind === "enum"
          ? (spec.enumValues ?? []).map((v) => ({
              value: String(v),
              label: String(v),
            }))
          : (spec.xrefOptions ?? []).map((o) => ({
              value: o.name,
              label: `${o.name} (${o.className})`,
            }));
    const current = String(initial ?? "");
    return (
      <select
        className="inline-edit"
        autoFocus
        defaultValue={current}
        onChange={(e) => {
          if (committedRef.current) return;
          committedRef.current = true;
          const raw = e.target.value;
          if (raw.startsWith(EXTERNAL_PREFIX)) {
            onCommitExternal(raw.slice(EXTERNAL_PREFIX.length));
            return;
          }
          if (spec.kind === "boolean") onCommit(raw === "true", false);
          else if (spec.kind === "enum")
            onCommit(
              spec.enumValues!.find((v) => String(v) === raw) ?? raw,
              false
            );
          else onCommit(raw, false);
        }}
        onBlur={cancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
      >
        {!options.some((o) => o.value === current) && (
          <option value={current}>{current || "(unset)"}</option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {externals.length > 0 && (
          <optgroup label="On the BIG-IP (/Common) — external">
            {externals.map((o) => (
              <option
                key={o.fullPath}
                value={`${EXTERNAL_PREFIX}${o.fullPath}`}
                title={o.summary}
              >
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    );
  }

  if (spec.kind === "longtext") {
    return (
      <div className="inline-popover" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          rows={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        />
        {error && <div className="pw-error">{error}</div>}
        <div className="inline-popover-actions">
          <button onClick={cancel}>Cancel</button>
          <button className="primary" onClick={() => commit(false)}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <input
      ref={(el) => {
        inputRef.current = el;
      }}
      className={`inline-edit${error ? " pw-invalid" : ""}`}
      type={spec.kind === "number" ? "number" : "text"}
      title={error}
      value={draft}
      min={spec.schema?.minimum}
      max={spec.schema?.maximum}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(true);
        if (e.key === "Escape") cancel();
      }}
    />
  );
}

// ---- rows ------------------------------------------------------------------

interface RowCtx {
  cursorPath: JsonPath;
  isModified: (path: JsonPath) => boolean;
  onSelect: (path: JsonPath) => void;
  editingPath: JsonPath | null;
  startEdit: (path: JsonPath, value: unknown) => void;
  renderEditor: (path: JsonPath, value: unknown) => React.ReactNode;
  deleteAt: (path: JsonPath) => void;
  appendItem: (arrayPath: JsonPath, length: number) => void;
  appendObjectItem: (arrayPath: JsonPath, length: number) => void;
  previewBase64: (wrapper: { base64: string }) => string;
  commitValue: (path: JsonPath, value: unknown) => void;
  cancelEdit: () => void;
  isCollapsed: (path: JsonPath) => boolean;
  toggleCollapse: (path: JsonPath) => void;
  hover: (anchor: { path: JsonPath; x: number; y: number } | null) => void;
  /** True when this node is the other end of the selected reference. */
  isRelated: (path: JsonPath) => boolean;
  /** False only while a search is active and this node is not on the route
   * to any match. */
  matchesSearch: (path: JsonPath) => boolean;
  unsupportedRule: (
    value: Record<string, unknown>
  ) => { mode: "hard" | "soft" | "review"; reason?: string } | undefined;
  /** True when the path sits inside a hard-blacklisted object. */
  isLocked: (path: JsonPath) => boolean;
}

/** A `{bigip: "/path"}` value names an object that lives on the device or in
 * the estate. The pointer can be retargeted; the thing it points at is not
 * ours to edit. */
function isBigipPointer(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && typeof value.bigip === "string";
}

function immutabilityOf(
  value: Record<string, unknown>
): { badge: string; reason: string } | undefined {
  const classReason = readOnlyReason(value.class);
  if (classReason) return { badge: "read-only", reason: classReason };
  if (isBigipPointer(value))
    return {
      badge: "external",
      reason:
        "Points at an object on the BIG-IP or in the estate — you can retarget the pointer, but the target is not editable here",
    };
  return undefined;
}

/** Hover handlers for a row: report the path and where the pointer is, so the
 * card can appear next to it; clear on the way out. */
function hoverProps(path: JsonPath, ctx: RowCtx) {
  return {
    onMouseEnter: (e: React.MouseEvent) =>
      ctx.hover({ path, x: e.clientX, y: e.clientY }),
    onMouseLeave: () => ctx.hover(null),
  };
}

function DeleteBtn({ path, ctx, title }: { path: JsonPath; ctx: RowCtx; title: string }) {
  return (
    <button
      className="simple-delete"
      title={title}
      // The label is a glyph, so the title alone leaves screen readers
      // announcing "✕" with no idea what it removes.
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        ctx.deleteAt(path);
      }}
    >
      ✕
    </button>
  );
}

function Chevron({ path, ctx }: { path: JsonPath; ctx: RowCtx }) {
  const collapsed = ctx.isCollapsed(path);
  return (
    <button
      className="fold-btn"
      title={collapsed ? "Expand" : "Collapse"}
      aria-label={collapsed ? "Expand" : "Collapse"}
      aria-expanded={!collapsed}
      onClick={(e) => {
        e.stopPropagation();
        ctx.toggleCollapse(path);
      }}
    >
      {collapsed ? "▸" : "▾"}
    </button>
  );
}

// A scalar (or base64) property line inside a card body.
function ValueRow({
  label,
  value,
  path,
  ctx,
}: {
  label: string;
  value: unknown;
  path: JsonPath;
  ctx: RowCtx;
}) {
  const editing = ctx.editingPath && pathsEqual(path, ctx.editingPath);
  const selected = pathsEqual(path, ctx.cursorPath);
  // iRules are Tcl stored base64-encoded. A plain-string iRule (a fresh stub,
  // or a hand-typed value) gets the same decoded editing surface — and its
  // commit produces the {base64: …} wrapper, so the document always carries
  // the encoded form for NetBox and the BIG-IP alike.
  const isIrule = path[path.length - 1] === "iRule";
  const b64 = isBase64Wrapper(value) || (isIrule && typeof value === "string");
  const b64Wrapper: { base64: string } | null = isBase64Wrapper(value)
    ? value
    : b64
      ? { base64: encodeBase64(String(value)) }
      : null;
  return (
    <div>
      <div
        className={`simple-row${selected ? " selected" : ""}${ctx.isModified(path) ? " modified" : ""}${ctx.isRelated(path) ? " related" : ""}${ctx.matchesSearch(path) ? "" : " unmatched"}`}
        title={path.map(String).join(" › ")}
        {...hoverProps(path, ctx)}
      >
        <span
          className="simple-key"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(path);
          }}
        >
          {label}
        </span>
        {b64 && <span className="b64-badge">base64</span>}
        {editing ? (
          b64 ? null : (
            ctx.renderEditor(path, value)
          )
        ) : (
          <span
            className="simple-value-hit"
            title={b64 ? "Click to edit the decoded text" : "Click to edit"}
            onClick={(e) => {
              e.stopPropagation();
              ctx.startEdit(path, value);
            }}
          >
            {b64 && b64Wrapper ? (
              <span className="sv sv-string">
                {ctx.previewBase64(b64Wrapper)}
              </span>
            ) : (
              <ScalarValue value={value} />
            )}
          </span>
        )}
        {!editing && <DeleteBtn path={path} ctx={ctx} title={`Remove ${label}`} />}
      </div>
      {editing && b64 && b64Wrapper && (
        <Base64Editor
          wrapper={b64Wrapper}
          onCommit={(v) => ctx.commitValue(path, v)}
          onClose={() => ctx.cancelEdit()}
          compact
          language={isIrule ? "tcl" : undefined}
        />
      )}
    </div>
  );
}

// Scalar list: dashed items plus an add row.
function ScalarList({
  label,
  items,
  path,
  ctx,
}: {
  label: string;
  items: unknown[];
  path: JsonPath;
  ctx: RowCtx;
}) {
  return (
    <div className="simple-group">
      <div className="simple-group-head">
        <Chevron path={path} ctx={ctx} />
        <span
          className="simple-key"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(path);
          }}
        >
          {label}
        </span>
        <span className="simple-count">{items.length}</span>
        <DeleteBtn path={path} ctx={ctx} title={`Remove ${label}`} />
      </div>
      {!ctx.isCollapsed(path) && (
      <div className="simple-group-body">
        {items.map((v, i) => {
          const itemPath = [...path, i];
          const editing = ctx.editingPath && pathsEqual(itemPath, ctx.editingPath);
          return (
            <div
              key={i}
              className={`simple-row simple-item${ctx.isModified(itemPath) ? " modified" : ""}`}
              {...hoverProps(itemPath, ctx)}
            >
              <span className="simple-dash">–</span>
              {editing ? (
                ctx.renderEditor(itemPath, v)
              ) : (
                <span
                  className="simple-value-hit"
                  title="Click to edit; Enter adds the next item"
                  onClick={(e) => {
                    e.stopPropagation();
                    ctx.startEdit(itemPath, v);
                  }}
                >
                  <ScalarValue value={v} />
                </span>
              )}
              {!editing && (
                <DeleteBtn path={itemPath} ctx={ctx} title="Remove item" />
              )}
            </div>
          );
        })}
        <div
          className="simple-row simple-add"
          onClick={(e) => {
            e.stopPropagation();
            ctx.appendItem(path, items.length);
          }}
        >
          + add item
        </div>
      </div>
      )}
    </div>
  );
}

// Any object rendered as a bordered card. Class-bearing objects (an
// application's Services, Pools, Monitors …) get the strong treatment; nested
// plain objects and array items get a lighter one, so the eye can tell a
// standalone object from part of its parent.
function ObjectCard({
  label,
  value,
  path,
  ctx,
  variant,
  badge,
  insideImmutable,
}: {
  label: string;
  value: Record<string, unknown>;
  path: JsonPath;
  ctx: RowCtx;
  variant: "object" | "nested" | "item";
  badge?: string;
  /** An enclosing card is already marked; stay muted but don't repeat the
   * badge on every nested pointer. */
  insideImmutable?: boolean;
}) {
  const selected = pathsEqual(path, ctx.cursorPath);
  const collapsed = ctx.isCollapsed(path);
  const entries = Object.entries(value).filter(([k]) => k !== "class");
  // Objects NetBox cannot own read differently, so an edit that can never be
  // pushed is obvious before it is made.
  const immutability = immutabilityOf(value);
  const immutable = Boolean(immutability) || insideImmutable;
  const unsupported = ctx.unsupportedRule(value);
  return (
    <div
      className={`obj-card ${variant}${selected ? " selected" : ""}${ctx.isModified(path) ? " modified" : ""}${collapsed ? " collapsed" : ""}${immutable ? " immutable" : ""}${ctx.isRelated(path) ? " related" : ""}${ctx.matchesSearch(path) ? "" : " unmatched"}${unsupported ? (unsupported.mode === "review" ? " review-item" : " unsupported-item") : ""}`}
    >
      <div
        className="obj-card-head"
        title={path.map(String).join(" › ")}
        {...hoverProps(path, ctx)}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect(path);
        }}
      >
        <Chevron path={path} ctx={ctx} />
        <span className="obj-name">{label}</span>
        {badge && <span className="obj-class">{badge}</span>}
        {immutability && !insideImmutable && (
          <span className="obj-readonly" title={immutability.reason}>
            {immutability.badge}
          </span>
        )}
        {ctx.isModified(path) && (
          <span
            className="obj-edited"
            title="Differs from the loaded baseline — a push would write this"
          >
            edited
          </span>
        )}
        {unsupported && (
          <span
            className={`obj-unsupported${unsupported.mode === "review" ? " review" : ""}`}
            title={
              unsupported.reason ??
              (unsupported.mode === "review"
                ? "marked as requiring review by this deployment's configuration"
                : "marked unsupported by this deployment's configuration")
            }
          >
            {unsupported.mode === "review" ? "requires review" : "unsupported"}
            {unsupported.mode === "hard" ? " · locked" : ""}
          </span>
        )}
        {collapsed && entries.length > 0 && (
          <span className="fold-summary">
            {entries.length} propert{entries.length === 1 ? "y" : "ies"}
          </span>
        )}
        <span className="obj-spacer" />
        <DeleteBtn path={path} ctx={ctx} title={`Remove ${label}`} />
      </div>
      {!collapsed && (
        <div className="obj-card-body">
          {entries.length === 0 && (
            <div className="simple-empty">no properties yet</div>
          )}
          {entries.map(([k, v]) => (
            <Node
              key={k}
              nodeKey={k}
              value={v}
              path={[...path, k]}
              ctx={ctx}
              insideImmutable={immutable}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Array of objects: each item is its own card, plus an add row.
function ObjectList({
  label,
  items,
  path,
  ctx,
}: {
  label: string;
  items: unknown[];
  path: JsonPath;
  ctx: RowCtx;
}) {
  return (
    <div className="simple-group">
      <div className="simple-group-head">
        <Chevron path={path} ctx={ctx} />
        <span
          className="simple-key"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect(path);
          }}
        >
          {label}
        </span>
        <span className="simple-count">{items.length}</span>
        <DeleteBtn path={path} ctx={ctx} title={`Remove ${label}`} />
      </div>
      {!ctx.isCollapsed(path) && (
      <div className="simple-group-body">
        {items.map((v, i) => {
          const itemPath = [...path, i];
          if (isPlainObject(v)) {
            const hint =
              (typeof v.name === "string" && v.name) ||
              (typeof v.type === "string" && v.type) ||
              undefined;
            return (
              <ObjectCard
                key={i}
                label={`#${i + 1}`}
                badge={hint}
                value={v}
                path={itemPath}
                ctx={ctx}
                variant="item"
              />
            );
          }
          return (
            <Node key={i} nodeKey={`#${i + 1}`} value={v} path={itemPath} ctx={ctx} />
          );
        })}
        <div
          className="simple-row simple-add"
          onClick={(e) => {
            e.stopPropagation();
            ctx.appendObjectItem(path, items.length);
          }}
        >
          + add {singularize(label)}
        </div>
      </div>
      )}
    </div>
  );
}

function Node({
  nodeKey,
  value,
  path,
  ctx,
  insideImmutable,
}: {
  nodeKey: string;
  value: unknown;
  path: JsonPath;
  ctx: RowCtx;
  insideImmutable?: boolean;
}) {
  if (isBase64Wrapper(value) || !isPlainObject(value)) {
    if (Array.isArray(value)) {
      return isScalarArray(value) ? (
        <ScalarList label={nodeKey} items={value} path={path} ctx={ctx} />
      ) : (
        <ObjectList label={nodeKey} items={value} path={path} ctx={ctx} />
      );
    }
    return <ValueRow label={nodeKey} value={value} path={path} ctx={ctx} />;
  }
  return (
    <ObjectCard
      label={nodeKey}
      badge={typeof value.class === "string" ? value.class : undefined}
      value={value}
      path={path}
      ctx={ctx}
      variant={typeof value.class === "string" ? "object" : "nested"}
      insideImmutable={insideImmutable}
    />
  );
}


// ---- pane ------------------------------------------------------------------

export default function SimplifiedPane({
  doc,
  cursorPath,
  isModified,
  onSelect,
  getInlineSpec,
  onEditValue,
  onEditMany,
  onAppendObjectItem,
  onHoverPath,
  relatedKeys,
  searchKeys = null,
  unsupportedForValue,
  lockedKeys,
}: SimplifiedPaneProps) {
  const [editingPath, setEditingPath] = useState<JsonPath | null>(null);
  const [foldTick, setFoldTick] = useState(0);
  void foldTick; // re-render trigger for the shared fold set
  // Items appended empty: cancelled/blank edits remove them again.
  const freshItems = useRef(new Set<string>());

  // Reveal on navigation: whatever the cursor moves to (from the tree, the
  // editor, or a click here) is unfolded along with its ancestors, so a
  // selection never lands out of sight. Folding a card doesn't move the
  // cursor, so the fold button still works on the selected card.
  const cursorKey = pathKey(cursorPath);
  useEffect(() => {
    if (collapsedPaths.size === 0) return;
    let changed = false;
    for (let i = 0; i <= cursorPath.length; i++) {
      if (collapsedPaths.delete(pathKey(cursorPath.slice(0, i)))) changed = true;
    }
    if (changed) setFoldTick((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorKey]);

  // Bring the far end of the reference into view when it is off screen.
  const relatedKey = [...relatedKeys].sort().join("|");
  useEffect(() => {
    revealRelated(document.querySelector(".simple-pane"), ".related");
  }, [relatedKey]);

  if (!isPlainObject(doc)) {
    return (
      <div className="simple-pane">
        <div className="pane-placeholder">
          Fix the JSON to see the simplified view.
        </div>
      </div>
    );
  }

  const toggleCollapse = (path: JsonPath) => {
    const key = pathKey(path);
    if (collapsedPaths.has(key)) collapsedPaths.delete(key);
    else collapsedPaths.add(key);
    setFoldTick((n) => n + 1);
  };

  const isCollapsed = (path: JsonPath) => collapsedPaths.has(pathKey(path));

  const setAllCollapsed = (collapse: boolean) => {
    collapsedPaths.clear();
    if (collapse) {
      const paths: string[] = [];
      collectFoldablePaths(doc, [], paths);
      for (const p of paths) collapsedPaths.add(p);
    }
    setFoldTick((n) => n + 1);
  };

  const ctx: RowCtx = {
    hover: onHoverPath,
    isRelated: (path) => relatedKeys.has(pathKey(path)),
    matchesSearch: (path) =>
      searchKeys === null || searchKeys.has(pathKey(path)),
    unsupportedRule: (value) => unsupportedForValue?.(value),
    isLocked: (path) => {
      if (!lockedKeys || lockedKeys.size === 0) return false;
      for (let i = 1; i <= path.length; i++)
        if (lockedKeys.has(pathKey(path.slice(0, i)))) return true;
      return false;
    },
    cursorPath,
    isCollapsed,
    toggleCollapse,
    isModified,
    onSelect,
    editingPath,
    startEdit: (path) => {
      // Editing a value also selects it: the breadcrumb, the info pane and the
      // reference highlighting all follow the cursor, and clicking a value is
      // the obvious way to ask "what is this, and what does it point at?".
      onSelect(path);
      // Inside a hard-blacklisted object, selection still works but the
      // editor does not open — badge+lock, delete allowed, never hidden.
      if (ctx.isLocked(path)) return;
      setEditingPath(path);
    },
    deleteAt: (path) => onEditValue(path, undefined),
    appendItem: (arrayPath, length) => {
      const itemPath = [...arrayPath, length];
      freshItems.current.add(pathKey(itemPath));
      onEditValue(itemPath, "");
      setEditingPath(itemPath);
    },
    appendObjectItem: (arrayPath, length) =>
      onAppendObjectItem(arrayPath, length),
    previewBase64: (wrapper) => {
      const d = decodeBase64Safely(wrapper.base64);
      const firstLine = d.text.split("\n")[0] ?? "";
      return d.isText
        ? firstLine.slice(0, 60) + (d.text.length > firstLine.length || firstLine.length > 60 ? " …" : "")
        : "(binary)";
    },
    commitValue: (path, value) => {
      onEditValue(path, value);
      setEditingPath(null);
    },
    cancelEdit: () => setEditingPath(null),
    renderEditor: (path, value) => {
      const spec = getInlineSpec(path, value);
      const isItem = typeof path[path.length - 1] === "number";
      return (
        <InlineEditor
          spec={spec}
          initial={value}
          onCommitExternal={(fullPath) => {
            // The pointer object itself is replaced, not the row: a use-name
            // and a bigip-path are different shapes.
            onEditValue(spec.externalTargetPath ?? path, { bigip: fullPath });
            setEditingPath(null);
          }}
          onCommit={(v, wasEnter) => {
            const fresh = freshItems.current.delete(pathKey(path));
            if (isItem && v === "") {
              // Blank items are junk — drop them (fresh or not).
              onEditValue(path, undefined);
              setEditingPath(null);
              return;
            }
            if (isItem && wasEnter) {
              // Commit + append the next item in one atomic edit.
              const arrayPath = path.slice(0, -1);
              const arr = (doc &&
                (path
                  .slice(0, -1)
                  .reduce<unknown>(
                    (acc, seg) =>
                      acc && typeof acc === "object"
                        ? (acc as Record<string | number, unknown>)[seg]
                        : undefined,
                    doc
                  ) as unknown[])) as unknown[] | undefined;
              const nextIndex = arr ? arr.length : Number(path[path.length - 1]) + 1;
              const nextPath = [...arrayPath, nextIndex];
              freshItems.current.add(pathKey(nextPath));
              onEditMany([
                [path, v],
                [nextPath, ""],
              ]);
              setEditingPath(nextPath);
              return;
            }
            if (v !== value || fresh) onEditValue(path, v);
            setEditingPath(null);
          }}
          onCancel={() => {
            if (freshItems.current.delete(pathKey(path))) {
              onEditValue(path, undefined);
            }
            setEditingPath(null);
          }}
        />
      );
    },
  };

  return (
    <div className="simple-pane" onClick={() => onSelect([])}>
      <div className="simple-tools" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setAllCollapsed(true)}>Collapse all</button>
        <button onClick={() => setAllCollapsed(false)}>Expand all</button>
      </div>
      {Object.entries(doc).map(([k, v]) => (
        <Node key={k} nodeKey={k} value={v} path={[k]} ctx={ctx} />
      ))}
      <p className="simple-hint">
        Click a key to focus it, click a value to edit it. In lists, Enter
        commits and starts the next item. Add properties from the panel on
        the right; switch to JSON for raw editing.
      </p>
    </div>
  );
}
