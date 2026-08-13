export interface TmshEquivalency {
  objectType: string | string[];
  property?: string;
  inspectionCommand?: string;
  reference?: string | string[];
  mappingSource?: string;
  valueMap?: { true?: unknown; false?: unknown };
  expansion?: string;
  quotedString?: boolean;
}

export interface FieldDocumentation {
  title: string;
  types: string[];
  required: boolean;
  conditionallyRequired: boolean;
  schemaDescription: string;
  behavior: string;
  behaviorSource: string;
  allowed: Record<string, unknown>;
  default?: unknown;
  tmsh?: TmshEquivalency;
}

export interface DefinitionDocumentation {
  title: string;
  types: string[];
  class?: string;
  schemaDescription: string;
  behavior: string;
  behaviorSource: string;
  allowedFields: string[];
  fields: Record<string, FieldDocumentation>;
  documentation: { schemaReference: string };
  tmsh?: TmshEquivalency;
}

export interface DocumentationIndex {
  format: string;
  formatVersion: number;
  generatedFrom: {
    schemaFile: string;
    schemaVersion: string;
    schemaSha256: string;
    implementation?: {
      repository: string;
      version: string;
      license: string;
      classesFile: string;
      classesSha256: string;
      propertiesFile: string;
      propertiesSha256: string;
    };
  };
  tmshNotice: string;
  definitions: Record<string, DefinitionDocumentation>;
}

let documentationPromise: Promise<DocumentationIndex> | undefined;
const classIndexes = new WeakMap<
  DocumentationIndex,
  Map<string, DefinitionDocumentation>
>();

/** Load the large normalized index as a separate, cacheable Vite chunk. */
export function loadAs3Documentation(): Promise<DocumentationIndex> {
  documentationPromise ??= import(
    "../schemas/as3-documentation-3.56.0-10.json"
  ).then((module) => module.default as DocumentationIndex);
  return documentationPromise;
}

function classIndex(
  documentation: DocumentationIndex
): Map<string, DefinitionDocumentation> {
  const cached = classIndexes.get(documentation);
  if (cached) return cached;
  const index = new Map<string, DefinitionDocumentation>();
  for (const [definitionName, definition] of Object.entries(
    documentation.definitions
  )) {
    if (!definition.class) continue;
    const current = index.get(definition.class);
    // Match classRegistry's preference for a definition named exactly like
    // the class (important for Application and generic Monitor definitions).
    if (!current || definitionName === definition.class) {
      index.set(definition.class, definition);
    }
  }
  classIndexes.set(documentation, index);
  return index;
}

/** Look up by JSON Schema definition name or AS3 class discriminator. */
export function definitionDocumentation(
  documentation: DocumentationIndex | undefined,
  definitionOrClass: string | undefined
): DefinitionDocumentation | undefined {
  if (!documentation || !definitionOrClass) return undefined;
  return (
    documentation.definitions[definitionOrClass] ??
    classIndex(documentation).get(definitionOrClass)
  );
}

/** Look up the normalized documentation for a field on an AS3 class. */
export function fieldDocumentation(
  documentation: DocumentationIndex | undefined,
  definitionOrClass: string | undefined,
  fieldName: string
): FieldDocumentation | undefined {
  return definitionDocumentation(documentation, definitionOrClass)?.fields[
    fieldName
  ];
}
