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
}

export default function EditorPane({
  text,
  onTextChange,
  schema,
  schemaId,
  onEditorMount,
  onCursorOffsetChange,
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
          if (model) onCursorOffsetChange?.(model.getOffsetAt(e.position));
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
