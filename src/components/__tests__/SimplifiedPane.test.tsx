import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SimplifiedPane, { type InlineSpec } from "../SimplifiedPane";
import { pathKey, type JsonPath } from "../../engine";

const doc = {
  id: "1",
  schemaVersion: "3.55.0",
  app: {
    class: "Application",
    web: {
      class: "Service_HTTP",
      virtualPort: 80,
      pool: "pool1",
      serverTLS: { use: "ssl_web" },
    },
    pool1: { class: "Pool", loadBalancingMode: "round-robin" },
    ssl_web: { class: "TLS_Server" },
  },
};

function renderPane(overrides: Partial<Parameters<typeof SimplifiedPane>[0]> = {}) {
  const props = {
    doc,
    cursorPath: [] as JsonPath,
    isModified: () => false,
    onSelect: vi.fn(),
    getInlineSpec: (): InlineSpec => ({ kind: "string" }),
    onEditValue: vi.fn(),
    onEditMany: vi.fn(),
    onAppendObjectItem: vi.fn(),
    onHoverPath: vi.fn(),
    relatedKeys: new Set<string>(),
    ...overrides,
  };
  render(<SimplifiedPane {...props} />);
  return props;
}

/** The row whose key label is `key` (rows pair a key with its value). */
function row(key: string): HTMLElement {
  const label = screen.getAllByText(key).find((el) =>
    el.classList.contains("simple-key")
  );
  if (!label) throw new Error(`no row for "${key}"`);
  return label.closest(".simple-row") as HTMLElement;
}

describe("simplified view: selection", () => {
  it("selects the row when its KEY is clicked", async () => {
    const props = renderPane();
    await userEvent.click(within(row("virtualPort")).getByText("virtualPort"));
    expect(props.onSelect).toHaveBeenCalledWith(["app", "web", "virtualPort"]);
  });

  // The regression that shipped: clicking a value opened the editor but never
  // moved the cursor, so the breadcrumb, the info pane and the reference
  // highlighting all stayed where they were.
  it("also selects the row when its VALUE is clicked", async () => {
    const props = renderPane();
    await userEvent.click(within(row("pool")).getByText("pool1"));
    expect(props.onSelect).toHaveBeenCalledWith(["app", "web", "pool"]);
  });

  it("selects an object when its card head is clicked", async () => {
    const props = renderPane();
    await userEvent.click(screen.getByText("pool1", { selector: ".obj-name" }));
    expect(props.onSelect).toHaveBeenCalledWith(["app", "pool1"]);
  });
});

describe("simplified view: editing", () => {
  it("opens an editor on the clicked value and commits on Enter", async () => {
    const props = renderPane();
    await userEvent.click(within(row("virtualPort")).getByText("80"));
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "8443{Enter}");
    expect(props.onEditValue).toHaveBeenCalledWith(
      ["app", "web", "virtualPort"],
      "8443"
    );
  });

  it("abandons an edit on Escape", async () => {
    const props = renderPane();
    await userEvent.click(within(row("virtualPort")).getByText("80"));
    await userEvent.type(screen.getByRole("textbox"), "9{Escape}");
    expect(props.onEditValue).not.toHaveBeenCalled();
  });

  it("deletes a row through its delete button", async () => {
    const props = renderPane();
    await userEvent.click(
      within(row("virtualPort")).getByRole("button", { name: /remove/i })
    );
    expect(props.onEditValue).toHaveBeenCalledWith(
      ["app", "web", "virtualPort"],
      undefined
    );
  });
});

describe("simplified view: what the eye is told", () => {
  it("marks read-only classes and bigip pointers, but not use pointers", () => {
    renderPane({
      doc: {
        app: {
          class: "Application",
          cert: { class: "Certificate" },
          web: {
            class: "Service_HTTP",
            snat: { bigip: "/Common/Shared/snat" },
            serverTLS: { use: "ssl_web" },
          },
          ssl_web: { class: "TLS_Server" },
        },
      },
    });
    const card = (name: string) =>
      screen
        .getByText(name, { selector: ".obj-name" })
        .closest(".obj-card") as HTMLElement;

    expect(card("cert")).toHaveClass("immutable");
    expect(within(card("cert")).getByText("read-only")).toBeInTheDocument();
    expect(card("snat")).toHaveClass("immutable");
    expect(within(card("snat")).getByText("external")).toBeInTheDocument();
    // A use-pointer names something editable here, so it stays ordinary.
    expect(card("serverTLS")).not.toHaveClass("immutable");
  });

  it("marks the far end of the selected reference as linked", () => {
    renderPane({
      cursorPath: ["app", "web", "serverTLS"],
      relatedKeys: new Set([pathKey(["app", "ssl_web"])]),
    });
    expect(
      screen.getByText("ssl_web", { selector: ".obj-name" }).closest(".obj-card")
    ).toHaveClass("related");
    expect(
      screen.getByText("pool1", { selector: ".obj-name" }).closest(".obj-card")
    ).not.toHaveClass("related");
  });

  it("badges blacklisted objects and locks hard ones", async () => {
    const props = renderPane({
      doc: {
        app: {
          class: "Application",
          mon: { class: "Monitor", monitorType: "sip", queryName: "Test" },
          l4: { class: "Service_L4", virtualPort: 80 },
        },
      },
      unsupportedForValue: (value) =>
        value.class === "Monitor" && value.monitorType === "sip"
          ? { mode: "soft" as const, reason: "SIP untested" }
          : value.class === "Service_L4"
            ? { mode: "hard" as const, reason: "NetScaler handles L4" }
            : undefined,
      lockedKeys: new Set([pathKey(["app", "l4"])]),
    });
    const card = (name: string) =>
      screen
        .getByText(name, { selector: ".obj-name" })
        .closest(".obj-card") as HTMLElement;

    // Soft: badged and tinted, still editable.
    expect(card("mon")).toHaveClass("unsupported-item");
    expect(within(card("mon")).getByText("unsupported")).toBeInTheDocument();
    await userEvent.click(within(card("mon")).getByText("Test"));
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "{Escape}");

    // Hard: badged "· locked", value clicks select but never open an editor,
    // and the delete button stays — badge+lock, never hide.
    expect(
      within(card("l4")).getByText(/unsupported · locked/)
    ).toBeInTheDocument();
    await userEvent.click(within(card("l4")).getByText("80"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(props.onSelect).toHaveBeenCalledWith(["app", "l4", "virtualPort"]);
    expect(
      within(card("l4")).getAllByRole("button", { name: /remove/i }).length
    ).toBeGreaterThan(0);
  });

  it("reports what the pointer is over, with where it is", async () => {
    const props = renderPane();
    await userEvent.hover(within(row("pool")).getByText("pool"));
    expect(props.onHoverPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: ["app", "web", "pool"] })
    );
  });
});
