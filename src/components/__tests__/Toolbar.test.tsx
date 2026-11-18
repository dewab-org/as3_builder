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
    onConnectNetbox: vi.fn(),
    netboxConnected: false,
    labelMode: "both" as const,
    onLabelModeChange: vi.fn(),
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
  it("shows the grouped NetBox buttons when the deployment allows NetBox", () => {
    renderToolbar();
    const group = screen.getByRole("group", { name: "NetBox" });
    expect(group).toHaveTextContent("Connect…");
    expect(group).toHaveTextContent("Load…");
    expect(group).toHaveTextContent("Push…");
  });

  it("shows the connected state on the Connect button, with state colour", () => {
    renderToolbar({ netboxConnected: true });
    const connect = screen.getByRole("button", { name: "Connected" });
    expect(connect).toHaveClass("is-connected");
  });

  it("colours the Connect button while disconnected", () => {
    renderToolbar();
    expect(screen.getByRole("button", { name: "Connect…" })).toHaveClass(
      "is-disconnected"
    );
  });

  it("icons mode hides the text but keeps the name reachable", () => {
    renderToolbar({ labelMode: "icons" });
    const load = screen.getAllByRole("button", { name: "Load…" })[0];
    expect(load).not.toHaveTextContent("Load…");
    expect(load.title).toContain("Load…");
  });

  it("groups Open and Save under a JSON label", () => {
    renderToolbar();
    const json = screen.getByRole("group", { name: "JSON" });
    expect(json).toHaveTextContent("Open…");
    expect(json).toHaveTextContent("Save");
  });

  it("hides the group entirely — not disables — when gated off", () => {
    renderToolbar({ netboxEnabled: false });
    expect(
      screen.queryByRole("group", { name: "NetBox" })
    ).not.toBeInTheDocument();
    // The BIG-IP group is unaffected.
    const bigip = screen.getByRole("group", { name: "BIG-IP" });
    expect(bigip).toHaveTextContent("Load…");
    expect(bigip).toHaveTextContent("Validate…");
  });
});
