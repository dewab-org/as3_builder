// User preferences, kept in localStorage so they survive sessions: color
// palette, light/dark, toolbar button style, the selected schema and the
// editor view. Storage can be unavailable (some private windows, blocked
// site data), so every access is guarded and the app still runs on defaults.

import { PALETTES, type ColorMode, type PaletteId } from "./themes";

export type ToolbarLabelMode = "icons" | "text" | "both";
export type ViewMode = "json" | "simple";

export interface Settings {
  palette: PaletteId;
  mode: ColorMode;
  labelMode: ToolbarLabelMode;
  /** null until the user picks one: the app default applies. */
  schemaId: string | null;
  viewMode: ViewMode;
}

const KEY = "as3b-settings";
// Earlier builds kept these as separate keys; read once to migrate.
const LEGACY_THEME = "as3b-theme";
const LEGACY_LABELS = "as3b-toolbar-labels";

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* unavailable or full: the in-memory value still applies */
  }
}

function systemMode(): ColorMode {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Stored settings, validated field by field: a value from an older or
 * newer build that no longer makes sense falls back to its default rather
 * than discarding everything else. */
export function loadSettings(): Settings {
  let stored: Record<string, unknown> = {};
  try {
    const raw = storageGet(KEY);
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    stored = {};
  }
  const legacyTheme = storageGet(LEGACY_THEME);
  const legacyLabels = storageGet(LEGACY_LABELS);
  return {
    palette: one(stored.palette, PALETTES.map((p) => p.id), "thd"),
    mode: one(stored.mode ?? legacyTheme, ["light", "dark"] as const, systemMode()),
    labelMode: one(
      stored.labelMode ?? legacyLabels,
      ["icons", "text", "both"] as const,
      "icons"
    ),
    schemaId: typeof stored.schemaId === "string" ? stored.schemaId : null,
    viewMode: one(stored.viewMode, ["json", "simple"] as const, "simple"),
  };
}

export function saveSettings(settings: Settings): void {
  storageSet(KEY, JSON.stringify(settings));
}
