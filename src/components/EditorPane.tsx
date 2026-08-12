import Editor, { useMonaco } from "@monaco-editor/react";
import { useEffect } from "react";

interface EditorPaneProps {
  text: string;
  onTextChange: (text: string) => void;
  schema: Record<string, unknown>;
  schemaId: string;
}

export default function EditorPane({
  text,
  onTextChange,
  schema,
  schemaId,
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
