import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentLibrary, LibrarySettings } from "./DocumentLibrary";

const library = {
  id: 1,
  root_path: "C:\\Users\\test-user\\RolePilot\\library",
  revision: 1,
  available: true,
  last_scan_at: null,
  last_error: null,
  scan_summary: { folders: ["Resumes/resume_01Jan_v1"], issues: [] },
};
function show(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it("requires review before reconnecting mismatched library files", async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async (path: string, options: RequestInit) => ({
      ok: true,
      json: async () => {
        if (path.endsWith("/validate"))
          return {
            root_path: "E:\\Moved",
            matched: 0,
            changed: 1,
            missing: 0,
            unreadable: 0,
            requires_approval: true,
            issues: [
              { path: "Resumes/resume.pdf", message: "Checksum differs" },
            ],
          };
        if (options?.method === "PUT")
          return { ...library, root_path: "E:\\Moved" };
        return library;
      },
    }));
  vi.stubGlobal("fetch", fetch);
  show(<LibrarySettings />);
  const input = await screen.findByLabelText("Library root");
  await waitFor(() =>
    expect(input).toHaveValue("C:\\Users\\test-user\\RolePilot\\library"),
  );
  await userEvent.clear(input);
  await userEvent.type(input, "E:\\Moved");
  await userEvent.click(
    screen.getByRole("button", { name: "Validate folder & references" }),
  );
  const save = await screen.findByRole("button", { name: "Save root & index" });
  expect(save).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  expect(save).toBeEnabled();
  await userEvent.click(save);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Existing source files were not changed",
  );
  const request = fetch.mock.calls.find((c) => c[1]?.method === "PUT");
  expect(JSON.parse(request![1].body).accept_unverified).toBe(true);
});
it("changing the path invalidates previous validation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () =>
        path.endsWith("/validate")
          ? {
              root_path: "C:\\Users\\test-user\\RolePilot\\library",
              matched: 0,
              changed: 0,
              missing: 0,
              unreadable: 0,
              requires_approval: false,
              issues: [],
            }
          : library,
    })),
  );
  show(<LibrarySettings />);
  await waitFor(() =>
    expect(screen.getByLabelText("Library root")).toHaveValue(
      "C:\\Users\\test-user\\RolePilot\\library",
    ),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Validate folder & references" }),
  );
  expect(
    await screen.findByRole("button", { name: "Save root & index" }),
  ).toBeEnabled();
  await userEvent.type(screen.getByLabelText("Library root"), "x");
  expect(
    screen.queryByRole("button", { name: "Save root & index" }),
  ).not.toBeInTheDocument();
});
it("shows indexed metadata and missing files", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () =>
        path.includes("/documents?")
          ? {
              total: 1,
              items: [
                {
                  id: 8,
                  filename: "resume.pdf",
                  relative_path: "Resumes/resume_01Jan_v1/resume.pdf",
                  document_type: "Resume",
                  format: "pdf",
                  version_label: "resume_01Jan_v1",
                  folder_hint: "resume_01Jan_v1",
                  file_size: 100,
                  modified_at: "2026-10-01T00:00:00Z",
                  is_missing: true,
                  status: "Unreviewed",
                },
              ],
            }
          : library,
    })),
  );
  show(<DocumentLibrary />);
  expect(await screen.findByText("resume.pdf")).toBeInTheDocument();
  expect(screen.getByText("Missing")).toBeInTheDocument();
  expect(screen.getByText("Unreviewed")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open" }),
  ).not.toBeInTheDocument();
});
