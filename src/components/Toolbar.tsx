import { useRef, type ReactNode } from "react";
import { SCHEMA_LIST } from "../schemas";
import { TEMPLATES, getTemplate } from "../templates";

/** How grouped toolbar buttons present themselves. */
export type ToolbarLabelMode = "icons" | "text" | "both";

/** A button inside a labelled toolbar group: icon, text, or both, per the
 * user's preference. Icon-only keeps the label reachable via tooltip and
 * aria-label. */
function GroupButton({
  icon,
  label,
  title,
  mode,
  onClick,
  className,
  children,
}: {
  icon: string;
  label: string;
  title: string;
  mode: ToolbarLabelMode;
  onClick: () => void;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={className}
      title={mode === "icons" ? `${label} — ${title}` : title}
    >
      {mode !== "text" && (
        <span className="btn-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {mode !== "icons" && <span className="btn-label">{label}</span>}
      {children}
    </button>
  );
}

interface ToolbarProps {
  schemaId: string;
  onSchemaChange: (id: string) => void;
  /** URL-sourced schemas added this session ({id, label}). */
  urlSchemas: { id: string; label: string }[];
  onAddSchemaUrl: () => void;
  /** `source` names what is replacing the document ("the template", a file
   * name) for the replace-confirmation dialog. The guard lives in App. */
  onLoadText: (text: string, source: string) => void;
  currentText: string;
  onValidateOnBigip: () => void;
  /** False hides the NetBox buttons entirely: the deployment has switched
   * the capability off, so nothing should advertise it. */
  netboxEnabled: boolean;
  onConnectNetbox: () => void;
  /** Whether this session holds a NetBox connection (cached app list). */
  netboxConnected: boolean;
  onConnectBigip: () => void;
  /** Whether "Connect to BIG-IP…" has verified the device this session. */
  bigipConnected: boolean;
  onLoadFromNetbox: () => void;
  onLoadFromBigip: () => void;
  onPushToNetbox: () => void;
  /** What a push would write, and how much it cannot — absent until an
   * application has been loaded from NetBox. */
  pushPreview?: { writes: number; notes: number };
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onAbout: () => void;
  /** Grouped buttons: icons only (hover for text), text only, or both. */
  labelMode: ToolbarLabelMode;
  onLabelModeChange: (mode: ToolbarLabelMode) => void;
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
  onValidateOnBigip,
  netboxEnabled,
  onConnectNetbox,
  netboxConnected,
  onConnectBigip,
  bigipConnected,
  onLoadFromNetbox,
  onLoadFromBigip,
  onPushToNetbox,
  pushPreview,
  theme,
  onToggleTheme,
  onAbout,
  labelMode,
  onLabelModeChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleTemplateSelect(id: string) {
    if (!id) return;
    const template = getTemplate(id);
    onLoadText(template.content, `the "${template.label}" template`);
  }

  function handleOpenFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onLoadText(String(reader.result ?? ""), file.name);
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
      {/* The title doubles as the About control: version and author live
          behind the name, where convention puts them. The mark: a declaration
          brace fanning out to three balanced nodes. */}
      <h1>
        <button
          className="toolbar-title"
          onClick={onAbout}
          title="About AS3 Builder (version, author)"
          aria-label="About AS3 Builder"
        >
          <svg
            className="app-logo"
            viewBox="0 0 24 24"
            width="24"
            height="24"
            aria-hidden="true"
          >
            <path
              d="M9 3.5 C6.5 3.5 7.5 7 5.5 7 L4.5 7 L4.5 9 L5.5 9 C7.5 9 6.5 12.5 9 12.5"
              transform="translate(0,4)"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <g stroke="currentColor" strokeWidth="1.5" fill="none">
              <path d="M11 12 L17 5.5 M11 12 L18 12 M11 12 L17 18.5" />
            </g>
            <circle cx="11" cy="12" r="2.1" fill="currentColor" />
            <g fill="currentColor">
              <circle cx="18.5" cy="5" r="1.8" />
              <circle cx="19.5" cy="12" r="1.8" />
              <circle cx="18.5" cy="19" r="1.8" />
            </g>
          </svg>
          AS3 Builder
        </button>
      </h1>
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
      {netboxEnabled && (
        <div className="toolbar-group" role="group" aria-label="NetBox">
          <span className="toolbar-group-label">NetBox</span>
          <div className="toolbar-group-buttons">
            <GroupButton
              icon={netboxConnected ? "✓" : "⇄"}
              label={netboxConnected ? "Connected" : "Connect…"}
              mode={labelMode}
              onClick={onConnectNetbox}
              className={netboxConnected ? "is-connected" : "is-disconnected"}
              title={
                netboxConnected
                  ? "Connected — reopen to change the connection"
                  : "Not connected — connect to NetBox (required before loading or pushing)"
              }
            />
            <GroupButton
              icon="⤓"
              label="Load…"
              mode={labelMode}
              onClick={onLoadFromNetbox}
              title="Read a load-balancer application from NetBox as AS3"
            />
            <GroupButton
              icon="⤒"
              label="Push…"
              mode={labelMode}
              onClick={onPushToNetbox}
              title={
                pushPreview
                  ? `${pushPreview.writes} change${pushPreview.writes === 1 ? "" : "s"} to write` +
                    (pushPreview.notes > 0
                      ? `, ${pushPreview.notes} edit${pushPreview.notes === 1 ? "" : "s"} that cannot be pushed`
                      : "")
                  : "Write edits back to NetBox, or create this declaration as a new application"
              }
            >
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
            </GroupButton>
          </div>
        </div>
      )}
      <div className="toolbar-group" role="group" aria-label="BIG-IP">
        <span className="toolbar-group-label">BIG-IP</span>
        <div className="toolbar-group-buttons">
          <GroupButton
            icon={bigipConnected ? "✓" : "⇄"}
            label={bigipConnected ? "Connected" : "Connect…"}
            mode={labelMode}
            onClick={onConnectBigip}
            className={bigipConnected ? "is-connected" : "is-disconnected"}
            title={
              bigipConnected
                ? "Connected — reopen to change the device or credentials"
                : "Not connected — connect to BIG-IP (used by load and validate)"
            }
          />
          <GroupButton
            icon="⤓"
            label="Load…"
            mode={labelMode}
            onClick={onLoadFromBigip}
            title="Read an application from a device's running configuration, via AS3's per-application API"
          />
          <GroupButton
            icon="✓"
            label="Validate…"
            mode={labelMode}
            onClick={onValidateOnBigip}
            title="Dry-run this declaration against a BIG-IP"
          />
        </div>
      </div>
      <div className="toolbar-group" role="group" aria-label="JSON">
        <span className="toolbar-group-label">JSON</span>
        <div className="toolbar-group-buttons">
          <GroupButton
            icon="📂"
            label="Open…"
            mode={labelMode}
            onClick={() => fileInputRef.current?.click()}
            title="Open a declaration from a local JSON file"
          />
          <GroupButton
            icon="💾"
            label="Save"
            mode={labelMode}
            onClick={handleSave}
            title="Save the declaration as a local JSON file"
          />
        </div>
      </div>
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
      <select
        className="toolbar-labelmode"
        value={labelMode}
        onChange={(e) => onLabelModeChange(e.target.value as ToolbarLabelMode)}
        title="How the grouped buttons present themselves"
        aria-label="Toolbar button style"
      >
        <option value="icons">Icons</option>
        <option value="text">Text</option>
        <option value="both">Icons + text</option>
      </select>
      <button
        onClick={onToggleTheme}
        title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
    </div>
  );
}
