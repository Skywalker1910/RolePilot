import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Pencil, Plus, Save, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api, post, validUrl, type Job } from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { EmptyState, PageHeader } from "./components/workspace";
import { LoadingSkeleton, OpportunityTabs } from "./components/presentation";
import { ErrorPanel } from "./App";

type Company = {
  id: number;
  name: string;
  industry: string | null;
  website: string | null;
  careers_page_url: string | null;
  headquarters: string | null;
  notes: string | null;
  updated_at: string;
  jobs?: Job[];
};
const blank = {
  name: "",
  industry: "",
  website: "",
  careers_page_url: "",
  headquarters: "",
  notes: "",
};

export function Companies() {
  const client = useQueryClient();
  const [draft, setDraft] = useState(blank);
  const [editing, setEditing] = useState<Company | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const { data, error, isPending } = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<Company[]>("/companies"),
  });
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api<Company>(`/companies/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              ...draft,
              expected_revision: editing.updated_at,
            }),
          })
        : post<Company>("/companies", draft),
    onSuccess: async () => {
      await client.invalidateQueries();
      setDraft(blank);
      setEditing(null);
      setOpen(false);
      setNotice("Company saved.");
    },
  });
  const visible = data?.filter((company) =>
    `${company.name} ${company.industry || ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        title="Companies"
        description="The employers behind your opportunities."
        actions={
          <Button
            onClick={() => {
              setDraft(blank);
              setEditing(null);
              save.reset();
              setOpen(true);
            }}
          >
            <Plus size={16} />
            Add company
          </Button>
        }
      />
      <OpportunityTabs />
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && <ErrorPanel error={error} />}
      <div className="filter-bar">
        <input
          type="search"
          aria-label="Search companies"
          placeholder="Search company or industry…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="muted">{visible?.length ?? 0} employers</span>
      </div>
      {isPending ? (
        <LoadingSkeleton label="Loading companies" />
      ) : visible?.length ? (
        <div className="companies-directory">
          {visible.map((company) => (
            <CompanyCard
              key={company.id}
              company={company}
              onEdit={() => {
                setEditing(company);
                setDraft({
                  name: company.name,
                  industry: company.industry || "",
                  website: company.website || "",
                  careers_page_url: company.careers_page_url || "",
                  headquarters: company.headquarters || "",
                  notes: company.notes || "",
                });
                save.reset();
                setOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Building2}
          title="No matching employers"
          description="Import a listing to add its company, or create one manually."
        />
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={editing ? `Edit ${editing.name}` : "Add a company"}
        description="Company details are shared across its job listings."
      >
        <form
          className="job-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="form-grid">
            {(
              [
                "name",
                "industry",
                "website",
                "careers_page_url",
                "headquarters",
                "notes",
              ] as const
            ).map((key) => (
              <label key={key}>
                {key.replaceAll("_", " ")}
                {key === "notes" ? (
                  <textarea
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                ) : (
                  <input
                    required={key === "name"}
                    value={draft[key]}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.value })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          {save.error && (
            <p role="alert" className="error">
              {save.error.message}
            </p>
          )}
          <div className="form-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={save.isPending}>
              <Save size={15} />
              {editing ? "Save changes" : "Create company"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function CompanyCard({
  company,
  onEdit,
}: {
  company: Company;
  onEdit: () => void;
}) {
  const { data, error } = useQuery({
    queryKey: ["company", company.id],
    queryFn: () => api<Company>(`/companies/${company.id}`),
  });
  return (
    <article className="company-card">
      <div className="job-card-top">
        <span className="company-icon">
          {company.name.slice(0, 2).toUpperCase()}
        </span>
        <h2>{company.name}</h2>
        <Button
          variant="ghost"
          onClick={onEdit}
          aria-label={`Edit ${company.name}`}
        >
          <Pencil size={16} />
        </Button>
      </div>
      <p>
        {company.industry || "Industry not specified"}
        <br />
        {company.headquarters || "Headquarters not specified"}
      </p>
      {company.website && validUrl(company.website) && (
        <a
          className="quick-action"
          href={company.website}
          target="_blank"
          rel="noopener noreferrer"
        >
          Company website <ArrowUpRight size={14} />
        </a>
      )}
      {error && <p role="alert">{error.message}</p>}
      <Link className="quick-action" to={`/jobs?company_id=${company.id}`}>
        {data?.jobs?.length ?? "…"} opportunities <ArrowUpRight size={14} />
      </Link>
      <details>
        <summary>Associated jobs</summary>
        {data?.jobs?.length ? (
          data.jobs.map((job) => (
            <Link
              key={job.id}
              className="company-job-link"
              to={`/${job.archived_at ? "archive" : "jobs"}?job=${job.id}`}
            >
              {job.job_title}
              {job.archived_at ? " · Archived" : ""}
            </Link>
          ))
        ) : (
          <p className="muted">No listings yet.</p>
        )}
      </details>
      {company.notes && (
        <details>
          <summary>Company notes</summary>
          <p className="pre-wrap">{company.notes}</p>
        </details>
      )}
    </article>
  );
}
