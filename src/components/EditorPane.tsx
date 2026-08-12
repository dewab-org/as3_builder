import Editor, { useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";

interface EditorPaneProps {
  text: string;
  onTextChange: (text: string) => void;
  schema: Record<string, unknown>;
  schemaId: string;
  theme?: "light" | "dark";
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
  onCursorOffsetChange?: (offset: number) => void;
  /** When a mouse click lands on a value with a closed set of choices,
   * returns the offset of the value's start (to anchor an unfiltered
   * suggestion list there); null for free-form values. */
  choiceValueStartAt?: (text: string, offset: number) => number | null;
  /** Path of the JSON property/array element that starts on this line, or
   * null when the line isn't deletable (structural brackets, root, …). */
  deletableRowPath?: (text: string, lineStartOffset: number) => unknown;
  /** Delete the row (property or array element) whose value starts on the
   * given line. Receives the path returned by deletableRowPath. */
  onDeleteRow?: (path: unknown) => void;
}

export default function EditorPane(props: EditorPaneProps) {
  const { text, onTextChange, schema, schemaId, theme, onEditorMount } = props;
  const monaco = useMonaco();

  // The onMount handlers below live for the editor's lifetime; going through
  // this ref keeps them reading the CURRENT callbacks (and thus the current
  // document text), not the ones captured at mount. Without it, a second
  // row-delete would edit a stale copy of the document.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!monaco) return;
    monaco.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      enableSchemaRequest: false,
      schemas: [
        {
          uri: `inmemory://schema/${schemaId}`,
          fileMatch: ["*"],
          schema,
        },
      ],
    });
  }, [monaco, schema, schemaId]);

  return (
    <Editor
      language="json"
      theme={theme === "dark" ? "vs-dark" : "light"}
      value={text}
      onChange={(value) => onTextChange(value ?? "")}
      onMount={(editorInstance, monacoApi) => {
        onEditorMount?.(editorInstance);

        // Hover-to-delete: show a ✕ glyph in the margin of the hovered line
        // when that line starts a deletable property / array element.
        const hoverGlyph = editorInstance.createDecorationsCollection();
        let glyphLine = 0;
        let glyphPath: unknown = null;
        const clearGlyph = () => {
          glyphLine = 0;
          glyphPath = null;
          hoverGlyph.clear();
        };
        editorInstance.onMouseMove((e) => {
          const model = editorInstance.getModel();
          const line = e.target.position?.lineNumber;
          const { deletableRowPath } = propsRef.current;
          if (!model || !line || !deletableRowPath) return;
          if (line === glyphLine) return;
          const firstCol = model.getLineFirstNonWhitespaceColumn(line);
          if (firstCol === 0) return clearGlyph();
          const offset = model.getOffsetAt({ lineNumber: line, column: firstCol });
          const path = deletableRowPath(model.getValue(), offset);
          if (!path) return clearGlyph();
          glyphLine = line;
          glyphPath = path;
          hoverGlyph.set([
            {
              range: new monacoApi.Range(line, 1, line, 1),
              options: {
                glyphMarginClassName: "row-delete-glyph",
                glyphMarginHoverMessage: { value: "Delete this row" },
              },
            },
          ]);
        });
        editorInstance.onMouseLeave(() => clearGlyph());
        editorInstance.onMouseDown((e) => {
          if (
            e.target.type === monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
            e.target.position?.lineNumber === glyphLine &&
            glyphPath
          ) {
            e.event.preventDefault();
            propsRef.current.onDeleteRow?.(glyphPath);
            clearGlyph();
          }
        });
        editorInstance.onDidChangeCursorPosition((e) => {
          const model = editorInstance.getModel();
          if (!model) return;
          // Ignore programmatic cursor resets (e.g. the controlled value
          // update after a panel edit jumps the cursor to offset 0) — only
          // real user interaction should drive the context panel.
          if (e.source !== "mouse" && e.source !== "keyboard") return;
          const offset = model.getOffsetAt(e.position);
          propsRef.current.onCursorOffsetChange?.(offset);
          // Mouse click on an enum/boolean/const value → open the pick list.
          if (e.source !== "mouse") return;
          const valueStart = propsRef.current.choiceValueStartAt?.(
            model.getValue(),
            offset
          );
          if (valueStart !== null && valueStart !== undefined) {
            // Defer past the click's own event handling (which dismisses a
            // synchronously opened suggest widget), move the cursor to the
            // value start so Monaco doesn't prefix-filter the list, then open.
            setTimeout(() => {
              if (!editorInstance.getPosition()?.equals(e.position)) return;
              editorInstance.setPosition(model.getPositionAt(valueStart));
              editorInstance.trigger("as3", "editor.action.triggerSuggest", {});
            }, 50);
          }
        });
      }}
      options={{
        minimap: { enabled: false },
        glyphMargin: true,
        automaticLayout: true,
        tabSize: 2,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        fixedOverflowWidgets: true,
      }}
    />
  );
}
