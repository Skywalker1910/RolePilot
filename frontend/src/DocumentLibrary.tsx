import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, RefreshCw, LayoutGrid, List } from "lucide-react";
import { api, date, post } from "./api";
import { Button } from "./components/ui/button";
import { StatusBadge, LoadingSkeleton } from "./components/presentation";
import { Dialog } from "./components/ui/dialog";

type Issue = { path: string; message: string };
export type Library = {
  id: number;
  root_path: string;
  revision: number;
  available: boolean;
  availability_error: string | null;
  last_scan_at: string | null;
  last_error: string | null;
  scan_summary: {
    new?: number;
    modified?: number;
    missing?: number;
    ignored?: number;
    folders?: string[];
    issues?: Issue[];
    move_candidates?: {
      document_id: number;
      old_path: string;
      candidate_paths: string[];
    }[];
  };
};
type RootReport = {
  root_path: string;
  matched: number;
  changed: number;
  missing: number;
  unreadable: number;
  requires_approval: boolean;
  issues: Issue[];
};
export type LibraryDocument = {
  id: number;
  relative_path: string;
  filename: string;
  parent_folder: string;
  document_type: string;
  format: string;
  version_label: string | null;
  folder_hint: string | null;
  status: string;
  modified_at: string;
  indexed_at: string;
  last_verified_at: string;
  file_created_at: string | null;
  file_size: number;
  file_hash: string;
  is_missing: boolean;
  verification_error: string | null;
  revision: number;
  company_id: number | null;
  job_id: number | null;
  role_label: string | null;
  notes: string | null;
};
const categories = [
  "Resume",
  "Cover Letter",
  "Template",
  "Supporting Document",
  "Other",
];
const statuses = [
  "Unreviewed",
  "Master",
  "Draft",
  "General",
  "Tailored",
  "Final",
  "Archived",
];
export function LibrarySettings() {
  const client = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ["document-library"],
    queryFn: () => api<Library>("/document-library"),
  });
  const [root, setRoot] = useState<string | null>(null);
  const [report, setReport] = useState<RootReport | null>(null);
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const validate = useMutation({
    mutationFn: () =>
      post<RootReport>("/document-library/validate", {
        root_path: root ?? data?.root_path,
      }),
    onSuccess: (r) => {
      setReport(r);
      setApproved(false);
      setMessage("");
    },
  });
  const save = useMutation({
    mutationFn: () =>
      api<Library>("/document-library", {
        method: "PUT",
        body: JSON.stringify({
          root_path: report?.root_path,
          expected_revision: data?.revision,
          accept_unverified: approved,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["document-library"] });
      await client.invalidateQueries({ queryKey: ["documents"] });
      setReport(null);
      setRoot(null);
      setMessage(
        "Library reconnected and indexed. Existing source files were not changed.",
      );
    },
  });
  return (
    <section className="panel panel-padding roadmap">
      <h2>Document library</h2>
      <p className="muted">
        Use your existing local folder. RolePilot scans Resumes/ and
        cover_letters/ only. Changing the root reconnects the same document IDs
        by relative path; it does not move or copy files.
      </p>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      {data && !data.available && (
        <p className="error" role="alert">
          Library unavailable: {data.availability_error}
        </p>
      )}
      <label>
        Library root
        <input
          value={root ?? data?.root_path ?? ""}
          onChange={(e) => {
            setRoot(e.target.value);
            setReport(null);
            setApproved(false);
          }}
          disabled={validate.isPending || save.isPending}
          placeholder="Absolute local library folder"
        />
      </label>
      <p className="muted">
        Paste an absolute Windows folder path. This browser cannot provide a
        trusted desktop directory path through a file upload picker.
      </p>
      <div className="actions">
        <Button
          variant="outline"
          disabled={!data || validate.isPending || save.isPending}
          onClick={() => validate.mutate()}
        >
          {validate.isPending
            ? "Checking files…"
            : "Validate folder & references"}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/documents">View document inventory</Link>
        </Button>
      </div>
      {(validate.error || save.error) && (
        <p className="error" role="alert">
          {(validate.error || save.error)?.message}
        </p>
      )}
      {report && (
        <div className="library-report">
          <h3>Reference check</h3>
          <p>
            {report.matched} matching · {report.changed} changed ·{" "}
            {report.missing} missing · {report.unreadable} unreadable
          </p>
          <p className="muted">Checked: {report.root_path}</p>
          {report.issues.length > 0 && (
            <details>
              <summary>Review differences</summary>
              {report.issues.map((i, index) => (
                <p key={index}>
                  {i.path}: {i.message}
                </p>
              ))}
            </details>
          )}
          {report.requires_approval && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed the differences and want to reconnect. Missing records
              will be retained.
            </label>
          )}
          <Button
            disabled={save.isPending || (report.requires_approval && !approved)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Reconnecting…" : "Save root & index"}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
    </section>
  );
}
export function DocumentLibrary() {
  const [view, setView] = useState(() =>
    localStorage.getItem("rolepilot-document-view") === "table"
      ? "table"
      : "cards",
  );
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [folder, setFolder] = useState("");
  const [format, setFormat] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<LibraryDocument | null>(null);
  const { data: library, error: libraryError } = useQuery({
    queryKey: ["document-library"],
    queryFn: () => api<Library>("/document-library"),
  });
  const query = new URLSearchParams({
    q,
    category,
    folder,
    format,
    page: String(page),
  });
  const { data, error, isPending } = useQuery({
    queryKey: ["documents", query.toString()],
    queryFn: () =>
      api<{ items: LibraryDocument[]; total: number }>("/documents?" + query),
  });
  const scan = useMutation({
    mutationFn: () => post<Library>("/document-library/scan", {}),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["documents"] });
      await client.invalidateQueries({ queryKey: ["document-library"] });
    },
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR EXISTING FILES, CONNECTED</div>
          <h1>
            Document Studio{" "}
            <span className="count-badge">{data?.total ?? "—"}</span>
          </h1>
          <p>Your resumes and cover letters, organized by version.</p>
        </div>
        <div className="actions">
          <Button asChild variant="outline">
            <Link to="/settings">Library settings</Link>
          </Button>
          <Button disabled={scan.isPending} onClick={() => scan.mutate()}>
            <RefreshCw size={16} />
            {scan.isPending ? "Scanning…" : "Refresh library"}
          </Button>
        </div>
      </div>
      <details className="panel library-summary">
        <summary>
          <FileText size={17} />
          Connected folder ·{" "}
          {library?.available ? "Available" : "Check connection"}
        </summary>
        <div className="library-summary-content">
          <p className="break-all">{library?.root_path ?? "Loading…"}</p>
          <p className="muted">
            Last completed scan: {date(library?.last_scan_at)}. Formats: PDF,
            DOCX, DOC, TXT, Markdown, LaTeX. Source/config directories and build
            artifacts are excluded.
          </p>
          {(libraryError || error || scan.error) && (
            <p role="alert" className="error">
              {(libraryError || error || scan.error)?.message}
            </p>
          )}
          {library && (!library.available || library.last_error) && (
            <p className="error" role="alert">
              {library.availability_error || library.last_error}. Previously
              indexed records are retained.
            </p>
          )}
          {library?.scan_summary && (
            <p className="muted">
              Last scan: {library.scan_summary.new ?? 0} new ·{" "}
              {library.scan_summary.modified ?? 0} changed ·{" "}
              {library.scan_summary.missing ?? 0} missing ·{" "}
              {library.scan_summary.ignored ?? 0} ignored.
            </p>
          )}
          {!!library?.scan_summary.issues?.length && (
            <details>
              <summary>Scan warnings</summary>
              {library.scan_summary.issues.map((i, index) => (
                <p className="muted" key={index}>
                  {i.path}: {i.message}
                </p>
              ))}
            </details>
          )}
          {!!library?.scan_summary.move_candidates?.length && (
            <details>
              <summary>
                Possible renamed or moved files — review required
              </summary>
              <p className="muted">
                No identities have been merged. Reconciliation controls will be
                added with synchronization improvements.
              </p>
              {library.scan_summary.move_candidates.map((c) => (
                <p className="muted" key={c.document_id}>
                  #{c.document_id} {c.old_path} → {c.candidate_paths.join(", ")}
                </p>
              ))}
            </details>
          )}
        </div>
      </details>
      {(libraryError ||
        error ||
        scan.error ||
        library?.last_error ||
        (library && !library.available)) && (
        <p role="alert" className="error">
          {libraryError?.message ||
            error?.message ||
            scan.error?.message ||
            library?.last_error ||
            library?.availability_error}{" "}
          · Indexed records are retained.
        </p>
      )}
      <section className="panel roadmap">
        <div
          className="document-tabs segmented-control"
          aria-label="Document collections"
        >
          {[
            ["", "All documents"],
            ["Resume", "Resumes"],
            ["Cover Letter", "Cover letters"],
          ].map(([value, title]) => (
            <button
              key={value}
              aria-pressed={category === value}
              onClick={() => {
                setCategory(value);
                setPage(1);
              }}
            >
              {title}
            </button>
          ))}
        </div>
        <div className="filter-bar">
          <label className="search-input">
            <input
              aria-label="Search documents"
              placeholder="Search filename, path, mapped company or role…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="Document category"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Document folder"
            value={folder}
            onChange={(e) => {
              setFolder(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All folders</option>
            {library?.scan_summary.folders?.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <select
            aria-label="File format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All formats</option>
            {["pdf", "docx", "doc", "txt", "md", "markdown", "tex"].map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </div>
        <div className="filter-bar">
          <div className="segmented-control" aria-label="Document layout">
            <button
              aria-pressed={view === "cards"}
              onClick={() => {
                setView("cards");
                localStorage.setItem("rolepilot-document-view", "cards");
              }}
            >
              <LayoutGrid size={15} />
              Card view
            </button>
            <button
              aria-pressed={view === "table"}
              onClick={() => {
                setView("table");
                localStorage.setItem("rolepilot-document-view", "table");
              }}
            >
              <List size={15} />
              Table view
            </button>
          </div>
        </div>
        {isPending ? (
          <LoadingSkeleton label="Loading document metadata" />
        ) : data?.items.length ? (
          view === "cards" ? (
            <div className="document-grid">
              {data.items.map((d) => (
                <article className="document-card" key={d.id}>
                  <div className="document-card-header">
                    <FileText size={24} />
                    <span className="badge">
                      {d.format.toUpperCase()} · {Math.ceil(d.file_size / 1024)}{" "}
                      KB
                    </span>
                  </div>
                  <button className="job-title" onClick={() => setSelected(d)}>
                    <strong>{d.filename}</strong>
                    <span>{d.relative_path}</span>
                  </button>
                  <span className="document-version">
                    {d.version_label || "No version label"}
                  </span>
                  <div className="chips">
                    <StatusBadge status={d.status} />
                    <StatusBadge
                      status={
                        d.is_missing
                          ? "Missing"
                          : d.verification_error
                            ? "Unverified"
                            : "Indexed"
                      }
                    />
                  </div>
                  <small>
                    {d.document_type} · Modified {date(d.modified_at)}
                  </small>
                  {d.role_label && <small>Role: {d.role_label}</small>}
                  {d.job_id && (
                    <Link className="quick-action" to={`/jobs?job=${d.job_id}`}>
                      Related opportunity #{d.job_id}
                    </Link>
                  )}
                  <Button variant="outline" onClick={() => setSelected(d)}>
                    Review metadata
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Document / path</th>
                    <th>Category</th>
                    <th>Version / folder hint</th>
                    <th>Status</th>
                    <th>Modified</th>
                    <th>Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <button
                          className="job-title"
                          onClick={() => setSelected(d)}
                        >
                          <strong>{d.filename}</strong>
                          <span>{d.relative_path}</span>
                        </button>
                        <small className="cell-sub">
                          {d.format.toUpperCase()} ·{" "}
                          {Math.ceil(d.file_size / 1024)} KB · ID {d.id}
                        </small>
                      </td>
                      <td>{d.document_type}</td>
                      <td>
                        {d.version_label || "Not specified"}
                        <small className="cell-sub">
                          {d.folder_hint || "No folder hint"}
                        </small>
                      </td>
                      <td>{d.status}</td>
                      <td>{date(d.modified_at)}</td>
                      <td>
                        <span
                          className={
                            d.is_missing || d.verification_error
                              ? "badge warn"
                              : "badge good"
                          }
                        >
                          {d.is_missing
                            ? "Missing"
                            : d.verification_error
                              ? "Unverified"
                              : "Indexed"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div className="empty">
            <FileText size={32} />
            <h3>No indexed documents match</h3>
            <p>Check the configured root or change your filters.</p>
          </div>
        )}
        <div className="pagination">
          <span>
            {data?.total ?? 0} documents · newest modified first · 50 per page
          </span>
          <div>
            <Button
              variant="ghost"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="ghost"
              disabled={page * 50 >= (data?.total ?? 0)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
      <p className="privacy-note">
        Categories are suggestions. Folder hints are not verified company
        mappings. Previews, desktop opening, application links and protected
        submission snapshots come in the next phases.
      </p>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="Document metadata"
        description="Edits update RolePilot's index only. The source file is never renamed or modified."
      >
        {selected && (
          <MetadataEditor
            key={selected.id}
            document={selected}
            onSaved={async () => {
              setSelected(null);
              await client.invalidateQueries({ queryKey: ["documents"] });
            }}
          />
        )}
      </Dialog>
    </>
  );
}
function MetadataEditor({
  document: d,
  onSaved,
}: {
  document: LibraryDocument;
  onSaved: () => Promise<void>;
}) {
  const [category, setCategory] = useState(d.document_type);
  const [status, setStatus] = useState(d.status);
  const [version, setVersion] = useState(d.version_label || "");
  const [role, setRole] = useState(d.role_label || "");
  const [notes, setNotes] = useState(d.notes || "");
  const [company, setCompany] = useState(
    d.company_id ? String(d.company_id) : "",
  );
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: () => api<{ id: number; name: string }[]>("/companies"),
  });
  const save = useMutation({
    mutationFn: () =>
      api("/documents/" + d.id + "/metadata", {
        method: "PUT",
        body: JSON.stringify({
          expected_revision: d.revision,
          document_type: category,
          status,
          version_label: version || null,
          company_id: company ? Number(company) : null,
          job_id: d.job_id,
          role_label: role || null,
          notes: notes || null,
        }),
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="job-form"
    >
      <p className="break-all">{d.relative_path}</p>
      <div className="form-grid">
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Document status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {statuses.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Version label
          <input value={version} onChange={(e) => setVersion(e.target.value)} />
        </label>
        <label>
          Verified company mapping
          <select value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">Not mapped</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role label
          <input value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      <p className="muted">
        Master is only set by your choice. Submitted status is reserved for the
        future confirmed-submission workflow. A folder name alone does not
        establish company, role or submission facts.
      </p>
      <details>
        <summary>File verification metadata</summary>
        <p className="break-all">SHA-256: {d.file_hash}</p>
        <p>Created: {date(d.file_created_at)}</p>
        <p>Indexed: {date(d.indexed_at)}</p>
        <p>Last verified: {date(d.last_verified_at)}</p>
        <p className="muted">
          Checksum history is not a file snapshot. Earlier bytes cannot be
          recovered from this index.
        </p>
      </details>
      {save.error && (
        <p role="alert" className="error">
          {save.error.message}
        </p>
      )}
      <div className="form-footer">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save metadata"}
        </Button>
      </div>
    </form>
  );
}
