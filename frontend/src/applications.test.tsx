import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Applications } from "./Applications";
import { PendingApplicationConfirmation } from "./App";
import { Explorer } from "./Explorer";

const job = {
  id: 4, company_id: 2, company_name: "Fictional Orbit", job_title: "Research Engineer",
  company_job_id: "R-004", canonical_job_url: "https://orbit.example/jobs/4",
  required_skills: [], preferred_skills: [], job_keywords: [], revision: 1,
  imported_at: "2026-10-15T00:00:00+00:00", updated_at: "2026-10-15T00:00:00+00:00",
  archived_at: null, locally_edited_fields: [],
  provenance: [],
};
const app = {
  id: 12, job_id: 4, job, current_status: "Pending Application", custom_stage_label: null,
  priority: 3, applied_at: null, next_follow_up_at: null, desired_salary: null,
  desired_salary_currency: null, referral_status: null, notes: null, archived_at: null,
  pending_confirmation: true, confirmation_remind_at: null, revision: 1,
  history: [{ id: 1, previous_status: null, new_status: "Pending Application", changed_at: "2026-10-16T12:00:00+00:00", source: "apply_workflow", notes: null }],
  tasks: [],
};
function wrapper(element: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());

describe("Application workflow", () => {
  it("creates a pending record before opening the official job portal", async () => {
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () => path.startsWith("/api/jobs?")
        ? { items: [job], total: 1, page_size: 25 }
        : path === "/api/jobs/4" ? job
          : path.includes("/applications?job_id=") ? { items: [], total: 0 }
            : { application: { id: 88 }, created: true },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const portal = { opener: window, location: { href: "" }, close: vi.fn() };
    vi.stubGlobal("open", vi.fn(() => portal));
    wrapper(<Explorer/>);
    await userEvent.click(await screen.findByText("Research Engineer", { selector: "strong" }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    await waitFor(() => expect(portal.location.href).toBe(job.canonical_job_url));
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/4/apply", expect.objectContaining({ method: "POST" }));
  });

  it("checks pending confirmation only on focus and records the user's answer", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_path: string, options?: RequestInit) => ({
      ok: true,
      json: async () => options?.method === "POST" ? { ...app, current_status: "Applied" } : [app],
    }));
    vi.stubGlobal("fetch", fetchMock);
    wrapper(<PendingApplicationConfirmation/>);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("Did you submit your application for this position?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, I applied" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/applications/12/confirm");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ action: "applied" });
  });

  it("renders the hiring pipeline from persisted application data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [app], total: 1 }) }));
    wrapper(<Applications/>);
    expect(await screen.findByRole("heading", { name: /Applications/ })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("Fictional Orbit");
    expect(table).toHaveTextContent("Pending Application");
    expect(table).toHaveTextContent("Needs confirmation");
  });
});
