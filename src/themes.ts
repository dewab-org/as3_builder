// Color palettes. THD is the stylesheet's own :root / [data-theme="dark"]
// tokens and needs nothing here. Every other palette is a compact spec per
// mode, built from the theme's published colors; the ~50 CSS tokens the app
// uses are derived from it and set on <html> at runtime, so a palette is a
// dozen colors rather than a hundred lines of CSS per mode.

export type PaletteId =
  | "thd"
  | "catppuccin"
  | "nord"
  | "dracula"
  | "solarized"
  | "gruvbox"
  | "github"
  | "tokyo-night";

export type ColorMode = "light" | "dark";

/** The colors a palette states; everything else is derived. */
export interface PaletteSpec {
  bg: string; // window background
  panel: string; // panes and cards
  panel2: string; // recessed areas
  border: string;
  text: string;
  muted: string; // secondary text
  accent: string; // selection, links, focus
  prop: string; // property names
  toolbarBg: string;
  toolbarText: string;
  toolbarBtn: string;
  danger: string;
  warn: string;
  green: string;
  purple: string;
}

export interface Palette {
  id: PaletteId;
  label: string;
  /** Names of the published variants, for the picker. */
  variants: { light: string; dark: string };
  light: PaletteSpec | null; // null: the stylesheet's own tokens (THD)
  dark: PaletteSpec | null;
}

