import { SCHEMA_LIST } from "../schemas";
import type { ToolbarLabelMode } from "./Toolbar";

interface SettingsDialogProps {
  schemaId: string;
  onSchemaChange: (id: string) => void;
  /** URL-sourced schemas added this session ({id, label}). */
  urlSchemas: { id: string; label: string }[];
  onAddSchemaUrl: () => void;
  labelMode: ToolbarLabelMode;
  onLabelModeChange: (mode: ToolbarLabelMode) => void;
  onClose: () => void;
}

const LABEL_MODES: { value: ToolbarLabelMode; label: string; hint: string }[] =
  [
    { value: "icons", label: "Icons", hint: "Hover a button for its name" },
    { value: "text", label: "Text", hint: "Names only" },
    { value: "both", label: "Icons + text", hint: "Both, wider toolbar" },
  ];

/** Preferences that change rarely: which AS3 schema validates the editor,
 * and how the grouped toolbar buttons present themselves. Both apply
 * immediately and persist as before. */
export default function SettingsDialog({
  schemaId,
  onSchemaChange,
  urlSchemas,
  onAddSchemaUrl,
  labelMode,
  onLabelModeChange,
  onClose,
}: SettingsDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>

        <h3 className="settings-heading">Schema</h3>
        <p className="ctx-hint">
          The AS3 schema the editor validates and completes against.
        </p>
        <label className="modal-field">
          <span>Schema</span>
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

        <h3 className="settings-heading">Toolbar buttons</h3>
        <div className="settings-choices" role="radiogroup" aria-label="Toolbar button style">
          {LABEL_MODES.map((m) => (
            <label key={m.value} className="modal-check">
              <input
                type="radio"
                name="toolbar-label-mode"
                value={m.value}
                checked={labelMode === m.value}
                onChange={() => onLabelModeChange(m.value)}
              />
              {m.label}
              <span className="settings-hint">{m.hint}</span>
            </label>
          ))}
        </div>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
