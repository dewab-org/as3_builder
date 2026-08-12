import type { ClassInfo, JsonPath, NodeContext } from "../engine";
import { getAtPath, isPlainObject } from "../engine";
import PropertyWidget from "./PropertyWidget";
import ConfirmButton from "./ConfirmButton";
import AddableList, {
  type AddableItem,
  type ChipPayload,
} from "./AddableList";

interface ContextPanelProps {
  context: NodeContext;
  doc: unknown;
  isStale: boolean;
  memberClasses: ClassInfo[];
  onEdit: (path: JsonPath, value: unknown) => void;
  onNavigate: (path: JsonPath) => void;
  onAddChip: (payload: ChipPayload) => void;
  onDeleteNode: (path: JsonPath) => void;
  onClassChange: (path: JsonPath, className: string) => void;
}

export default function ContextPanel({
  context,
  doc,
  isStale,
  memberClasses,
  onEdit,
  onNavigate,
  onAddChip,
  onDeleteNode,
  onClassChange,
}: ContextPanelProps) {
  const docNode = getAtPath(doc, context.path);

  // A member object with no class yet: the schema can't say anything useful
  // until the discriminator is chosen, so offer the class picker first.
  const classProp = context.schema?.properties?.class;
  const needsClass =
    context.path.length > 0 &&
    !context.className &&
    isPlainObject(docNode) &&
    classProp !== undefined;

  const addableItems: AddableItem[] = context.addableProps.map((p) => ({
    key: p.name,
    label: p.name,
    typeBadge: p.type,
    required: p.required,
    detail: {
      type: p.type === "enum" ? "string (enum)" : p.type,
      description: p.description,
      defaultValue: p.default,
      enumValues: p.enumValues,
      xrefClasses: p.xrefClasses,
      required: p.required,
    },
    payload: { name: p.name, sourcePath: context.path },
  }));

  const classItems: AddableItem[] = [...memberClasses]
    .sort((a, b) => a.className.localeCompare(b.className))
    .map((c) => ({
    key: c.className,
    label: c.className,
    detail: {
      type: "object",
      description: c.description,
      required: false,
    },
    payload: {
      name: c.className,
      sourcePath: context.path,
      isClassObject: true,
      className: c.className,
    },
  }));

  // Class choices for the class dropdown: sibling-level member classes, plus
  // the current class if it's something else (e.g. Application itself).
  const classOptions = memberClasses.map((c) => c.className).sort();
  if (context.className && !classOptions.includes(context.className)) {
    classOptions.unshift(context.className);
  }

  const nodeName =
    context.path.length > 0
      ? String(context.path[context.path.length - 1])
      : undefined;

  return (
    <div>
      {isStale && <div className="stale-banner">Stale — fix JSON to refresh</div>}
      <div className="ctx-breadcrumb">
        <span className="ctx-crumb-text">{context.breadcrumb}</span>
        {nodeName !== undefined && (
          <ConfirmButton
            className="ctx-delete"
            title={`Delete ${nodeName}`}
            armedLabel="delete?"
            onConfirm={() => onDeleteNode(context.path)}
          >
            🗑
          </ConfirmButton>
        )}
      </div>

      {!context.schema && (
        <div className="pane-placeholder">
          No schema context for this location.
        </div>
      )}

      {needsClass && (
        <div className="ctx-section">
          <h3>Choose a class</h3>
          <p className="ctx-hint">
            This object has no <code>class</code> yet. Pick one to unlock its
            properties.
          </p>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onClassChange(context.path, e.target.value);
            }}
          >
            <option value="" disabled>
              Select class…
            </option>
            {memberClasses.map((c) => (
              <option key={c.className} value={c.className}>
                {c.className}
              </option>
            ))}
          </select>
        </div>
      )}

      {context.schema && !needsClass && context.presentProps.length > 0 && (
        <div className="ctx-section">
          <h3>Properties</h3>
          {context.presentProps.map((p) =>
            p.name === "class" && context.path.length > 0 ? (
              <div className="pw-wrap" key={p.name}>
                <div className="pw-row" title="Object class">
                  <span className="pw-name required">class</span>
                  <select
                    value={context.className ?? ""}
                    onChange={(e) => {
                      if (e.target.value && e.target.value !== context.className)
                        onClassChange(context.path, e.target.value);
                    }}
                  >
                    {classOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="pw-delete-spacer" />
                </div>
              </div>
            ) : (
              <PropertyWidget
                key={p.name}
                prop={p}
                value={isPlainObject(docNode) ? docNode[p.name] : undefined}
                contextPath={context.path}
                onEdit={onEdit}
                onNavigate={onNavigate}
              />
            )
          )}
        </div>
      )}

      {context.schema && !needsClass && context.unknownProps.length > 0 && (
        <div className="ctx-section ctx-invalid">
          <h3>
            Invalid for {context.className ?? "this object"}
            <ConfirmButton
              className="ctx-remove-all"
              title="Remove all invalid properties"
              armedLabel="click to confirm"
              onConfirm={() =>
                context.unknownProps.forEach((u) =>
                  onEdit([...context.path, u.name], undefined)
                )
              }
            >
              Remove all
            </ConfirmButton>
          </h3>
          <p className="ctx-hint">
            These properties exist in the document but are not allowed by the
            current class — usually left over after a class change.
          </p>
          {context.unknownProps.map((u) => (
            <div className="pw-wrap" key={u.name}>
              <div className="pw-row invalid-row">
                <span className="pw-name invalid">{u.name}</span>
                <span className="pw-summary">{u.valueType}</span>
                <button
                  className="pw-delete"
                  title={`Remove ${u.name}`}
                  onClick={() => onEdit([...context.path, u.name], undefined)}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {context.schema && !needsClass && addableItems.length > 0 && (
        <div className="ctx-section">
          <h3>Add property</h3>
          <p className="ctx-hint">
            Drag into the editor, double-click, or press +.
          </p>
          <AddableList items={addableItems} onAdd={onAddChip} />
        </div>
      )}

      {context.isApplication && (
        <div className="ctx-section">
          <h3>Add object</h3>
          <p className="ctx-hint">
            New named object in this application (drag, double-click, or +).
          </p>
          <AddableList items={classItems} onAdd={onAddChip} />
        </div>
      )}
    </div>
  );
}
