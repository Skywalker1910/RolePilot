import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  BriefcaseBusiness,
  Building2,
  FileText,
  LayoutDashboard,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { api, type Job } from "../api";
import { Dialog } from "./ui/dialog";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const navigate = useNavigate();
  const jobs = useQuery({
    queryKey: ["command-jobs", q],
    queryFn: () =>
      api<{ items: Job[] }>(`/jobs?q=${encodeURIComponent(q)}&page_size=5`),
    enabled: open && q.length > 1,
  });
  function go(to: string) {
    onOpenChange(false);
    setSearch("");
    navigate(to);
  }
  const actions = [
    { title: "Overview", to: "/", icon: LayoutDashboard },
    { title: "Opportunities", to: "/jobs", icon: BriefcaseBusiness },
    { title: "Applications", to: "/applications", icon: BriefcaseBusiness },
    { title: "Companies", to: "/companies", icon: Building2 },
    { title: "Import jobs", to: "/imports", icon: ArrowDownToLine },
    { title: "Add application", to: "/applications?create=true", icon: Plus },
    { title: "Documents", to: "/documents", icon: FileText },
    { title: "Settings", to: "/settings", icon: Settings },
  ].filter((action) => action.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search & quick actions"
      description="Find opportunities by role, company or skill, or jump to a page."
    >
      <label className="search-input command-search">
        <Search size={17} />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your workspace…"
          aria-label="Search workspace"
        />
      </label>
      <div className="command-results">
        {actions.map(({ title, to, icon: Icon }) => (
          <button key={title} onClick={() => go(to)}>
            <Icon size={17} />
            <span>{title}</span>
          </button>
        ))}
        {q.length > 1 && (
          <>
            <h3>Matching opportunities</h3>
            {jobs.isPending ? (
              <p role="status">Searching…</p>
            ) : jobs.error ? (
              <p role="alert">{jobs.error.message}</p>
            ) : jobs.data?.items.length ? (
              jobs.data.items.map((job) => (
                <button key={job.id} onClick={() => go(`/jobs?job=${job.id}`)}>
                  <Building2 size={17} />
                  <span>
                    {job.job_title}
                    <small>{job.company_name}</small>
                  </span>
                </button>
              ))
            ) : (
              <p className="muted">No matching opportunities.</p>
            )}
            <button onClick={() => go(`/jobs?q=${encodeURIComponent(q)}`)}>
              <Search size={17} />
              See all search results
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
