import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FileSearch,
  Filter,
  Plus,
  Search,
  Copy,
  LayoutGrid,
  List,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  api,
  date,
  display,
  label,
  post,
  validUrl,
  type Job,
  type JobInput,
} from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { JobCard, JobStatusBadge, jobLocation } from "./components/JobCard";
import {
  FilterChip,
  LoadingSkeleton,
  OpportunityTabs,
  SkillTags,
} from "./components/presentation";
import { JobDrawer } from "./JobDrawer";
import { JobForm } from "./JobForm";
import { ErrorPanel } from "./App";

export function Explorer({ archived = false }: { archived?: boolean }) {
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(() =>
    localStorage.getItem("rolepilot-job-view") === "table" ? "table" : "cards",
  );
  const [creating, setCreating] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("rolepilot-job-columns") ||
          '{"preferred_skills":false,"sponsorship_policy":false,"posted_at":false,"imported_at":false}',
      );
    } catch {
      return {};
    }
  });
  const [notice, setNotice] = useState("");
  const queryClient = useQueryClient();
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("page_size") || 25);
  const selected = params.get("job");
  const query = new URLSearchParams(params);
  query.delete("job");
  query.set("archived", String(archived));
  const { data, error, isPending } = useQuery({
    queryKey: ["jobs", query.toString()],
    queryFn: () =>
      api<{ items: Job[]; total: number; page_size: number }>("/jobs?" + query),
  });
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  }
  function selectJob(id: number | null) {
    const next = new URLSearchParams(params);
    if (id) next.set("job", String(id));
    else next.delete("job");
    setParams(next);
  }
  const columns = useMemo<ColumnDef<Job>[]>(
    () => [
      {
        accessorKey: "job_title",
        header: "Opportunity",
        cell: ({ row }) => (
          <div className="job-title-cell">
            <button
              className="job-title"
              onClick={() => selectJob(row.original.id)}
            >
              <strong>{row.original.job_title}</strong>
              <span>{row.original.company_name}</span>
            </button>
            <small className="badge">
              {String(row.original.verification_status || "Unverified")}
            </small>
          </div>
        ),
      },
      {
        id: "application_status",
        header: "Application",
        cell: ({ row }) => <JobStatusBadge job={row.original} />,
      },
      {
        accessorKey: "company_job_id",
        header: "Requisition",
        cell: ({ getValue }) => (
          <span className="mono">{String(getValue() || "—")}</span>
        ),
      },
      {
        id: "location",
        header: "Location",
        cell: ({ row }) => (
          <>
            <span>{jobLocation(row.original)}</span>
            <small className="cell-sub">
              {String(row.original.remote_type || "Work mode unknown")}
            </small>
          </>
        ),
      },
      {
        id: "salary",
        header: "Salary",
        cell: ({ row }) => (
          <>
            <span>
              {(row.original.salary_min !== null &&
                row.original.salary_min !== undefined) ||
              (row.original.salary_max !== null &&
                row.original.salary_max !== undefined)
                ? [row.original.salary_min, row.original.salary_max]
                    .map((v) =>
                      v === null || v === undefined
                        ? "?"
                        : Number(v).toLocaleString(),
                    )
                    .join(" – ")
                : "Not specified"}
            </span>
            <small className="cell-sub">
              {[row.original.salary_currency, row.original.salary_period]
                .filter(Boolean)
                .join(" / ")}
            </small>
          </>
        ),
      },
      {
        accessorKey: "minimum_experience",
        header: "Experience",
        cell: ({ row }) =>
          row.original.minimum_experience == null &&
          row.original.maximum_experience == null
            ? "Not specified"
            : display(row.original.minimum_experience) +
              " – " +
              display(row.original.maximum_experience) +
              " yrs",
      },
      {
        accessorKey: "required_skills",
        header: "Required skills",
        cell: ({ row }) => (
          <SkillTags skills={row.original.required_skills} limit={4} />
        ),
      },
      {
        accessorKey: "sponsorship_policy",
        header: "Sponsorship",
        cell: ({ getValue }) => String(getValue() || "Review needed"),
      },
      {
        accessorKey: "preferred_skills",
        header: "Preferred skills",
        cell: ({ row }) => (
          <div className="chips">
            {row.original.preferred_skills.slice(0, 3).map((s) => (
              <span className="chip muted-chip" key={s}>
                {s}
              </span>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "posted_at",
        header: "Date posted",
        cell: ({ getValue }) => date(getValue() as string),
      },
      {
        accessorKey: "imported_at",
        header: "Added",
        cell: ({ getValue }) => (
          <span className="nowrap">
            {new Date(String(getValue())).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="row-actions">
            <button
              className="icon-button"
              aria-label="Copy requisition ID"
              title="Copy requisition ID"
              disabled={!row.original.company_job_id}
              onClick={() =>
                void navigator.clipboard.writeText(
                  String(row.original.company_job_id),
                )
              }
            >
              <Copy size={15} />
            </button>
            <a
              className="icon-button"
              aria-label="Open employer posting"
              target="_blank"
              rel="noopener noreferrer"
              href={
                validUrl(String(row.original.canonical_job_url))
                  ? String(row.original.canonical_job_url)
                  : undefined
              }
            >
              <ArrowUpRight size={16} />
            </a>
            <button
              className="icon-button"
              aria-label={"View " + row.original.job_title}
              onClick={() => selectJob(row.original.id)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        ),
      },
      // Selection is URL-backed; column handlers are refreshed with URL changes.
    ],
    [params],
  );
  const table = useReactTable({
    data: data?.items || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: (updater) => {
      setVisibility((previous) => {
        const next =
          typeof updater === "function" ? updater(previous) : updater;
        localStorage.setItem("rolepilot-job-columns", JSON.stringify(next));
        return next;
      });
    },
  });
  async function saveJob(input: JobInput) {
    await post("/jobs", input);
    await queryClient.invalidateQueries();
    setCreating(false);
    setNotice("Job saved to your workspace.");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {archived ? "RETAINED OPPORTUNITIES" : "YOUR JOB SEARCH"}
          </div>
          <h1>
            {archived ? "Archive" : "Opportunities"}{" "}
            <span className="count-badge">{data?.total ?? "—"}</span>
          </h1>
          <p>
            {archived
              ? "Every detail stays with your jobs. Restore them whenever you need."
              : "All your opportunities. One organized workspace."}
          </p>
        </div>
        {!archived && (
          <div className="actions">
            <Button variant="outline" onClick={() => setCreating(true)}>
              <Plus size={16} />
              Add job
            </Button>
            <Button asChild>
              <Link to="/imports">
                <ArrowDownToLine size={16} />
                Import jobs
              </Link>
            </Button>
          </div>
        )}
      </div>
      {!archived && <OpportunityTabs />}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
      <section className="panel explorer-panel">
        <div className="explorer-tabs">
          <strong>
            {archived ? "Archived opportunities" : "All opportunities"}
          </strong>
          <span>Actual listings. Your decisions.</span>
        </div>
        <div className="filter-bar">
          <label className="search-input">
            <Search size={16} />
            <input
              aria-label="Search jobs"
              placeholder="Search title, company, skills…"
              value={params.get("q") || ""}
              onChange={(e) => filter("q", e.target.value)}
            />
          </label>
          <select
            aria-label="Work mode"
            value={params.get("remote_type") || ""}
            onChange={(e) => filter("remote_type", e.target.value)}
          >
            <option value="">All work modes</option>
            {["Remote", "Hybrid", "On-site"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="Sort jobs"
            value={params.get("sort") || "newest"}
            onChange={(e) => filter("sort", e.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="title">Job title</option>
            <option value="salary">Highest salary</option>
            <option value="company">Company</option>
            <option value="posted">Date posted</option>
            <option value="oldest">Oldest first</option>
          </select>
          <select
            aria-label="Opportunity status"
            value={params.get("shortlisted") || ""}
            onChange={(e) => filter("shortlisted", e.target.value)}
          >
            <option value="">All opportunities</option>
            <option value="true">Shortlisted</option>
            <option value="false">Not shortlisted</option>
          </select>
          <div className="segmented-control" aria-label="Opportunity layout">
            <button
              aria-pressed={view === "cards"}
              onClick={() => {
                setView("cards");
                localStorage.setItem("rolepilot-job-view", "cards");
              }}
            >
              <LayoutGrid size={15} />
              Card view
            </button>
            <button
              aria-pressed={view === "table"}
              onClick={() => {
                setView("table");
                localStorage.setItem("rolepilot-job-view", "table");
              }}
            >
              <List size={15} />
              Table view
            </button>
          </div>
          {view === "table" && (
            <Button
              variant="outline"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen(!columnsOpen)}
            >
              <Columns3 size={16} />
              Columns
            </Button>
          )}
        </div>
        <details className="more-filters">
          <summary>
            <Filter size={14} />
            More filters & saved view
          </summary>
          <div className="filter-grid">
            {[
              ["company", "Company"],
              ["location", "Location"],
              ["skill", "Skill"],
              ["preferred_skill", "Preferred skill"],
              ["sponsorship", "Sponsorship text"],
              ["salary_min", "Minimum salary offered"],
              ["salary_max", "Maximum salary offered"],
              ["experience_min", "Minimum experience required"],
              ["experience_max", "Maximum experience required"],
              ["employment_type", "Employment type"],
              ["seniority", "Seniority"],
              ["citizenship_requirement", "Citizenship requirement"],
              ["security_clearance", "Security clearance"],
              ["verification_status", "Verification status"],
              ["date_posted_from", "Posted on or after"],
              ["date_posted_to", "Posted on or before"],
              ["date_imported_from", "Imported on or after"],
              ["date_imported_to", "Imported on or before"],
            ].map(([key, name]) => (
              <label key={key}>
                {name}
                <input
                  type={
                    key.startsWith("date_")
                      ? "date"
                      : [
                            "salary_min",
                            "salary_max",
                            "experience_min",
                            "experience_max",
                          ].includes(key)
                        ? "number"
                        : "text"
                  }
                  min="0"
                  value={params.get(key) || ""}
                  onChange={(e) => filter(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <p className="muted">
            Salary and experience filters exclude unknown values. Salary
            comparisons use the listing’s original currency and period.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={params.get("include_unspecified_experience") === "true"}
              onChange={(e) =>
                filter(
                  "include_unspecified_experience",
                  e.target.checked ? "true" : "",
                )
              }
            />
            Include jobs with unspecified experience
          </label>
          <div className="actions">
            <Button
              variant="outline"
              onClick={() => {
                localStorage.setItem(
                  "rolepilot-saved-filter",
                  query.toString(),
                );
                setNotice("Filter view saved on this browser.");
              }}
            >
              Save current view
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                const saved = localStorage.getItem("rolepilot-saved-filter");
                if (saved) setParams(new URLSearchParams(saved));
                else setNotice("No saved view yet.");
              }}
            >
              Load saved view
            </Button>
            <Button variant="ghost" onClick={() => setParams({})}>
              Clear filters
            </Button>
          </div>
        </details>
        {Array.from(params.entries()).some(
          ([key]) =>
            !["job", "sort", "page", "page_size", "archived"].includes(key),
        ) && (
          <div className="active-filters" aria-label="Active filters">
            {Array.from(params.entries())
              .filter(
                ([key]) =>
                  !["job", "sort", "page", "page_size", "archived"].includes(
                    key,
                  ),
              )
              .map(([key, value]) => (
                <FilterChip
                  key={key}
                  label={key === "q" ? "Search" : label(key)}
                  value={value}
                  onRemove={() => filter(key, "")}
                />
              ))}
            <Button variant="ghost" onClick={() => setParams({})}>
              Clear all
            </Button>
          </div>
        )}
        {columnsOpen && view === "table" && (
          <div className="column-picker">
            {table
              .getAllLeafColumns()
              .filter((c) => c.id !== "actions")
              .map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={c.getIsVisible()}
                    onChange={c.getToggleVisibilityHandler()}
                  />
                  {String(c.columnDef.header)}
                </label>
              ))}
          </div>
        )}
        {error ? (
          <ErrorPanel error={error} />
        ) : isPending ? (
          <LoadingSkeleton label="Loading opportunities" />
        ) : data?.items.length ? (
          view === "cards" ? (
            <div className="job-grid">
              {data.items.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onOpen={() => selectJob(job.id)}
                  onNotice={setNotice}
                />
              ))}
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  {table.getHeaderGroups().map((g) => (
                    <tr key={g.id}>
                      {g.headers.map((h) => (
                        <th key={h.id}>
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext(),
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((r) => (
                    <tr key={r.id}>
                      {r.getVisibleCells().map((c) => (
                        <td key={c.id}>
                          {flexRender(c.column.columnDef.cell, c.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="empty">
            <FileSearch size={42} />
            <h3>
              {archived ? "No archived jobs" : "No opportunities here yet"}
            </h3>
            <p>
              {params.toString()
                ? "Try changing your filters."
                : "Import your company listings to start building your search."}
            </p>
            {!archived && (
              <Button asChild variant="outline">
                <Link to="/imports">Import a spreadsheet</Link>
              </Button>
            )}
          </div>
        )}
        <div className="pagination">
          <label>
            Rows per page{" "}
            <select
              aria-label="Rows per page"
              value={pageSize}
              onChange={(e) => filter("page_size", e.target.value)}
            >
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <span>{data?.total || 0} opportunities</span>
          <div>
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set("page", String(page - 1));
                setParams(n);
              }}
            >
              <ChevronLeft size={16} />
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="ghost"
              disabled={page * pageSize >= (data?.total || 0)}
              onClick={() => {
                const n = new URLSearchParams(params);
                n.set("page", String(page + 1));
                setParams(n);
              }}
            >
              Next
              <ChevronRight size={16} />
            </Button>
          </div>
        </div>
      </section>
      <p className="privacy-note">
        <span className="status-dot" /> Imported information should be verified
        against the employer’s listing.
      </p>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Add an opportunity"
        description="Save a real company listing to your workspace."
      >
        <JobForm onSave={saveJob} />
      </Dialog>
      {selected && (
        <JobDrawer
          key={selected}
          id={Number(selected)}
          onClose={() => selectJob(null)}
          onNotice={setNotice}
        />
      )}
    </>
  );
}
