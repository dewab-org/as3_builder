import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import AppLogo from "./AppLogo";
import MaterialIcon from "./MaterialIcon";
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
      className={[className, mode === "icons" ? "icon-only" : ""]
        .filter(Boolean)
        .join(" ") || undefined}
      title={mode === "icons" ? `${label} — ${title}` : title}
    >
      {mode !== "text" && (
        <span className="btn-icon" aria-hidden="true">
          <MaterialIcon name={icon} />
        </span>
      )}
      {mode !== "icons" && <span className="btn-label">{label}</span>}
      {children}
    </button>
  );
}

interface ToolbarProps {
  /** Display name of the schema in use (chosen in Settings). */
  schemaLabel: string;
  onOpenSettings: () => void;
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
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function Toolbar({
  schemaLabel,
  onOpenSettings,
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
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Labels that do not fit fall back to icons-only (names stay in the
  // tooltips) instead of pushing the page into sideways scrolling; they
  // come back once the window is wide enough for them again.
  const barRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const expandedWidth = useRef(0);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || labelMode === "icons") {
      setCollapsed(false);
      return;
    }
    const check = () => {
      if (!collapsed) {
        if (bar.scrollWidth > bar.clientWidth + 1) {
          expandedWidth.current = bar.scrollWidth;
          setCollapsed(true);
        }
        // A little slack so a label that changes width (Connect… →
        // Connected) cannot flip the bar back and forth.
      } else if (bar.clientWidth >= expandedWidth.current + 16) {
        setCollapsed(false);
      }
    };
    check();
    // The window resize covers browsers that throttle ResizeObserver.
    window.addEventListener("resize", check);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(bar);
    return () => {
      window.removeEventListener("resize", check);
      observer?.disconnect();
    };
  }, [labelMode, collapsed]);
  const mode: ToolbarLabelMode = collapsed ? "icons" : labelMode;

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
    <div className="toolbar" ref={barRef}>
      {/* The title doubles as the About control: version and author live
          behind the name, where convention puts them. */}
      <h1>
        <button
          className="toolbar-title"
          onClick={onAbout}
          title="About AS3 Builder (version, author)"
          aria-label="About AS3 Builder"
        >
          <AppLogo />
          AS3 Builder
        </button>
      </h1>
      {/* Every item is a slot: a small label row on top, the control below.
          Unboxed slots keep the label row (blank if unlabelled), so their
          controls sit on the same line as the boxed groups' buttons. */}
      <div className="toolbar-group bare" title="Change in Settings">
        <span className="toolbar-group-label">Schema</span>
        <div className="toolbar-group-buttons">
          {/* Static: chosen in Settings, shown so it is always clear what
              the editor validates against. */}
          <span className="toolbar-schema">{schemaLabel}</span>
        </div>
      </div>
      <div className="toolbar-group bare">
        <label className="toolbar-group-label" htmlFor="toolbar-template">
          Template
        </label>
        <div className="toolbar-group-buttons">
          <select
            id="toolbar-template"
            value=""
            onChange={(e) => handleTemplateSelect(e.target.value)}
          >
            <option value="" disabled>
              Load template…
            </option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="toolbar-group bare" role="group" aria-label="History">
        <span className="toolbar-group-label" aria-hidden="true">
          &nbsp;
        </span>
        <div className="toolbar-group-buttons">
          <button
            className="icon-only"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            aria-label="Undo"
          >
            <MaterialIcon name="undo" />
          </button>
          <button
            className="icon-only"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
          >
            <MaterialIcon name="redo" />
          </button>
        </div>
      </div>
      <div className="spacer" />
      {netboxEnabled && (
        <div className="toolbar-group" role="group" aria-label="NetBox">
          <span className="toolbar-group-label">NetBox</span>
          <div className="toolbar-group-buttons">
            <GroupButton
              icon={netboxConnected ? "check_circle" : "sync_alt"}
              label={netboxConnected ? "Connected" : "Connect…"}
              mode={mode}
              onClick={onConnectNetbox}
              className={netboxConnected ? "is-connected" : "is-disconnected"}
              title={
                netboxConnected
                  ? "Connected — reopen to change the connection"
                  : "Not connected — connect to NetBox (required before loading or pushing)"
              }
            />
            <GroupButton
              icon="download"
              label="Load…"
              mode={mode}
              onClick={onLoadFromNetbox}
              title="Read a load-balancer application from NetBox as AS3"
            />
            <GroupButton
              icon="upload"
              label="Push…"
              mode={mode}
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
            icon={bigipConnected ? "check_circle" : "sync_alt"}
            label={bigipConnected ? "Connected" : "Connect…"}
            mode={mode}
            onClick={onConnectBigip}
            className={bigipConnected ? "is-connected" : "is-disconnected"}
            title={
              bigipConnected
                ? "Connected — reopen to change the device or credentials"
                : "Not connected — connect to BIG-IP (used by load and validate)"
            }
          />
          <GroupButton
            icon="download"
            label="Load…"
            mode={mode}
            onClick={onLoadFromBigip}
            title="Read an application from a device's running configuration, via AS3's per-application API"
          />
          <GroupButton
            icon="task_alt"
            label="Validate…"
            mode={mode}
            onClick={onValidateOnBigip}
            title="Dry-run this declaration against a BIG-IP"
          />
        </div>
      </div>
      <div className="toolbar-group" role="group" aria-label="JSON">
        <span className="toolbar-group-label">JSON</span>
        <div className="toolbar-group-buttons">
          <GroupButton
            icon="folder_open"
            label="Open…"
            mode={mode}
            onClick={() => fileInputRef.current?.click()}
            title="Open a declaration from a local JSON file"
          />
          <GroupButton
            icon="save"
            label="Save"
            mode={mode}
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
      <div className="toolbar-group bare" role="group" aria-label="View">
        <span className="toolbar-group-label" aria-hidden="true">
          &nbsp;
        </span>
        <div className="toolbar-group-buttons">
          <button
            className="icon-only"
            onClick={onOpenSettings}
            title="Settings — schema and toolbar button style"
            aria-label="Settings"
          >
            <MaterialIcon name="settings" />
          </button>
          <button
            className="icon-only"
            onClick={onToggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <MaterialIcon name={theme === "dark" ? "light_mode" : "dark_mode"} />
          </button>
        </div>
      </div>
    </div>
  );
}
