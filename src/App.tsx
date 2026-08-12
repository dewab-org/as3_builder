import { useMemo, useState } from "react";
import Toolbar from "./components/Toolbar";
import EditorPane from "./components/EditorPane";
import { DEFAULT_SCHEMA_ID, getSchema } from "./schemas";
import { getTemplate } from "./templates";

const INITIAL_TEXT = getTemplate("http-app").content;

export default function App() {
  const [schemaId, setSchemaId] = useState(DEFAULT_SCHEMA_ID);
  const [text, setText] = useState(INITIAL_TEXT);
  // Text as of the last load/save; used for "replace unsaved changes?" prompts.
  const [baselineText, setBaselineText] = useState(INITIAL_TEXT);

  const schemaEntry = useMemo(() => getSchema(schemaId), [schemaId]);

  function loadText(newText: string) {
    setText(newText);
    setBaselineText(newText);
  }

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
          <div className="pane-placeholder">Document tree (Phase 3)</div>
        </div>
        <div className="pane-editor">
          <EditorPane
            text={text}
            onTextChange={setText}
            schema={schemaEntry.schema}
            schemaId={schemaEntry.id}
          />
        </div>
        <div className="pane-context">
          <div className="pane-placeholder">Context panel (Phase 3)</div>
        </div>
      </div>
      <div className="errorbar">
        <span className="ok">Validation bar (Phase 5)</span>
      </div>
    </div>
  );
}
