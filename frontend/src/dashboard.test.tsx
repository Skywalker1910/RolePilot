import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overview } from "./App";

const overview = {
  total_jobs: 4,
  archived_jobs: 2,
  companies: 3,
  import_batches: 1,
  recent_jobs: [],
  companies_chart: [],
  activity: [],
  application_metrics: {
    applications_total: 1,
    applications_active: 1,
    pending_confirmations: 1,
    submitted: 0,
    under_review: 0,
    interview_opportunities: 0,
    offers: 0,
    rejections: 0,
    follow_ups_due: 0,
    response_rate: null,
    interview_conversion_rate: null,
    stage_distribution: [{ status: "Pending Application", count: 1 }],
    applications_over_time: [],
    rate_denominator: "Reached Applied or later",
    response_rule: "Recorded reply",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("overview workspace", () => {
  it("shows compact KPIs, attention items, and real pipeline stages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const path = String(input);
        const body = path.endsWith("/overview")
          ? overview
          : path.includes("pending-confirmations")
            ? []
            : { items: [], total: 0 };
        return { ok: true, json: async () => body };
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Overview />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    expect(screen.getByText("Pending Application")).toBeInTheDocument();
    expect(screen.getByText("No application confirmations are waiting.")).toBeInTheDocument();
    expect(document.querySelectorAll(".metric-card")).toHaveLength(4);
    expect(screen.queryByText("Make your next move intentional.")).not.toBeInTheDocument();
  });
});
