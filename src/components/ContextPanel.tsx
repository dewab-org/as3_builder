import { useEffect, useState } from "react";
import type {
  ClassInfo,
  ClassRegistry,
  JsonPath,
  JsonSchemaRoot,
  NodeContext,
  PropertyInfo,
} from "../engine";
import {
  describeSchema,
  definitionDocumentation,
  fieldDocumentation,
  getAtPath,
  indexClassInstances,
  isPlainObject,
  loadAs3Documentation,
  type DocumentationIndex,
} from "../engine";
import HoverDetail from "./HoverDetail";
import PropertyWidget from "./PropertyWidget";
import ConfirmButton from "./ConfirmButton";
import AddableList, {
  type AddableItem,
  type ChipPayload,
} from "./AddableList";
import { f5DocUrl } from "./chips";

interface ContextPanelProps {
  context: NodeContext;
  doc: unknown;
  isStale: boolean;
  memberClasses: ClassInfo[];
  schemaRoot: JsonSchemaRoot;
  registry: ClassRegistry;
  /** Document path the pointer is over, previewed above the panel. */
  hoverPath: JsonPath | null;
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
  schemaRoot,
  registry,
  hoverPath,
  onEdit,
  onNavigate,
  onAddChip,
  onDeleteNode,
  onClassChange,
}: ContextPanelProps) {
  const [documentation, setDocumentation] = useState<DocumentationIndex>();
  useEffect(() => {
    let active = true;
    void loadAs3Documentation().then((index) => {
      if (active) setDocumentation(index);
    });
    return () => {
      active = false;
    };
  }, []);

  const docNode = getAtPath(doc, context.path);

  // Cross-reference options: document objects grouped once, filtered per
  // property by its allowed classes.
  const instances = indexClassInstances(doc);
  const xrefOptionsFor = (classes: string[] | undefined) => {
    if (!classes) return undefined;
    const seen = new Set<string>();
    const out: { name: string; className: string }[] = [];
    for (const inst of instances) {
      if (classes.length > 0 && !classes.includes(inst.className)) continue;
      if (seen.has(inst.name)) continue;
      seen.add(inst.name);
      out.push({ name: inst.name, className: inst.className });
    }
    return out.length > 0 ? out : undefined;
  };

  // A member object with no class yet: the schema can't say anything useful
  // until the discriminator is chosen, so offer the class picker first.
  const classProp = context.schema?.properties?.class;
  const needsClass =
    context.path.length > 0 &&
    !context.className &&
    isPlainObject(docNode) &&
    classProp !== undefined;

  // Everything the schema knows about a property, for detail cards and ⓘ.
  const detailFor = (p: PropertyInfo) => {
    const augmentation = fieldDocumentation(
      documentation,
      context.className,
      p.name
    );
    const docs = describeSchema(schemaRoot, p.schema, undefined, augmentation);
    return {
      type: docs.type === "enum" ? "string (enum)" : docs.type,
      description: docs.description ?? p.description,
      behavior: docs.behavior,
      defaultValue: docs.defaultValue ?? p.default,
      enumValues: docs.enumValues ?? p.enumValues,
      constraints: docs.constraints,
      branches: docs.branches,
      xrefClasses: p.xrefClasses,
      required: p.required,
      docClass: context.className,
      tmsh: docs.tmsh,
      schemaReference: definitionDocumentation(documentation, context.className)
        ?.documentation.schemaReference,
    };
  };

  const addableItems: AddableItem[] = context.addableProps.map((p) => ({
    key: p.name,
    label: p.name,
    typeBadge: p.type,
    required: p.required,
    detail: detailFor(p),
    payload: { name: p.name, sourcePath: context.path },
  }));

  const classItems: AddableItem[] = [...memberClasses]
    .sort((a, b) => a.className.localeCompare(b.className))
    .map((c) => {
      const docs = definitionDocumentation(documentation, c.definitionName);
      return {
        key: c.className,
        label: c.className,
        detail: {
          type: "object",
          description: docs?.schemaDescription ?? c.description,
          behavior: docs?.behavior,
          required: false,
          docClass: c.className,
          allowedFields: docs?.allowedFields,
          tmsh: docs?.tmsh,
          schemaReference: docs?.documentation.schemaReference,
        },
        payload: {
          name: c.className,
          sourcePath: context.path,
          isClassObject: true,
          className: c.className,
        },
      };
    });

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
      {hoverPath && (
        <HoverDetail
          path={hoverPath}
          doc={doc}
          schemaRoot={schemaRoot}
          registry={registry}
          documentation={documentation}
        />
      )}
      <div className="ctx-breadcrumb">
        <span className="ctx-crumb-text">
          {context.breadcrumb}
          {context.className && (
            <a
              className="ctx-doclink"
              href={f5DocUrl(context.className)}
              target="_blank"
              rel="noreferrer"
              title={`Official F5 schema reference for ${context.className}`}
            >
              docs ↗
            </a>
          )}
        </span>
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
                xrefOptions={xrefOptionsFor(p.xrefClasses)}
                detail={detailFor(p)}
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
