import { SCHEMA_LIST } from "../schemas";
import { PALETTES, type ColorMode, type PaletteId } from "../themes";
import type { ToolbarLabelMode } from "./Toolbar";

/** The swatch colors for a palette in a mode. THD reads its own tokens. */
const THD_SWATCH: Record<ColorMode, string[]> = {
  light: ["#f96302", "#f7f5f3", "#ffffff", "#c94f00"],
  dark: ["#2c1503", "#14110f", "#1e1a17", "#ff8e42"],
};

interface SettingsDialogProps {
  schemaId: string;
  onSchemaChange: (id: string) => void;
  /** URL-sourced schemas added this session ({id, label}). */
  urlSchemas: { id: string; label: string }[];
  onAddSchemaUrl: () => void;
  labelMode: ToolbarLabelMode;
  onLabelModeChange: (mode: ToolbarLabelMode) => void;
  palette: PaletteId;
  onPaletteChange: (palette: PaletteId) => void;
  /** Current light/dark, so the swatches show what will apply. */
  mode: ColorMode;
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
  palette,
  onPaletteChange,
  mode,
  onClose,
}: SettingsDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <p className="ctx-hint">Saved in this browser and kept across sessions.</p>

        <h3 className="settings-heading">Color theme</h3>
        <p className="ctx-hint">
          Each theme has a light and a dark variant; the sun/moon button on the
          toolbar switches between them.
        </p>
        <div className="palette-grid" role="radiogroup" aria-label="Color theme">
          {PALETTES.map((p) => {
            const spec = p[mode];
            const swatch = spec
              ? [spec.toolbarBg, spec.bg, spec.panel, spec.accent]
              : THD_SWATCH[mode];
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={palette === p.id}
                className={`palette-option${palette === p.id ? " selected" : ""}`}
                onClick={() => onPaletteChange(p.id)}
                title={`${p.label} — ${p.variants.light} (light) / ${p.variants.dark} (dark)`}
              >
                <span className="palette-swatch" aria-hidden="true">
                  {swatch.map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </span>
                <span className="palette-name">{p.label}</span>
                <span className="palette-variant">{p.variants[mode]}</span>
              </button>
            );
          })}
        </div>

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
        <p className="ctx-hint">
          When the window is too narrow for labels, the toolbar shows icons
          only until there is room again.
        </p>
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
