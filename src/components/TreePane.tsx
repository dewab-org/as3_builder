import { useEffect } from "react";
import type { JsonPath } from "../engine";
import { isPlainObject, pathKey } from "../engine";
import ConfirmButton from "./ConfirmButton";
import { revealRelated } from "./revealRelated";

interface TreePaneProps {
  doc: unknown;
  isStale: boolean;
  cursorPath: JsonPath;
  onSelect: (path: JsonPath) => void;
  onDelete: (path: JsonPath) => void;
  isModified: (path: JsonPath) => boolean;
  /** Path keys on the other end of the selected reference. */
  relatedKeys: Set<string>;
}

// Deep enough to reach policy rules and their conditions/actions
// (app → policy → rules → rule → conditions → condition).
const MAX_DEPTH = 7;

function pathsEqual(a: JsonPath, b: JsonPath): boolean {
  return a.length === b.length && a.every((seg, i) => String(seg) === String(b[i]));
}

function nodeLabel(key: string | number, value: unknown): string {
  if (isPlainObject(value)) {
    if (typeof value.class === "string") return `${key} (${value.class})`;
    // Array items are indexes; show their name/type so policy rules,
    // conditions and actions are identifiable.
    if (typeof key === "number") {
      const hint =
        (typeof value.name === "string" && value.name) ||
        (typeof value.type === "string" && value.type);
      if (hint) return `#${key + 1} ${hint}`;
      return `#${key + 1}`;
    }
  }
  if (typeof key === "number") return `#${key + 1}`;
  return String(key);
}

function TreeNode({
  nodeKey,
  value,
  path,
  depth,
  cursorPath,
  onSelect,
  onDelete,
  isModified,
  relatedKeys,
}: {
  nodeKey: string | number;
  value: unknown;
  path: JsonPath;
  depth: number;
  cursorPath: JsonPath;
  onSelect: (path: JsonPath) => void;
  onDelete: (path: JsonPath) => void;
  isModified: (path: JsonPath) => boolean;
  relatedKeys: Set<string>;
}) {
  const isBranch =
    (isPlainObject(value) || Array.isArray(value)) && depth < MAX_DEPTH;
  const selected = pathsEqual(path, cursorPath);
  const children: [string | number, unknown][] = !isBranch
    ? []
    : Array.isArray(value)
      ? value.map((v, i): [string | number, unknown] => [i, v])
      : Object.entries(value as Record<string, unknown>);

  return (
    <div className="tree-node">
      <div
        className={`tree-label${selected ? " selected" : ""}${isModified(path) ? " modified" : ""}${relatedKeys.has(pathKey(path)) ? " related" : ""}`}
        onClick={() => onSelect(path)}
        title={path.map(String).join(" › ") || "(root)"}
      >
        <span className="tree-text">{nodeLabel(nodeKey, value)}</span>
        <ConfirmButton
          className="tree-delete"
          title={`Delete ${nodeKey}`}
          armedLabel="del?"
          onConfirm={() => onDelete(path)}
        >
          ✕
        </ConfirmButton>
      </div>
      {isBranch && (
        <div className="tree-children">
          {children
            .filter(([, v]) => isPlainObject(v) || Array.isArray(v))
            .map(([k, v]) => (
              <TreeNode
                key={String(k)}
                nodeKey={k}
                value={v}
                path={[...path, k]}
                depth={depth + 1}
                cursorPath={cursorPath}
                onSelect={onSelect}
                onDelete={onDelete}
                isModified={isModified}
                relatedKeys={relatedKeys}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function TreePane({
  doc,
  isStale,
  cursorPath,
  onSelect,
  onDelete,
  isModified,
  relatedKeys,
}: TreePaneProps) {
  // Reveal the linked node in this pane too — the tree scrolls independently,
  // so the highlight can otherwise land out of sight.
  const relatedKey = [...relatedKeys].sort().join("|");
  useEffect(() => {
    revealRelated(document.querySelector(".pane-tree"), ".tree-label.related");
  }, [relatedKey]);

  if (!isPlainObject(doc)) {
    return <div className="pane-placeholder">No parsed document yet.</div>;
  }
  return (
    <div>
      {isStale && <div className="stale-banner">Stale — fix JSON to refresh</div>}
      <div
        className={`tree-label root${cursorPath.length === 0 ? " selected" : ""}`}
        onClick={() => onSelect([])}
      >
        (declaration)
      </div>
      <div className="tree-children">
        {Object.entries(doc)
          .filter(([, v]) => isPlainObject(v) || Array.isArray(v))
          .map(([k, v]) => (
            <TreeNode
              key={k}
              nodeKey={k}
              value={v}
              path={[k]}
              depth={1}
              cursorPath={cursorPath}
              onSelect={onSelect}
              onDelete={onDelete}
              isModified={isModified}
              relatedKeys={relatedKeys}
            />
          ))}
      </div>
    </div>
  );
}
