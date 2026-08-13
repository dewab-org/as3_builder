import type { JsonPath } from "../engine";
import { isPlainObject } from "../engine";

// Indented key-value rendering of the document, without JSON syntax.
// Read-focused: clicking a row moves the cursor/context (editing continues
// through the context panel); the JSON view stays the source of truth.

interface SimplifiedPaneProps {
  doc: unknown;
  cursorPath: JsonPath;
  isModified: (path: JsonPath) => boolean;
  onSelect: (path: JsonPath) => void;
}

function pathsEqual(a: JsonPath, b: JsonPath): boolean {
  return a.length === b.length && a.every((s, i) => String(s) === String(b[i]));
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
  return <span className={`sv ${cls}`}>{String(value)}</span>;
}

function isScalarArray(v: unknown): v is unknown[] {
  return Array.isArray(v) && v.every((x) => !isPlainObject(x) && !Array.isArray(x));
}

function Row({
  label,
  value,
  path,
  depth,
  badge,
  cursorPath,
  isModified,
  onSelect,
}: {
  label: string;
  value?: unknown;
  path: JsonPath;
  depth: number;
  badge?: string;
  cursorPath: JsonPath;
  isModified: (path: JsonPath) => boolean;
  onSelect: (path: JsonPath) => void;
}) {
  const selected = pathsEqual(path, cursorPath);
  return (
    <div
      className={`simple-row${selected ? " selected" : ""}${isModified(path) ? " modified" : ""}`}
      style={{ paddingLeft: 8 + depth * 18 }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path);
      }}
      title={path.map(String).join(" › ")}
    >
      <span className="simple-key">{label}</span>
      {badge && <span className="simple-badge">{badge}</span>}
      {value !== undefined && <ScalarValue value={value} />}
    </div>
  );
}

function Node({
  nodeKey,
  value,
  path,
  depth,
  cursorPath,
  isModified,
  onSelect,
}: {
  nodeKey: string;
  value: unknown;
  path: JsonPath;
  depth: number;
  cursorPath: JsonPath;
  isModified: (path: JsonPath) => boolean;
  onSelect: (path: JsonPath) => void;
}) {
  const common = { cursorPath, isModified, onSelect };

  if (isPlainObject(value)) {
    const badge =
      typeof value.class === "string" ? String(value.class) : undefined;
    return (
      <div>
        <Row label={nodeKey} path={path} depth={depth} badge={badge} {...common} />
        {Object.entries(value)
          .filter(([k]) => k !== "class")
          .map(([k, v]) => (
            <Node
              key={k}
              nodeKey={k}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              {...common}
            />
          ))}
      </div>
    );
  }

  if (isScalarArray(value)) {
    return (
      <div>
        <Row label={nodeKey} path={path} depth={depth} {...common} />
        {value.map((v, i) => (
          <div
            key={i}
            className="simple-row simple-item"
            style={{ paddingLeft: 8 + (depth + 1) * 18 }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect([...path, i]);
            }}
          >
            <span className="simple-dash">–</span>
            <ScalarValue value={v} />
          </div>
        ))}
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div>
        <Row label={nodeKey} path={path} depth={depth} {...common} />
        {value.map((v, i) => (
          <Node
            key={i}
            nodeKey={`#${i + 1}`}
            value={v}
            path={[...path, i]}
            depth={depth + 1}
            {...common}
          />
        ))}
      </div>
    );
  }

  return <Row label={nodeKey} value={value} path={path} depth={depth} {...common} />;
}

export default function SimplifiedPane({
  doc,
  cursorPath,
  isModified,
  onSelect,
}: SimplifiedPaneProps) {
  if (!isPlainObject(doc)) {
    return (
      <div className="simple-pane">
        <div className="pane-placeholder">
          Fix the JSON to see the simplified view.
        </div>
      </div>
    );
  }
  return (
    <div className="simple-pane" onClick={() => onSelect([])}>
      {Object.entries(doc).map(([k, v]) => (
        <Node
          key={k}
          nodeKey={k}
          value={v}
          path={[k]}
          depth={0}
          cursorPath={cursorPath}
          isModified={isModified}
          onSelect={onSelect}
        />
      ))}
      <p className="simple-hint">
        Read-focused view — edit values in the panel on the right, or switch
        back to JSON for raw editing.
      </p>
    </div>
  );
}
