import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  it("renders the kind text as label", () => {
    render(<StatusBadge kind="running" />);
    expect(screen.getByText("running")).toBeDefined();
  });

  it("applies success semantic class for success kind", () => {
    render(<StatusBadge kind="success" />);
    expect(screen.getByText("success").className).toContain("text-success");
  });

  it("applies replay semantic class for replay kind", () => {
    render(<StatusBadge kind="replay" />);
    expect(screen.getByText("replay").className).toContain("text-replay");
  });

  it("applies destructive semantic class for error kind", () => {
    render(<StatusBadge kind="error" />);
    expect(screen.getByText("error").className).toContain("text-destructive");
  });

  it("renders custom label overriding kind text", () => {
    render(<StatusBadge kind="warning" label="borderline" />);
    expect(screen.getByText("borderline")).toBeDefined();
    expect(screen.queryByText("warning")).toBeNull();
  });
});
