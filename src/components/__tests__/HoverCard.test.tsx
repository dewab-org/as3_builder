import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HoverCard from "../HoverCard";
import type { ClassRegistry, JsonSchemaRoot } from "../../engine";

// The card's job is placement, pinning and dismissal; what it says is the
// lookup's job, and that is covered by the engine suites. Stubbing the lookup
// keeps this suite about behaviour and off the 1.2MB schema.
const { hoverDetail } = vi.hoisted(() => ({ hoverDetail: vi.fn() }));
vi.mock("../hoverDetail", () => ({ hoverDetail }));

type CardProps = Parameters<typeof HoverCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const props: CardProps = {
    anchor: { path: ["app", "web", "pool"], x: 100, y: 100 },
    doc: {},
    schemaRoot: {} as JsonSchemaRoot,
    registry: new Map() as unknown as ClassRegistry,
    documentation: undefined,
    onPointerEnter: vi.fn(),
    onPointerLeave: vi.fn(),
    pinned: false,
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    ...overrides,
  };
  const view = render(<HoverCard {...props} />);
  return { props, view };
}

describe("hover card", () => {
  it("renders nothing when there is nothing to say", () => {
    hoverDetail.mockReturnValue(undefined);
    const { view } = renderCard();
    expect(view.container).toBeEmptyDOMElement();
  });

  it("shows the detail next to the pointer", () => {
    hoverDetail.mockReturnValue({ label: "pool", detail: { type: "string" } });
    renderCard();
    const card = document.querySelector(".hover-card") as HTMLElement;
    expect(card).toBeInTheDocument();
    expect(screen.getByText("pool")).toBeInTheDocument();
    // Offset from the cursor, not on top of it.
    expect(card.style.left).toBe("114px");
    expect(card.style.top).toBe("114px");
  });

  it("invites a pin, and pins on click", async () => {
    hoverDetail.mockReturnValue({ label: "pool", detail: { type: "string" } });
    const { props } = renderCard();
    expect(screen.getByText("click to pin")).toBeInTheDocument();
    await userEvent.click(document.querySelector(".hover-card") as HTMLElement);
    expect(props.onPin).toHaveBeenCalled();
  });

  it("says how to dismiss once pinned, and does not re-pin", async () => {
    hoverDetail.mockReturnValue({ label: "pool", detail: { type: "string" } });
    const { props } = renderCard({ pinned: true });
    expect(screen.getByText(/pinned/)).toBeInTheDocument();
    await userEvent.click(document.querySelector(".hover-card") as HTMLElement);
    expect(props.onPin).not.toHaveBeenCalled();
  });

  it("dismisses through its close button", async () => {
    hoverDetail.mockReturnValue({ label: "pool", detail: { type: "string" } });
    const { props } = renderCard({ pinned: true });
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(props.onUnpin).toHaveBeenCalled();
    // Closing must not also count as a click on the card.
    expect(props.onPin).not.toHaveBeenCalled();
  });

  it("hands the pointer back so the close delay can be cancelled", async () => {
    hoverDetail.mockReturnValue({ label: "pool", detail: { type: "string" } });
    const { props } = renderCard();
    const card = document.querySelector(".hover-card") as HTMLElement;
    await userEvent.hover(card);
    expect(props.onPointerEnter).toHaveBeenCalled();
    await userEvent.unhover(card);
    expect(props.onPointerLeave).toHaveBeenCalled();
  });
});
