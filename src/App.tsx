import { useCallback, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { findNodeAtLocation, getLocation, parse, parseTree } from "jsonc-parser";
import Toolbar from "./components/Toolbar";
import EditorPane from "./components/EditorPane";
import TreePane from "./components/TreePane";
import ContextPanel from "./components/ContextPanel";
import type { ChipPayload } from "./components/AddableList";
import { DEFAULT_SCHEMA_ID, getSchema } from "./schemas";
import { getTemplate } from "./templates";
import { useDocument } from "./hooks/useDocument";
import {
  applicationMemberClasses,
  buildClassRegistry,
  effectiveSchema,
  getAtPath,
  getContext,
  isPlainObject,
  resolveSchemaForPath,
  stubValue,
  type JsonPath,
  type JsonSchemaRoot,
} from "./engine";

const INITIAL_TEXT = getTemplate("http-app").content;

function monacoRangeFor(
  model: editor.ITextModel,
  offset: number,
  length: number
) {
  const start = model.getPositionAt(offset);
  const end = model.getPositionAt(offset + length);
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column,
  };
}

export default function App() {
  const [schemaId, setSchemaId] = useState(DEFAULT_SCHEMA_ID);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [baselineText, setBaselineText] = useState(INITIAL_TEXT);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const docState = useDocument(INITIAL_TEXT);
  const {
    text,
    setText,
    debouncedText,
    lastGoodDoc,
    isStale,
    applyEdit,
    applyEditMany,
  } = docState;

  const schemaEntry = useMemo(() => getSchema(schemaId), [schemaId]);
  const root = schemaEntry.schema as JsonSchemaRoot;
  const registry = useMemo(() => buildClassRegistry(root), [root]);
  const memberClasses = useMemo(
    () => applicationMemberClasses(root, registry),
    [root, registry]
  );

  const context = useMemo(
    () => getContext(root, registry, debouncedText, cursorOffset),
    [root, registry, debouncedText, cursorOffset]
  );

  function loadText(newText: string) {
    setText(newText);
    setBaselineText(newText);
    setCursorOffset(0);
  }

  // Move the Monaco cursor to the value at `path`. Strings land BETWEEN the
  // quotes so typing replaces/fills the value; objects/arrays land just
  // inside the bracket. With `flash`, the value briefly highlights so the
  // user sees where input is expected.
  const navigateToPath = useCallback(
    (path: JsonPath, opts?: { flash?: boolean; flashChildren?: string[] }) => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (!ed || !model) return;
      const tree = parseTree(model.getValue(), [], {
        allowTrailingComma: true,
      });
      if (!tree) return;
      const node = path.length === 0 ? tree : findNodeAtLocation(tree, path);
      if (!node) return;
      const inside =
        node.type === "object" || node.type === "array" || node.type === "string"
          ? node.offset + 1
          : node.offset;
      const pos = model.getPositionAt(inside);
      ed.setPosition(pos);
      ed.revealPositionInCenterIfOutsideViewport(pos);
      ed.focus();
      setCursorOffset(inside);
      // Highlight where input is expected: specific child property values
      // (flashChildren) or the whole navigated value (flash).
      const flashNodes =
        opts?.flashChildren && opts.flashChildren.length > 0
          ? opts.flashChildren
              .map((name) => findNodeAtLocation(tree, [...path, name]))
              .filter((n): n is NonNullable<typeof n> => n !== undefined)
          : opts?.flash
            ? [node]
            : [];
      if (flashNodes.length > 0) {
        const deco = ed.createDecorationsCollection(
          flashNodes.map((n) => ({
            range: monacoRangeFor(model, n.offset, n.length),
            options: { className: "inserted-flash" },
          }))
        );
        setTimeout(() => deco.clear(), 2500);
      }
    },
    []
  );

  // When the offset sits inside a VALUE whose schema offers a closed set of
  // choices (enum, boolean, const), return the offset at the START of that
  // value (inside the quote for strings) — clicking there should pop the
  // full suggestion list so the user can pick instead of type. Returns null
  // for free-form values.
  const choiceValueStartAt = useCallback(
    (editorText: string, offset: number): number | null => {
      const loc = getLocation(editorText, offset);
      if (loc.isAtPropertyKey || loc.path.length === 0) return null;
      const node = loc.previousNode;
      if (!node) return null;
      if (offset < node.offset || offset > node.offset + node.length)
        return null;
      const doc = parse(editorText, [], { allowTrailingComma: true }) as unknown;
      const schema = resolveSchemaForPath(
        root,
        registry,
        doc,
        loc.path as JsonPath
      );
      if (!schema) return null;
      try {
        const eff = effectiveSchema(root, schema);
        const isChoice =
          (eff.enum?.length ?? 0) > 0 ||
          eff.const !== undefined ||
          eff.type === "boolean";
        if (!isChoice) return null;
        return node.type === "string" ? node.offset + 1 : node.offset;
      } catch {
        return null;
      }
    },
    [root, registry]
  );

  const handleEdit = useCallback(
    (path: JsonPath, value: unknown) => {
      applyEdit(path, value);
    },
    [applyEdit]
  );

  // After applyEdit, the Monaco model receives the new text on the next React
  // commit; navigating before that clamps the offset. Poll briefly until the
  // model holds the expected text, then jump.
  const navigateWhenReady = useCallback(
    (
      path: JsonPath,
      expectedText: string,
      opts?: { flash?: boolean; flashChildren?: string[] },
      attempt = 0
    ) => {
      const model = editorRef.current?.getModel();
      if (model && model.getValue() === expectedText) {
        navigateToPath(path, opts ?? { flash: true });
        return;
      }
      if (attempt < 20)
        setTimeout(
          () => navigateWhenReady(path, expectedText, opts, attempt + 1),
          25
        );
    },
    [navigateToPath]
  );

  // Setting/changing an object's class: write the class, stub every
  // required property the object is missing, and flash them as needing input.
  const handleClassChange = useCallback(
    (path: JsonPath, className: string) => {
      const info = registry.get(className);
      if (!info) return;
      const stub = stubValue(root, info.schema);
      const existing = getAtPath(lastGoodDoc, path);
      const edits: [JsonPath, unknown][] = [[[...path, "class"], className]];
      const added: string[] = [];
      if (isPlainObject(stub)) {
        for (const [key, value] of Object.entries(stub)) {
          if (key === "class") continue;
          if (isPlainObject(existing) && key in existing) continue;
          edits.push([[...path, key], value]);
          added.push(key);
        }
      }
      const next = applyEditMany(edits);
      navigateWhenReady(path, next, {
        flashChildren: added.length > 0 ? added : undefined,
        flash: added.length === 0,
      });
    },
    [root, registry, lastGoodDoc, applyEditMany, navigateWhenReady]
  );

  const handleDeleteNode = useCallback(
    (path: JsonPath) => {
      if (path.length === 0) return;
      applyEdit(path, undefined);
      navigateToPath(path.slice(0, -1));
    },
    [applyEdit, navigateToPath]
  );

  // Double-click insertion: add the property (or new class object) into the
  // chip's own context. Drag-to-editor lands in Phase 4.
  const handleAddChip = useCallback(
    (payload: ChipPayload) => {
      if (payload.isClassObject && payload.className) {
        const info = registry.get(payload.className);
        if (!info) return;
        const appNode = lastGoodDoc
          ? (payload.sourcePath.reduce<unknown>(
              (acc, seg) =>
                acc && typeof acc === "object"
                  ? (acc as Record<string | number, unknown>)[seg]
                  : undefined,
              lastGoodDoc
            ) as Record<string, unknown> | undefined)
          : undefined;
        let n = 1;
        let name = `new${payload.className.replace(/^Service_/, "Service")}${n}`;
        while (appNode && name in appNode) {
          n += 1;
          name = `new${payload.className.replace(/^Service_/, "Service")}${n}`;
        }
        const stub = stubValue(root, info.schema);
        const next = applyEdit([...payload.sourcePath, name], stub);
        const requiredChildren = isPlainObject(stub)
          ? Object.keys(stub).filter((k) => k !== "class")
          : [];
        navigateWhenReady([...payload.sourcePath, name], next, {
          flashChildren:
            requiredChildren.length > 0 ? requiredChildren : undefined,
          flash: requiredChildren.length === 0,
        });
        return;
      }
      const ctx = getContext(root, registry, debouncedText, cursorOffset);
      const prop = ctx.addableProps.find((p) => p.name === payload.name);
      const value = prop ? stubValue(root, prop.schema) : "";
      const next = applyEdit([...payload.sourcePath, payload.name], value);
      navigateWhenReady([...payload.sourcePath, payload.name], next);
    },
    [
      root,
      registry,
      debouncedText,
      cursorOffset,
      lastGoodDoc,
      applyEdit,
      navigateWhenReady,
    ]
  );

  return (
    <div className="app">
      <Toolbar
        schemaId={schemaId}
        onSchemaChange={setSchemaId}
        onLoadText={loadText}
        currentText={text}
        isDirty={text !== baselineText}
      />
      <div className="main">
        <div className="pane-tree">
          <TreePane
            doc={lastGoodDoc}
            isStale={isStale}
            cursorPath={context.path}
            onSelect={(path) => navigateToPath(path)}
            onDelete={handleDeleteNode}
          />
        </div>
        <div className="pane-editor">
          <EditorPane
            text={text}
            onTextChange={setText}
            schema={schemaEntry.schema}
            schemaId={schemaEntry.id}
            onEditorMount={(ed) => {
              editorRef.current = ed;
            }}
            onCursorOffsetChange={setCursorOffset}
            choiceValueStartAt={choiceValueStartAt}
          />
        </div>
        <div className="pane-context">
          <ContextPanel
            context={context}
            doc={lastGoodDoc}
            isStale={isStale}
            memberClasses={memberClasses}
            onEdit={handleEdit}
            onNavigate={(path) => navigateToPath(path)}
            onAddChip={handleAddChip}
            onDeleteNode={handleDeleteNode}
            onClassChange={handleClassChange}
          />
        </div>
      </div>
      <div className="errorbar">
        <span className="ok">Validation bar (Phase 5)</span>
      </div>
    </div>
  );
}
