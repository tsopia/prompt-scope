import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";

function Probe() {
  const { user, loading } = useAuth();
  return <div>{loading ? "loading" : user ? user.email : "anon"}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the user when getMe succeeds", async () => {
    vi.spyOn(api, "getMe").mockResolvedValue({
      id: "1", email: "a@x.com", display_name: "A", auth_source: "local" });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("a@x.com")).toBeDefined());
  });

  it("shows anon on 401", async () => {
    vi.spyOn(api, "getMe").mockRejectedValue(new ApiError(401, "not authenticated"));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("anon")).toBeDefined());
  });
});
