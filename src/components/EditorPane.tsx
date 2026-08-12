import Editor, { useMonaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect } from "react";

interface EditorPaneProps {
  text: string;
  onTextChange: (text: string) => void;
  schema: Record<string, unknown>;
  schemaId: string;
  onEditorMount?: (editor: editor.IStandaloneCodeEditor) => void;
  onCursorOffsetChange?: (offset: number) => void;
  /** When a mouse click lands on a value with a closed set of choices,
   * returns the offset of the value's start (to anchor an unfiltered
   * suggestion list there); null for free-form values. */
  choiceValueStartAt?: (text: string, offset: number) => number | null;
}

export default function EditorPane({
  text,
  onTextChange,
  schema,
  schemaId,
  onEditorMount,
  onCursorOffsetChange,
  choiceValueStartAt,
}: EditorPaneProps) {
  const monaco = useMonaco();

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
      value={text}
      onChange={(value) => onTextChange(value ?? "")}
      onMount={(editorInstance) => {
        onEditorMount?.(editorInstance);
        editorInstance.onDidChangeCursorPosition((e) => {
          const model = editorInstance.getModel();
          if (!model) return;
          // Ignore programmatic cursor resets (e.g. the controlled value
          // update after a panel edit jumps the cursor to offset 0) — only
          // real user interaction should drive the context panel.
          if (e.source !== "mouse" && e.source !== "keyboard") return;
          const offset = model.getOffsetAt(e.position);
          onCursorOffsetChange?.(offset);
          // Mouse click on an enum/boolean/const value → open the pick list.
          if (e.source !== "mouse") return;
          const valueStart = choiceValueStartAt?.(model.getValue(), offset);
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
        automaticLayout: true,
        tabSize: 2,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        fixedOverflowWidgets: true,
      }}
    />
  );
}
