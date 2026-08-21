import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Toolbar from "../Toolbar";

type ToolbarProps = Parameters<typeof Toolbar>[0];

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const props: ToolbarProps = {
    schemaId: "per-app",
    onSchemaChange: vi.fn(),
    urlSchemas: [],
    onAddSchemaUrl: vi.fn(),
    onLoadText: vi.fn(),
    currentText: "{}",
    onValidateOnBigip: vi.fn(),
    netboxEnabled: true,
    onLoadFromNetbox: vi.fn(),
    onLoadFromBigip: vi.fn(),
    onPushToNetbox: vi.fn(),
    theme: "light",
    onToggleTheme: vi.fn(),
    onAbout: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: false,
    canRedo: false,
    ...overrides,
  };
  render(<Toolbar {...props} />);
  return props;
}

describe("toolbar NetBox gate", () => {
  it("shows both NetBox buttons when the deployment allows NetBox", () => {
    renderToolbar();
    expect(screen.getByText("Load from NetBox…")).toBeInTheDocument();
    expect(screen.getByText(/Push to NetBox/)).toBeInTheDocument();
  });

  it("hides them entirely — not disables — when gated off", () => {
    renderToolbar({ netboxEnabled: false });
    expect(screen.queryByText("Load from NetBox…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Push to NetBox/)).not.toBeInTheDocument();
    // The rest of the toolbar is unaffected.
    expect(screen.getByText("Load from BIG-IP…")).toBeInTheDocument();
    expect(screen.getByText(/Validate on BIG-IP/)).toBeInTheDocument();
  });
});
