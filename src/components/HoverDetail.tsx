import type {
  ClassRegistry,
  DocumentationIndex,
  JsonPath,
  JsonSchemaRoot,
} from "../engine";
import {
  definitionDocumentation,
  describeSchema,
  fieldDocumentation,
  getAtPath,
  isPlainObject,
  resolveSchemaForPath,
} from "../engine";
import { DetailCard, type AddableDetail } from "./AddableList";

interface HoverDetailProps {
  path: JsonPath;
  doc: unknown;
  schemaRoot: JsonSchemaRoot;
  registry: ClassRegistry;
  documentation: DocumentationIndex | undefined;
}

/** Nearest enclosing object that names a class — how the docs index is keyed. */
function owningClass(doc: unknown, path: JsonPath): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = getAtPath(doc, path.slice(0, i));
    if (isPlainObject(node) && typeof node.class === "string") return node.class;
  }
  return undefined;
}

/**
 * The same detail card the property picker shows, for whatever the pointer is
 * over in the document. Hovering a value answers "what is this and what may it
 * be?" without having to click into it and lose the current selection.
 */
export default function HoverDetail({
  path,
  doc,
  schemaRoot,
  registry,
  documentation,
}: HoverDetailProps) {
  if (path.length === 0) return null;
  const schema = resolveSchemaForPath(schemaRoot, registry, doc, path);
  if (!schema) return null;

  const value = getAtPath(doc, path);
  const name = String(path[path.length - 1]);
  const ownClass =
    isPlainObject(value) && typeof value.class === "string"
      ? value.class
      : undefined;

  // An object that is itself a class documents as that class; anything else
  // documents as a field of the class it lives in.
  const classDocs = ownClass
    ? definitionDocumentation(documentation, ownClass)
    : undefined;
  const parentClass = owningClass(doc, path);
  const fieldDocs = ownClass
    ? undefined
    : fieldDocumentation(documentation, parentClass, name);

  const docs = describeSchema(schemaRoot, schema, value, fieldDocs);
  const detail: AddableDetail = {
    type: docs.type === "enum" ? "string (enum)" : docs.type,
    description: classDocs?.schemaDescription ?? docs.description,
    behavior: classDocs?.behavior ?? docs.behavior,
    defaultValue: docs.defaultValue,
    enumValues: docs.enumValues,
    constraints: docs.constraints,
    branches: docs.branches,
    allowedFields: classDocs?.allowedFields,
    tmsh: classDocs?.tmsh ?? docs.tmsh,
    docClass: ownClass ?? parentClass,
    schemaReference:
      classDocs?.documentation.schemaReference ??
      definitionDocumentation(documentation, parentClass)?.documentation
        .schemaReference,
  };

  return (
    <div className="hover-preview">
      <div className="hover-preview-label">Hovering</div>
      <DetailCard label={ownClass ?? name} detail={detail} />
    </div>
  );
}
