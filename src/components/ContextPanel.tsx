import type { ClassInfo, JsonPath, NodeContext } from "../engine";
import { getAtPath, isPlainObject } from "../engine";
import PropertyWidget from "./PropertyWidget";
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
}

export default function ContextPanel({
  context,
  doc,
  isStale,
  memberClasses,
  onEdit,
  onNavigate,
  onAddChip,
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

  const classItems: AddableItem[] = memberClasses.map((c) => ({
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

  return (
    <div>
      {isStale && <div className="stale-banner">Stale — fix JSON to refresh</div>}
      <div className="ctx-breadcrumb">{context.breadcrumb}</div>

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
              if (e.target.value)
                onEdit([...context.path, "class"], e.target.value);
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
          {context.presentProps.map((p) => (
            <PropertyWidget
              key={p.name}
              prop={p}
              value={isPlainObject(docNode) ? docNode[p.name] : undefined}
              contextPath={context.path}
              onEdit={onEdit}
              onNavigate={onNavigate}
            />
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
