import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "./ImportWizard";
import { Explorer } from "./Explorer";
import { JobForm } from "./JobForm";
import { validUrl, type JobInput } from "./api";

const job: JobInput = {
  company_name: "Fictional Orbit",
  job_title: "Engineer",
  canonical_job_url: "https://orbit.example/jobs/1",
  required_skills: ["python"],
  preferred_skills: [],
};
function wrapper(component: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("Job management", () => {
  it("validates salary ranges before saving", async () => {
    const save = vi.fn();
    render(<JobForm initial={job} onSave={save} />);
    await userEvent.type(screen.getByLabelText("Salary min"), "200000");
    await userEvent.type(screen.getByLabelText("Salary max"), "100000");
    await userEvent.click(screen.getByRole("button", { name: "Save job" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Minimum salary");
    expect(save).not.toHaveBeenCalled();
  });
  it("rejects non-HTTP URLs and preserves unknown values", async () => {
    expect(validUrl("javascript:alert(1)")).toBe(false);
    expect(validUrl("https://user:pass@example.com")).toBe(false);
    const save = vi.fn();
    render(<JobForm initial={job} onSave={save} />);
    await userEvent.click(screen.getByRole("button", { name: "Save job" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ salary_min: null, minimum_experience: null }),
    );
  });
  it("renders actual API jobs and keeps descriptions as text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              ...job,
              id: 1,
              revision: 1,
              imported_at: "2026-10-01T00:00:00+00:00",
              salary_min: null,
              salary_max: null,
            },
          ],
          total: 1,
          page_size: 25,
        }),
      }),
    );
    wrapper(<Explorer />);
    expect(await screen.findByText("Fictional Orbit")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(screen.getByRole("table")).toHaveTextContent("python");
    expect(screen.getByRole("table")).toHaveTextContent("Not specified");
  });
  it("previews, requires confirmation, then commits an import", async () => {
    const preview = {
      id: "preview-1",
      filename: "jobs.csv",
      mapping: { Company: "company_name" },
      fields: ["company_name", "job_title", "canonical_job_url"],
      rows: [
        {
          row_number: 2,
          raw: { Company: "Fictional Orbit" },
          data: job,
          errors: [],
          warnings: [],
          duplicate_kind: null,
          candidates: [],
          conflicts: {},
        },
      ],
    };
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      json: async () =>
        path.endsWith("/preview")
          ? preview
          : {
              id: 1,
              filename: "jobs.csv",
              inserted: 1,
              updated: 0,
              skipped: 0,
              rejected: 0,
            },
    }));
    vi.stubGlobal("fetch", fetchMock);
    wrapper(<ImportWizard />);
    await userEvent.upload(
      screen.getByLabelText("Upload spreadsheet"),
      new File(["Company\nFictional Orbit"], "jobs.csv", { type: "text/csv" }),
    );
    expect(await screen.findByText("Review your rows")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(
      screen.getByRole("button", { name: "Review & save" }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm import",
      }),
    );
    expect(
      await screen.findByText("Your opportunities are ready."),
    ).toBeInTheDocument();
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.decisions[0].action).toBe("insert");
  });
  it("defaults duplicates to skip and requires field replacement approval", async () => {
    const preview = {
      id: "p",
      filename: "jobs.csv",
      mapping: { Company: "company_name" },
      fields: ["company_name"],
      rows: [
        {
          row_number: 2,
          raw: {},
          data: job,
          errors: [],
          warnings: [],
          duplicate_kind: "exact",
          candidates: [
            {
              id: 1,
              revision: 3,
              company_name: job.company_name,
              job_title: job.job_title,
            },
          ],
          conflicts: {
            "1": {
              job_title: {
                current: "Local title",
                incoming: "Engineer",
                locally_edited: true,
              },
            },
          },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => preview }),
    );
    wrapper(<ImportWizard />);
    await userEvent.upload(
      screen.getByLabelText("Upload spreadsheet"),
      new File(["x"], "jobs.csv", { type: "text/csv" }),
    );
    const select = await screen.findByLabelText("Action for row 2");
    expect(select).toHaveValue("skip");
    await userEvent.selectOptions(select, "update");
    expect(screen.getByText("Local title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review & save" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Review & save" })).toBeEnabled();
  });
  it("shows API errors without claiming success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Invalid spreadsheet" }),
      }),
    );
    wrapper(<ImportWizard />);
    await userEvent.upload(
      screen.getByLabelText("Upload spreadsheet"),
      new File(["x"], "jobs.csv", { type: "text/csv" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Invalid spreadsheet",
      ),
    );
  });
});
