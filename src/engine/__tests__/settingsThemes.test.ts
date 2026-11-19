import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSettings, saveSettings } from "../../settings";
import {
  PALETTES,
  mix,
  monacoThemeName,
  tokensFor,
  type PaletteSpec,
} from "../../themes";

/** In-memory Storage, so the store is tested without depending on the
 * runner's environment (Node's experimental global shadows jsdom's). */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

describe("settings store", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("round-trips every preference", () => {
    saveSettings({
      palette: "catppuccin",
      mode: "dark",
      labelMode: "both",
      schemaId: "as3-3.56.0-10",
      viewMode: "json",
    });
    expect(loadSettings()).toEqual({
      palette: "catppuccin",
      mode: "dark",
      labelMode: "both",
      schemaId: "as3-3.56.0-10",
      viewMode: "json",
    });
  });

  it("migrates the old per-key theme and button style", () => {
    localStorage.setItem("as3b-theme", "dark");
    localStorage.setItem("as3b-toolbar-labels", "text");
    const s = loadSettings();
    expect(s.mode).toBe("dark");
    expect(s.labelMode).toBe("text");
    expect(s.palette).toBe("thd");
  });

  it("drops only the values that no longer make sense", () => {
    localStorage.setItem(
      "as3b-settings",
      JSON.stringify({ palette: "gone-theme", mode: "dark", labelMode: "huge" })
    );
    const s = loadSettings();
    expect(s.palette).toBe("thd");
    expect(s.mode).toBe("dark");
    expect(s.labelMode).toBe("icons");
  });

  it("runs on defaults when storage is unavailable", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveSettings(loadSettings())).not.toThrow();
    expect(loadSettings().palette).toBe("thd");
  });

  it("survives a corrupt record", () => {
    localStorage.setItem("as3b-settings", "{not json");
    expect(loadSettings().viewMode).toBe("simple");
  });
});

// WCAG relative luminance / contrast, for the palette checks.
function luminance(hex: string): number {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("color palettes", () => {
  // The tokens the stylesheet defines for THD are the contract every
  // runtime palette has to fill.
  const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
  const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  const cssTokens = [...rootBlock.matchAll(/(--[a-z0-9-]+):/g)]
    .map((m) => m[1])
    // Brand constants THD uses to build its own tokens, not app tokens.
    .filter((t) => !t.startsWith("--hd-"));

  const specs: [string, "light" | "dark", PaletteSpec][] = PALETTES.flatMap(
    (p) =>
      (["light", "dark"] as const)
        .filter((m) => p[m] !== null)
        .map((m): [string, "light" | "dark", PaletteSpec] => [p.label, m, p[m]!])
  );

  it("has THD plus several common themes, each with both modes", () => {
    expect(PALETTES[0].id).toBe("thd");
    expect(PALETTES.length).toBeGreaterThanOrEqual(6);
    for (const p of PALETTES.slice(1)) {
      expect(p.light, p.label).not.toBeNull();
      expect(p.dark, p.label).not.toBeNull();
    }
  });

  it.each(specs)("%s (%s) sets every stylesheet token", (_, mode, spec) => {
    const tokens = tokensFor(spec, mode);
    for (const t of cssTokens) expect(tokens, t).toHaveProperty(t);
  });

  it.each(specs)("%s (%s) uses valid colors", (_, __, spec) => {
    for (const [k, v] of Object.entries(spec))
      expect(v, k).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(specs)("%s (%s) keeps body text readable (≥4.5:1)", (_, __, spec) => {
    expect(contrast(spec.text, spec.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(spec.text, spec.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(specs)("%s (%s) keeps toolbar text readable (≥3:1)", (_, __, spec) => {
    expect(contrast(spec.toolbarText, spec.toolbarBg)).toBeGreaterThanOrEqual(3);
    expect(contrast(spec.toolbarText, spec.toolbarBtn)).toBeGreaterThanOrEqual(3);
  });

  it("mixes colors", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#123456", "#abcdef", 0)).toBe("#123456");
  });

  it("names Monaco themes, keeping Monaco's own for THD", () => {
    expect(monacoThemeName("thd", "dark")).toBe("vs-dark");
    expect(monacoThemeName("thd", "light")).toBe("light");
    expect(monacoThemeName("nord", "dark")).toBe("as3b-nord-dark");
  });
});
