import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { Explorer } from "./Explorer";
import { Applications } from "./Applications";
import { Companies } from "./Companies";
import { DocumentLibrary } from "./DocumentLibrary";
import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { SkillTags, StatusBadge } from "./components/presentation";
import { JobCard, experience } from "./components/JobCard";
import type { Job } from "./api";

const job = {
  id: 1,
  company_id: 1,
  revision: 1,
  company_name: "Fictional Orbit",
  job_title: "Engineer",
  company_job_id: "ENG-001",
  canonical_job_url: "https://example.com/job/1",
  location: "Boston",
  required_skills: ["Python", "SQL", "AWS", "Docker", "React", "TypeScript"],
  preferred_skills: ["Rust"],
  job_keywords: [],
  imported_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
  minimum_experience: null,
  maximum_experience: null,
  archived_at: null,
  locally_edited_fields: [],
  provenance: [],
  full_description: "Untrusted <script>alert(1)</script> text",
} as unknown as Job;
const application = {
  id: 2,
  job_id: 1,
  job,
  current_status: "Applied",
  priority: 2,
  applied_at: "2026-10-01T12:00:00Z",
  next_follow_up_at: null,
  tasks: [],
  history: [],
  revision: 1,
};
function show(element: React.ReactNode, path = "/") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
function mockApi(overrides?: (path: string, options: RequestInit) => unknown) {
  const fetch = vi.fn(async (path: string, options: RequestInit) => ({
    ok: true,
    json: async () => {
      const override = overrides?.(path, options);
      if (override !== undefined) return override;
      if (path === "/api/auth/session")
        return { auth_required: false, authenticated: true };
      if (path === "/api/health")
        return { status: "ok", schema_version: "fixture" };
      if (path === "/api/document-library")
        return {
          available: true,
          root_path: "Fixture library",
          scan_summary: {},
        };
      if (path === "/api/jobs/1") return job;
      if (path.startsWith("/api/jobs?"))
        return { items: [job], total: 1, page_size: 25 };
      if (path === "/api/companies")
        return [{ id: 1, name: "Fictional Orbit", updated_at: "fixture" }];
      if (path === "/api/companies/1") return { jobs: [job] };
      if (path.startsWith("/api/applications")) return { items: [], total: 0 };
      if (path.startsWith("/api/documents")) return { items: [], total: 0 };
      return {};
    },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

it("simplifies navigation and keeps secondary routes inside Opportunities", () => {
  show(<WorkspaceNavigation />, "/companies");
  expect(screen.getByRole("link", { name: "Opportunities" })).toHaveClass(
    "active",
  );
  expect(
    screen.queryByRole("link", { name: "Companies" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Network")).toHaveAttribute("aria-disabled", "true");
  expect(
    screen.queryByRole("link", { name: "Import jobs" }),
  ).not.toBeInTheDocument();
});

it("keeps status labels and skill overflow understandable without color", () => {
  render(
    <>
      <StatusBadge status="Pending Application" />
      <StatusBadge status="Offer Received" />
      <SkillTags skills={job.required_skills} limit={4} />
    </>,
  );
  expect(screen.getByText("Pending Application")).toHaveClass("status-warning");
  expect(screen.getByText("Offer Received")).toHaveClass("status-success");
  expect(screen.getByLabelText(/2 more skills/)).toHaveTextContent("+2");
  expect(screen.queryByText("TypeScript")).not.toBeInTheDocument();
  expect(experience(job)).toBe("Experience not specified");
});

it("defaults to cards and retains a persisted table with column controls", async () => {
  mockApi();
  show(<Explorer />);
  expect(
    await screen.findByRole("article", { name: "Engineer at Fictional Orbit" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Table view" }));
  expect(screen.getByRole("table")).toHaveTextContent("Boston");
  expect(localStorage.getItem("rolepilot-job-view")).toBe("table");
  await userEvent.click(screen.getByRole("button", { name: "Columns" }));
  expect(
    screen.getByRole("checkbox", { name: "Preferred skills" }),
  ).not.toBeChecked();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Preferred skills" }),
  );
  expect(screen.getByRole("table")).toHaveTextContent("Rust");
});

it("combines backend filters and removes individual active chips", async () => {
  const fetch = mockApi();
  show(<Explorer />);
  await screen.findByText("Fictional Orbit");
  await userEvent.type(screen.getByLabelText("Search jobs"), "Python");
  await userEvent.selectOptions(screen.getByLabelText("Work mode"), "Remote");
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([path]) =>
          path.includes("q=Python") && path.includes("remote_type=Remote"),
      ),
    ).toBe(true),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Remove Remote type filter" }),
  );
  expect(
    screen.queryByRole("button", { name: "Remove Remote type filter" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove Search filter" }),
  ).toBeInTheDocument();
});

it("organizes the drawer with safe text and explicit unknown eligibility", async () => {
  mockApi();
  show(<Explorer />, "/jobs?job=1");
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(
    await within(dialog).findByRole("button", {
      name: "Requirements",
    }),
  );
  expect(within(dialog).getByText("Sponsorship policy")).toBeInTheDocument();
  expect(within(dialog).getAllByText("Not specified").length).toBeGreaterThan(
    0,
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Description" }),
  );
  expect(
    within(dialog).getByText("Untrusted <script>alert(1)</script> text"),
  ).toBeInTheDocument();
  expect(dialog.querySelector("script")).toBeNull();
  expect(
    within(dialog).getByRole("link", { name: "Open official posting" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("persists shortlist changes and reports failures without visual-only mutation", async () => {
  const fetch = mockApi();
  const notice = vi.fn();
  show(<JobCard job={job} onOpen={vi.fn()} onNotice={notice} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Shortlist: Engineer" }),
  );
  await waitFor(() =>
    expect(notice).toHaveBeenCalledWith("Added to shortlist."),
  );
  const request = fetch.mock.calls.find(
    ([path]) => path === "/api/jobs/1/shortlist",
  );
  expect(JSON.parse(request![1].body as string)).toEqual({
    shortlisted: true,
    expected_revision: 1,
  });
});

it("preserves pending state and explains a blocked external portal", async () => {
  const fetch = mockApi();
  vi.stubGlobal(
    "open",
    vi.fn(() => null),
  );
  const notice = vi.fn();
  show(<JobCard job={job} onOpen={vi.fn()} onNotice={notice} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(notice).toHaveBeenCalledWith(
      expect.stringContaining("browser blocked the portal"),
    ),
  );
  expect(fetch.mock.calls.some(([path]) => path === "/api/jobs/1/apply")).toBe(
    true,
  );
});

it("shows persisted application stages on cards and saves Kanban transitions", async () => {
  const fetch = mockApi((path) =>
    path.startsWith("/api/applications?")
      ? { items: [application], total: 26 }
      : undefined,
  );
  show(<Applications />);
  await screen.findByRole("table");
  await userEvent.click(screen.getByRole("button", { name: "Kanban view" }));
  expect(
    screen.getByText("Applied", { selector: ".status-badge" }),
  ).toBeInTheDocument();
  expect(screen.getByText("No next action scheduled")).toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Application status"),
    "Under Review",
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => path === "/api/applications/2/status"),
    ).toBe(true),
  );
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([path]) => path.includes("page=2"))).toBe(
      true,
    ),
  );
});

it("opens manual application entry from dashboard and command links", async () => {
  mockApi();
  show(<Applications />, "/applications?create=true");
  expect(
    await screen.findByRole("dialog", { name: "Record a past application" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save application" }),
  ).toBeDisabled();
});

it("keeps company editing contextual and writes through the existing API", async () => {
  const fetch = mockApi();
  show(<Companies />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Fictional Orbit" }),
  );
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("industry"), "Research");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save changes" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    fetch.mock.calls.some(
      ([path, options]) =>
        path === "/api/companies/1" && options.method === "PATCH",
    ),
  ).toBe(true);
});

it("switches document collections using existing server filters", async () => {
  const fetch = mockApi();
  show(<DocumentLibrary />);
  await userEvent.click(
    screen.getByRole("button", { name: "Cover letters" }),
  );
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => path.includes("category=Cover+Letter")),
    ).toBe(true),
  );
  expect(
    screen.getByRole("button", { name: "Cover letters" }),
  ).toHaveAttribute("aria-pressed", "true");
});

it("persists both theme and sidebar preferences and supports keyboard quick actions", async () => {
  mockApi();
  show(<App />, "/settings");
  await userEvent.click(screen.getByRole("button", { name: "Obsidian" }));
  expect(localStorage.getItem("rolepilot-theme")).toBe("dark");
  expect(document.querySelector(".app")).toHaveClass("dark");
  await userEvent.click(
    screen.getByRole("button", { name: "Collapse sidebar" }),
  );
  expect(localStorage.getItem("rolepilot-sidebar")).toBe("collapsed");
  await userEvent.keyboard("{Control>}k{/Control}");
  const dialog = screen.getByRole("dialog", { name: "Search & quick actions" });
  expect(within(dialog).getByLabelText("Search workspace")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("button", { name: "Cloud White" }));
  expect(document.querySelector(".app")).not.toHaveClass("dark");
  await userEvent.click(
    screen.getByRole("button", { name: "Toggle navigation" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Your workspace" }),
  ).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: "Toggle navigation" }),
  ).toHaveFocus();
});
