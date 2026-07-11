import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { api, ApiError } from "@/lib/api";
import { ChangePasswordDialog } from "../ChangePasswordDialog";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      changePassword: vi.fn(),
    },
  };
});

function fill(labelText: string, value: string) {
  fireEvent.change(screen.getByLabelText(labelText), { target: { value } });
}

describe("ChangePasswordDialog", () => {
  beforeEach(() => {
    vi.mocked(api.changePassword).mockReset();
  });

  it("blocks submit when the confirm field doesn't match the new password", () => {
    const onOpenChange = vi.fn();
    render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);

    fill("当前密码", "old-password");
    fill("新密码", "new-password-1");
    fill("确认新密码", "new-password-2");

    expect(screen.getByText("两次输入的新密码不一致")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    expect(api.changePassword).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("blocks submit when the new password is under 8 characters", () => {
    render(<ChangePasswordDialog open onOpenChange={() => {}} />);

    fill("当前密码", "old-password");
    fill("新密码", "short1");
    fill("确认新密码", "short1");

    const submitButton = screen.getByRole("button", { name: "确认修改" }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(true);
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  it("calls the API with the correct body and closes on success", async () => {
    vi.mocked(api.changePassword).mockResolvedValue({ changed: true });
    const onOpenChange = vi.fn();
    render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);

    fill("当前密码", "old-password");
    fill("新密码", "new-password-123");
    fill("确认新密码", "new-password-123");

    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => {
      expect(api.changePassword).toHaveBeenCalledWith({
        current_password: "old-password",
        new_password: "new-password-123",
      });
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows the backend error detail inline on a 400 (wrong current password) instead of closing", async () => {
    vi.mocked(api.changePassword).mockRejectedValue(new ApiError(400, "当前密码不正确"));
    const onOpenChange = vi.fn();
    render(<ChangePasswordDialog open onOpenChange={onOpenChange} />);

    fill("当前密码", "wrong-password");
    fill("新密码", "new-password-123");
    fill("确认新密码", "new-password-123");

    fireEvent.click(screen.getByRole("button", { name: "确认修改" }));

    await waitFor(() => {
      expect(screen.getByText("当前密码不正确")).toBeDefined();
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
