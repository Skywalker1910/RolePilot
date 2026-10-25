import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminPage } from "./Admin";

afterEach(() => vi.unstubAllGlobals());

describe("administrator account controls", () => {
  it("creates an invitation and shows its full value only until hidden", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (path === "/api/admin/invitations" && init?.method === "POST") {
        return { ok: true, json: async () => ({ id: 3, code: "RP-one-time-secret" }) };
      }
      if (path === "/api/admin/invitations") {
        return {
          ok: true,
          json: async () => [{ id: 3, status: "unused", created_by: "admin", created_at: "2026-10-24", used_at: null, used_by: null, revoked_at: null }],
        };
      }
      if (path === "/api/admin/users") {
        return {
          ok: true,
          json: async () => [{ id: 1, username: "pilot", role: payload.role ?? "user", is_active: payload.is_active ?? true, created_at: "2026-10-24", password_changed_at: "2026-10-24", invitation_id: null }],
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AdminPage /></QueryClientProvider>);

    await screen.findByRole("textbox", { name: "Username for pilot" });
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(await screen.findByText("RP-one-time-secret")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hide code" }));
    await waitFor(() => expect(screen.queryByText("RP-one-time-secret")).not.toBeInTheDocument());
  });
});