export const PALETTES: Palette[] = [
  {
    id: "thd",
    label: "THD",
    variants: { light: "Orange", dark: "Ember" },
    light: null,
    dark: null,
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    variants: { light: "Latte", dark: "Mocha" },
    light: {
      bg: "#e6e9ef", panel: "#eff1f5", panel2: "#e6e9ef", border: "#bcc0cc",
      text: "#4c4f69", muted: "#6c6f85", accent: "#8839ef", prop: "#fe640b",
      toolbarBg: "#dce0e8", toolbarText: "#4c4f69", toolbarBtn: "#ccd0da",
      danger: "#d20f39", warn: "#df8e1d", green: "#40a02b", purple: "#7287fd",
    },
    dark: {
      bg: "#181825", panel: "#1e1e2e", panel2: "#181825", border: "#45475a",
      text: "#cdd6f4", muted: "#a6adc8", accent: "#cba6f7", prop: "#fab387",
      toolbarBg: "#11111b", toolbarText: "#cdd6f4", toolbarBtn: "#313244",
      danger: "#f38ba8", warn: "#f9e2af", green: "#a6e3a1", purple: "#b4befe",
    },
  },
  {
    id: "nord",
    label: "Nord",
    variants: { light: "Snow Storm", dark: "Polar Night" },
    light: {
      bg: "#e5e9f0", panel: "#eceff4", panel2: "#e5e9f0", border: "#c4cbd7",
      text: "#2e3440", muted: "#4c566a", accent: "#5e81ac", prop: "#d08770",
      toolbarBg: "#5e81ac", toolbarText: "#eceff4", toolbarBtn: "#51739c",
      danger: "#bf616a", warn: "#ebcb8b", green: "#6b8f53", purple: "#b48ead",
    },
    dark: {
      bg: "#2e3440", panel: "#3b4252", panel2: "#353c4a", border: "#4c566a",
      text: "#eceff4", muted: "#a6b0c0", accent: "#88c0d0", prop: "#d08770",
      toolbarBg: "#434c5e", toolbarText: "#eceff4", toolbarBtn: "#4c566a",
      danger: "#bf616a", warn: "#ebcb8b", green: "#a3be8c", purple: "#b48ead",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    variants: { light: "Alucard", dark: "Dracula" },
    light: {
      bg: "#f3eedb", panel: "#fffbeb", panel2: "#f8f3df", border: "#cfc8ae",
      text: "#1f1f1f", muted: "#6c664b", accent: "#644ac9", prop: "#a34d14",
      toolbarBg: "#644ac9", toolbarText: "#fffbeb", toolbarBtn: "#5640b0",
      danger: "#cb3a2a", warn: "#846e15", green: "#14710a", purple: "#a3144d",
    },
    dark: {
      bg: "#21222c", panel: "#282a36", panel2: "#21222c", border: "#44475a",
      text: "#f8f8f2", muted: "#bdc0d6", accent: "#bd93f9", prop: "#ffb86c",
      toolbarBg: "#191a21", toolbarText: "#f8f8f2", toolbarBtn: "#44475a",
      danger: "#ff5555", warn: "#f1fa8c", green: "#50fa7b", purple: "#ff79c6",
    },
  },
  {
    id: "solarized",
    label: "Solarized",
    variants: { light: "Light", dark: "Dark" },
    light: {
      // text: base01 darkened 4% to clear 4.5:1 on base2.
      bg: "#eee8d5", panel: "#fdf6e3", panel2: "#f5efdc", border: "#d6cfbb",
      text: "#546a70", muted: "#657b83", accent: "#268bd2", prop: "#cb4b16",
      toolbarBg: "#e4ddc8", toolbarText: "#586e75", toolbarBtn: "#fdf6e3",
      danger: "#dc322f", warn: "#b58900", green: "#859900", purple: "#6c71c4",
    },
    dark: {
      bg: "#002b36", panel: "#073642", panel2: "#04313c", border: "#23505b",
      text: "#93a1a1", muted: "#839496", accent: "#268bd2", prop: "#cb4b16",
      toolbarBg: "#00212b", toolbarText: "#93a1a1", toolbarBtn: "#073642",
      danger: "#dc322f", warn: "#b58900", green: "#859900", purple: "#6c71c4",
    },
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    variants: { light: "Light", dark: "Dark" },
    light: {
      bg: "#f2e5bc", panel: "#fbf1c7", panel2: "#f5e9c0", border: "#d5c4a1",
      text: "#3c3836", muted: "#7c6f64", accent: "#af3a03", prop: "#076678",
      toolbarBg: "#ebdbb2", toolbarText: "#3c3836", toolbarBtn: "#d5c4a1",
      danger: "#9d0006", warn: "#b57614", green: "#79740e", purple: "#8f3f71",
    },
    dark: {
      bg: "#1d2021", panel: "#282828", panel2: "#232323", border: "#504945",
      text: "#ebdbb2", muted: "#a89984", accent: "#fabd2f", prop: "#fe8019",
      toolbarBg: "#3c3836", toolbarText: "#ebdbb2", toolbarBtn: "#504945",
      danger: "#fb4934", warn: "#fabd2f", green: "#b8bb26", purple: "#d3869b",
    },
  },
  {
    id: "github",
    label: "GitHub",
    variants: { light: "Light", dark: "Dark" },
    light: {
      bg: "#f6f8fa", panel: "#ffffff", panel2: "#f6f8fa", border: "#d0d7de",
      text: "#1f2328", muted: "#656d76", accent: "#0969da", prop: "#953800",
      toolbarBg: "#24292f", toolbarText: "#f6f8fa", toolbarBtn: "#32383f",
      danger: "#cf222e", warn: "#9a6700", green: "#1a7f37", purple: "#8250df",
    },
    dark: {
      bg: "#0d1117", panel: "#161b22", panel2: "#0d1117", border: "#30363d",
      text: "#e6edf3", muted: "#8d96a0", accent: "#4493f8", prop: "#ffa657",
      toolbarBg: "#010409", toolbarText: "#e6edf3", toolbarBtn: "#21262d",
      danger: "#f85149", warn: "#d29922", green: "#3fb950", purple: "#a371f7",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    variants: { light: "Day", dark: "Night" },
    light: {
      bg: "#e1e2e7", panel: "#e9e9ed", panel2: "#e1e2e7", border: "#a8aecb",
      text: "#3760bf", muted: "#6172b0", accent: "#2e7de9", prop: "#b15c00",
      toolbarBg: "#c4c8da", toolbarText: "#3760bf", toolbarBtn: "#d5d8e3",
      danger: "#f52a65", warn: "#8c6c3e", green: "#587539", purple: "#9854f1",
    },
    dark: {
      bg: "#16161e", panel: "#1a1b26", panel2: "#16161e", border: "#3b4261",
      text: "#c0caf5", muted: "#9aa5ce", accent: "#7aa2f7", prop: "#ff9e64",
      toolbarBg: "#1f2335", toolbarText: "#c0caf5", toolbarBtn: "#292e42",
      danger: "#f7768e", warn: "#e0af68", green: "#9ece6a", purple: "#bb9af7",
    },
  },
];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

// ---- color math ------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** `a` mixed toward `b` by `t` (0 = a, 1 = b), as hex. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Every token the stylesheet uses, derived from a palette spec. */
export function tokensFor(s: PaletteSpec, mode: ColorMode): Record<string, string> {
  const dark = mode === "dark";
  return {
    "--bg": s.bg,
    "--panel": s.panel,
    "--panel-2": s.panel2,
    "--border": s.border,
    "--border-light": mix(s.border, s.panel, 0.5),
    "--border-faint": mix(s.border, s.panel, 0.75),
    "--text": s.text,
    "--text-strong": s.text,
    "--muted": s.muted,
    "--faint": mix(s.muted, s.panel, 0.35),
    "--ghost": mix(s.muted, s.panel, 0.65),
    "--accent": s.accent,
    "--accent-soft": mix(s.accent, s.panel, 0.45),
    "--prop": s.prop,
    "--select-bg": mix(s.accent, s.panel, dark ? 0.72 : 0.82),
    "--select-hover": mix(s.text, s.panel, 0.93),
    "--hover-strong": mix(s.accent, s.panel, dark ? 0.55 : 0.65),
    "--danger": s.danger,
    "--danger-dark": mix(s.danger, s.text, 0.25),
    "--danger-bg": mix(s.danger, s.panel, 0.85),
    "--danger-bg-soft": mix(s.danger, s.panel, 0.92),
    "--warn-bg": mix(s.warn, s.panel, dark ? 0.8 : 0.78),
    "--warn-border": s.warn,
    "--warn-text": dark ? s.warn : mix(s.warn, s.text, 0.45),
    "--modified-bg": mix(s.warn, s.panel, dark ? 0.8 : 0.78),
    "--green": s.green,
    "--green-btn": s.green,
    "--purple": s.purple,
    "--shadow": dark ? "rgba(0, 0, 0, 0.4)" : rgba(s.text, 0.15),
    "--shadow-strong": dark ? "rgba(0, 0, 0, 0.6)" : rgba(s.text, 0.3),
    "--backdrop": dark ? "rgba(0, 0, 0, 0.6)" : rgba(s.text, 0.45),
    "--flash": rgba(s.accent, 0.35),
    "--toolbar-bg": s.toolbarBg,
    "--toolbar-text": s.toolbarText,
    "--toolbar-btn": s.toolbarBtn,
    "--toolbar-btn-text": s.toolbarText,
    "--toolbar-btn-border": mix(s.toolbarText, s.toolbarBtn, 0.65),
    "--toolbar-btn-hover": mix(s.toolbarBtn, s.toolbarText, 0.15),
    "--immutable-bg": mix(s.muted, s.panel, 0.88),
    "--immutable-border": mix(s.muted, s.panel, 0.55),
    "--immutable-text": s.muted,
    "--link-accent": s.purple,
    "--link-bg": mix(s.purple, s.panel, 0.88),
  };
}

const APPLIED = new Set<string>();

/** Apply palette + mode to the document. THD clears the overrides and lets
 * the stylesheet's own tokens show. */
export function applyTheme(paletteId: PaletteId, mode: ColorMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.dataset.palette = paletteId;
  for (const name of APPLIED) root.style.removeProperty(name);
  APPLIED.clear();
  const spec = paletteById(paletteId)[mode];
  if (!spec) return;
  for (const [name, value] of Object.entries(tokensFor(spec, mode))) {
    root.style.setProperty(name, value);
    APPLIED.add(name);
  }
}

// ---- Monaco ------------------------------------------------------------------

/** The Monaco theme name for palette + mode (THD keeps Monaco's own). */
export function monacoThemeName(paletteId: PaletteId, mode: ColorMode): string {
  if (paletteById(paletteId)[mode] === null) return mode === "dark" ? "vs-dark" : "light";
  return `as3b-${paletteId}-${mode}`;
}

/** Monaco's defineTheme, narrowed to what this module needs. */
interface MonacoThemes {
  editor: {
    defineTheme: (
      name: string,
      data: {
        base: "vs" | "vs-dark";
        inherit: boolean;
        rules: { token: string; foreground: string }[];
        colors: Record<string, string>;
      }
    ) => void;
  };
}

/** Register a Monaco theme for every palette and mode. Idempotent. */
export function defineMonacoThemes(monaco: MonacoThemes): void {
  const bare = (c: string) => c.replace("#", "");
  for (const p of PALETTES) {
    for (const mode of ["light", "dark"] as const) {
      const s = p[mode];
      if (!s) continue;
      monaco.editor.defineTheme(monacoThemeName(p.id, mode), {
        base: mode === "dark" ? "vs-dark" : "vs",
        inherit: true,
        rules: [
          { token: "string.key.json", foreground: bare(s.prop) },
          { token: "string.value.json", foreground: bare(s.green) },
          { token: "number", foreground: bare(s.purple) },
          { token: "keyword.json", foreground: bare(s.accent) },
          { token: "delimiter", foreground: bare(s.muted) },
        ],
        colors: {
          "editor.background": s.panel,
          "editor.foreground": s.text,
          "editorLineNumber.foreground": mix(s.muted, s.panel, 0.35),
          "editorLineNumber.activeForeground": s.text,
          "editor.lineHighlightBackground": mix(s.text, s.panel, 0.94),
          "editor.selectionBackground": mix(s.accent, s.panel, 0.65),
          "editorCursor.foreground": s.accent,
          "editorGutter.background": s.panel,
          "editorWidget.background": s.panel2,
          "editorWidget.border": s.border,
        },
      });
    }
  }
}
