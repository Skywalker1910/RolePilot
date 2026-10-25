import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Search,
  Save,
} from "lucide-react";
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
  active_job_count?: number;
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
        <label className="company-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search companies"
            placeholder="Search companies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">{visible?.length ?? 0} employers</span>
      </div>
      {isPending ? (
        <LoadingSkeleton label="Loading companies" />
      ) : visible?.length ? (
        <div className="company-table-wrap">
          <table className="company-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Industry</th>
                <th scope="col">Headquarters</th>
                <th scope="col">Website</th>
                <th scope="col">Careers</th>
                <th scope="col">Open jobs</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((company) => (
                <tr key={company.id}>
                  <td>
                    <span className="company-table-name">
                      <span className="company-icon"><Building2 size={16} /></span>
                      <span><strong>{company.name}</strong><small>{company.careers_page_url ? "Careers page available" : "Employer record"}</small></span>
                    </span>
                  </td>
                  <td>{company.industry ? <IndustryTag industry={company.industry} /> : <span className="muted">Not set</span>}</td>
                  <td><span className="company-table-location"><MapPin size={14} />{company.headquarters || "Not specified"}</span></td>
                  <td>
                    {company.website && validUrl(company.website) ? (
                      <a className="company-domain" href={company.website} target="_blank" rel="noopener noreferrer">
                        {domain(company.website)}<ExternalLink size={12} />
                      </a>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    {company.careers_page_url && validUrl(company.careers_page_url) ? (
                      <a className="company-careers-link" href={company.careers_page_url} target="_blank" rel="noopener noreferrer">View careers <ArrowUpRight size={12} /></a>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td><Link className="company-job-count" to={`/jobs?company_id=${company.id}`}><BriefcaseBusiness size={14} />{company.active_job_count ?? 0}</Link></td>
                  <td><Button variant="ghost" onClick={() => {
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
                  }} aria-label={`Edit ${company.name}`}><Pencil size={15} /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="company-table-footer"><span>{visible.length} companies</span><span>Open jobs across your saved opportunities</span></div>
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

function domain(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ""); }
  catch { return value; }
}

function IndustryTag({ industry }: { industry: string }) {
  const normalized = industry.toLowerCase();
  const tone = /software|technology|saas|cyber|ai|cloud/.test(normalized) ? "blue"
    : /finance|bank|insurance|investment/.test(normalized) ? "amber"
      : /health|medical|biotech|pharma/.test(normalized) ? "green"
        : /education|university|research/.test(normalized) ? "purple"
          : /government|public|nonprofit/.test(normalized) ? "slate" : "teal";
  return (
    <span className={`industry-tag tone-${tone}`}>{industry}</span>
  );
}
