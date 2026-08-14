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
import type { AddableDetail } from "./AddableList";

/** Nearest enclosing object that names a class — how the docs index is keyed. */
function owningClass(doc: unknown, path: JsonPath): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const node = getAtPath(doc, path.slice(0, i));
    if (isPlainObject(node) && typeof node.class === "string") return node.class;
  }
  return undefined;
}

/**
 * What to say about the node at `path`: the same detail the property picker
 * shows, assembled from the schema and the generated F5 documentation.
 *
 * Returns undefined when there is nothing to say — an unresolvable path, or
 * the document root — so callers can skip rendering an empty card.
 */
export function hoverDetail(
  path: JsonPath,
  doc: unknown,
  schemaRoot: JsonSchemaRoot,
  registry: ClassRegistry,
  documentation: DocumentationIndex | undefined
): { label: string; detail: AddableDetail } | undefined {
  if (path.length === 0) return undefined;
  const schema = resolveSchemaForPath(schemaRoot, registry, doc, path);
  if (!schema) return undefined;

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
  return { label: ownClass ?? name, detail };
}
