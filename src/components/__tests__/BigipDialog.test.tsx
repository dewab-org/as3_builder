import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import BigipDialog from "../BigipDialog";

function renderDialog(applyEnabled?: boolean) {
  render(
    <BigipDialog
      declarationText="{}"
      applyEnabled={applyEnabled}
      onClose={vi.fn()}
    />
  );
}

describe("BIG-IP dialog apply gate", () => {
  it("offers Apply by default", () => {
    renderDialog();
    expect(screen.getByText("Apply…")).toBeInTheDocument();
    expect(screen.getByText("Run dry-run")).toBeInTheDocument();
  });

  it("removes Apply — and only Apply — when the deployment gates it", () => {
    renderDialog(false);
    expect(screen.queryByText("Apply…")).not.toBeInTheDocument();
    // Validate stays: that is the explicit requirement.
    expect(screen.getByText("Run dry-run")).toBeInTheDocument();
  });
});
