import { useCallback, useMemo, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { findNodeAtLocation, parseTree } from "jsonc-parser";
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
  getContext,
  stubValue,
  type JsonPath,
  type JsonSchemaRoot,
} from "./engine";

const INITIAL_TEXT = getTemplate("http-app").content;

export default function App() {
  const [schemaId, setSchemaId] = useState(DEFAULT_SCHEMA_ID);
  const [cursorOffset, setCursorOffset] = useState(0);
  const [baselineText, setBaselineText] = useState(INITIAL_TEXT);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const docState = useDocument(INITIAL_TEXT);
  const { text, setText, debouncedText, lastGoodDoc, isStale, applyEdit } =
    docState;

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

  // Move the Monaco cursor to the value at `path` in the given text.
  const navigateToPath = useCallback((path: JsonPath, inText?: string) => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model) return;
    const tree = parseTree(inText ?? model.getValue(), [], {
      allowTrailingComma: true,
    });
    if (!tree) return;
    const node = path.length === 0 ? tree : findNodeAtLocation(tree, path);
    if (!node) return;
    // Land inside the value (offset+1 for objects/arrays) so the context
    // resolves to the node itself rather than its parent.
    const inside =
      node.type === "object" || node.type === "array"
        ? node.offset + 1
        : node.offset;
    const pos = model.getPositionAt(inside);
    ed.setPosition(pos);
    ed.revealPositionInCenterIfOutsideViewport(pos);
    ed.focus();
    setCursorOffset(inside);
  }, []);

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
    (path: JsonPath, expectedText: string, attempt = 0) => {
      const model = editorRef.current?.getModel();
      if (model && model.getValue() === expectedText) {
        navigateToPath(path);
        return;
      }
      if (attempt < 20)
        setTimeout(() => navigateWhenReady(path, expectedText, attempt + 1), 25);
    },
    [navigateToPath]
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
        const next = applyEdit(
          [...payload.sourcePath, name],
          stubValue(root, info.schema)
        );
        navigateWhenReady([...payload.sourcePath, name], next);
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
          />
        </div>
      </div>
      <div className="errorbar">
        <span className="ok">Validation bar (Phase 5)</span>
      </div>
    </div>
  );
}
