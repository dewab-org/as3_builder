import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AboutDialog from "../AboutDialog";
import { APP_AUTHOR, APP_VERSION } from "../../version";

describe("about dialog", () => {
  it("reports the version and the author", () => {
    render(<AboutDialog onClose={vi.fn()} />);
    expect(screen.getByText(APP_VERSION)).toBeInTheDocument();
    expect(screen.getByText(APP_AUTHOR)).toBeInTheDocument();
  });

  it("closes", async () => {
    const onClose = vi.fn();
    render(<AboutDialog onClose={onClose} />);
    await userEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
