import { useRef } from "react";
import { SCHEMAS } from "../schemas";
import { TEMPLATES, getTemplate } from "../templates";

interface ToolbarProps {
  schemaId: string;
  onSchemaChange: (id: string) => void;
  onLoadText: (text: string) => void;
  currentText: string;
  isDirty: boolean;
  onValidateOnBigip: () => void;
}

export default function Toolbar({
  schemaId,
  onSchemaChange,
  onLoadText,
  currentText,
  isDirty,
  onValidateOnBigip,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleTemplateSelect(id: string) {
    if (!id) return;
    if (isDirty && !window.confirm("Replace the current document with the template?")) {
      return;
    }
    onLoadText(getTemplate(id).content);
  }

  function handleOpenFile(file: File | undefined) {
    if (!file) return;
    if (isDirty && !window.confirm(`Replace the current document with ${file.name}?`)) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onLoadText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function handleSave() {
    const blob = new Blob([currentText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "declaration.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="toolbar">
      <h1>AS3 Builder</h1>
      <label>
        Schema
        <select value={schemaId} onChange={(e) => onSchemaChange(e.target.value)}>
          {SCHEMAS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Template
        <select value="" onChange={(e) => handleTemplateSelect(e.target.value)}>
          <option value="" disabled>
            Load template…
          </option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div className="spacer" />
      <button onClick={onValidateOnBigip} title="Dry-run this declaration against a BIG-IP">
        Validate on BIG-IP…
      </button>
      <button onClick={() => fileInputRef.current?.click()}>Open</button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: "none" }}
        onChange={(e) => {
          handleOpenFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
