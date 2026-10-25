import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Login } from "./Login";
import { setCsrfToken } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe("hosted sign-in", () => {
  it("stores the CSRF token and enters the authenticated workspace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return {
        ok: true,
        json: async () => ({ authenticated: true, csrf_token: "session-csrf" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "pilot" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a long password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({
      auth_required: true,
      authenticated: true,
      csrf_token: "session-csrf",
    }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login");
  });

  it("shows a safe error when sign-in fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      statusText: "Unauthorized",
      json: async () => ({ detail: "Username or password is incorrect" }),
    })));
    render(<Login onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "pilot" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Username or password is incorrect");
  });

  it("submits invitation signup and enters the user's account", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      return {
        ok: true,
        json: async () => ({
          authenticated: true,
          csrf_token: "new-csrf",
          user: { id: 12, username: "invited-pilot", role: "user" },
        }),
        input,
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAuthenticated = vi.fn();
    render(<Login onAuthenticated={onAuthenticated} />);
    fireEvent.click(screen.getByRole("button", { name: "Have an invitation code? Create an account" }));
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "invited-pilot" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a sufficiently long password" } });
    fireEvent.change(screen.getByLabelText("Invitation code"), { target: { value: "RP-example-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({
      auth_required: true,
      authenticated: true,
      csrf_token: "new-csrf",
      user: { id: 12, username: "invited-pilot", role: "user" },
    }));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/signup");
  });
});
