import { useRef } from "react";
import { SCHEMA_LIST } from "../schemas";
import { TEMPLATES, getTemplate } from "../templates";

interface ToolbarProps {
  schemaId: string;
  onSchemaChange: (id: string) => void;
  /** URL-sourced schemas added this session ({id, label}). */
  urlSchemas: { id: string; label: string }[];
  onAddSchemaUrl: () => void;
  onLoadText: (text: string) => void;
  currentText: string;
  isDirty: boolean;
  onValidateOnBigip: () => void;
  onLoadFromNetbox: () => void;
  onLoadFromBigip: () => void;
  onPushToNetbox: () => void;
  /** What a push would write, and how much it cannot — absent until an
   * application has been loaded from NetBox. */
  pushPreview?: { writes: number; notes: number };
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function Toolbar({
  schemaId,
  onSchemaChange,
  urlSchemas,
  onAddSchemaUrl,
  onLoadText,
  currentText,
  isDirty,
  onValidateOnBigip,
  onLoadFromNetbox,
  onLoadFromBigip,
  onPushToNetbox,
  pushPreview,
  theme,
  onToggleTheme,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
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
        <select
          value={schemaId}
          onChange={(e) => {
            if (e.target.value === "__add-url__") onAddSchemaUrl();
            else onSchemaChange(e.target.value);
          }}
        >
          {SCHEMA_LIST.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          {urlSchemas.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
          <option value="__add-url__">Load schema from URL…</option>
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
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
      >
        ↷
      </button>
      <div className="spacer" />
      <button onClick={onLoadFromNetbox} title="Read a load-balancer application from NetBox as AS3">
        Load from NetBox…
      </button>
      <button
        onClick={onLoadFromBigip}
        title="Read an application from a device's running configuration, via AS3's per-application API"
      >
        Load from BIG-IP…
      </button>
      <button
        onClick={onPushToNetbox}
        title={
          pushPreview
            ? `${pushPreview.writes} change${pushPreview.writes === 1 ? "" : "s"} to write` +
              (pushPreview.notes > 0
                ? `, ${pushPreview.notes} edit${pushPreview.notes === 1 ? "" : "s"} that cannot be pushed`
                : "")
            : "Write edited fields back to the NetBox objects this declaration came from"
        }
      >
        Push to NetBox…
        {pushPreview && pushPreview.writes > 0 && (
          <span className="toolbar-badge">{pushPreview.writes}</span>
        )}
        {pushPreview && pushPreview.notes > 0 && (
          <span
            className="toolbar-badge warn"
            aria-label={`${pushPreview.notes} edits cannot be pushed`}
          >
            !{pushPreview.notes}
          </span>
        )}
      </button>
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
      <button
        onClick={onToggleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
