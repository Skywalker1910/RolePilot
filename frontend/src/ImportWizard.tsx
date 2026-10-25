import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleCheck,
  FileSpreadsheet,
  UploadCloud,
  ChevronLeft,
} from "lucide-react";
import {
  api,
  display,
  label,
  post,
  type Batch,
  type Decision,
  type JobInput,
  type Preview,
  type ReviewRow,
} from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import { JobForm } from "./JobForm";

export function ImportWizard() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [corrections, setCorrections] = useState<Record<number, JobInput>>({});
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheetChoices, setSheetChoices] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  function loadPreview(p: Preview) {
    setPreview(p);
    setMapping(p.mapping);
    setDirty(false);
    setDecisions(
      Object.fromEntries(
        p.rows.map((r) => [
          r.row_number,
          {
            row_number: r.row_number,
            action: r.errors.length || r.candidates.length ? "skip" : "insert",
            approve_conflicts: false,
          },
        ]),
      ),
    );
  }
  async function upload(file: File, worksheet?: string) {
    setError("");
    setBusy(true);
    try {
      if (!/\.(xlsx|csv)$/i.test(file.name))
        throw new Error("Choose an .xlsx or .csv file.");
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Maximum file size is 10 MB.");
      const body = new FormData();
      body.append("file", file);
      if (worksheet) body.append("worksheet_name", worksheet);
      loadPreview(
        await api<Preview>("/imports/preview", { method: "POST", body }),
      );
      setCorrections({});
      setBatch(null);
    } catch (e) {
      const detail = (
        e as Error & {
          body?: { worksheets?: string[]; requires_selection?: boolean };
        }
      ).body;
      if (detail?.requires_selection && detail.worksheets) {
        setPendingFile(file);
        setSheetChoices(detail.worksheets);
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review(nextCorrections = corrections) {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      loadPreview(
        await post<Preview>("/imports/" + preview.id + "/review", {
          mapping,
          corrections: nextCorrections,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function decision(row: number, patch: Partial<Decision>) {
    setDecisions((v) => ({ ...v, [row]: { ...v[row], ...patch } }));
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<Batch>("/imports/" + preview.id + "/commit", {
        decisions: Object.values(decisions),
      });
      setBatch(result);
      setConfirm(false);
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const insertCount = Object.values(decisions).filter(
    (d) => d.action === "insert",
  ).length;
  const updateCount = Object.values(decisions).filter(
    (d) => d.action === "update",
  ).length;
  const skipCount = Object.values(decisions).filter(
    (d) => d.action === "skip",
  ).length;
  const needsApproval = Object.values(decisions).some(
    (d) =>
      (d.action === "update" && (!d.approve_conflicts || !d.target_id)) ||
      (d.action === "insert" &&
        preview?.rows.find((r) => r.row_number === d.row_number)
          ?.duplicate_kind === "possible" &&
        !d.approve_conflicts),
  );
  return (
    <>
      <Link className="quick-action back-link" to="/jobs">
        <ChevronLeft size={15} />
        Opportunities
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BRING YOUR OPPORTUNITIES TOGETHER</div>
          <h1>Import job listings</h1>
          <p>Review first. Save with confidence.</p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/template.xlsx">
            <ArrowDownToLine size={16} />
            Excel template
          </a>
        </Button>
      </div>
      <div className="steps">
        {["Upload spreadsheet", "Map & review", "Save opportunities"].map(
          (step, i) => (
            <div
              className={
                batch || (preview && i <= 1) || (!preview && i === 0)
                  ? "step active"
                  : "step"
              }
              key={step}
            >
              <span>
                {batch || (preview && i === 0) ? <Check size={15} /> : i + 1}
              </span>
              {step}
              {i < 2 && <ArrowRight size={16} />}
            </div>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {batch ? (
        <section className="panel import-success">
          <CircleCheck size={52} />
          <h2>Your opportunities are ready.</h2>
          <p>{batch.filename}</p>
          <div className="summary-counts">
            <div>
              <strong>{batch.inserted}</strong>Inserted
            </div>
            <div>
              <strong>{batch.updated}</strong>Updated
            </div>
            <div>
              <strong>{batch.skipped}</strong>Skipped
            </div>
          </div>
          <p className="muted">
            {batch.rejected} skipped rows had validation errors. Original
            imported values and batch history are retained.
          </p>
          {!!batch.validation_errors?.length && (
            <Button
              variant="outline"
              onClick={() => {
                const quote = (value: string) => {
                  const safe = /^[\s]*[=+@\-\t\r]/.test(value)
                    ? "'" + value
                    : value;
                  return '"' + safe.replaceAll('"', '""') + '"';
                };
                const csv = [
                  "row,errors",
                  ...batch.validation_errors!.map(
                    (item) => `${item.row},${quote(item.errors.join("; "))}`,
                  ),
                ].join("\r\n");
                const url = URL.createObjectURL(
                  new Blob([csv], { type: "text/csv;charset=utf-8" }),
                );
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = "rolepilot-import-errors.csv";
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              <ArrowDownToLine size={16} />
              Download error report
            </Button>
          )}
          <div className="actions">
            <Button asChild>
              <Link to="/jobs">
                Open Job Explorer
                <ArrowRight size={16} />
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPreview(null);
                setBatch(null);
              }}
            >
              Import another file
            </Button>
          </div>
        </section>
      ) : !preview ? (
        <section className="panel upload-panel">
          <div
            className={dragging ? "dropzone dragging" : "dropzone"}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file && !busy) void upload(file);
            }}
          >
            <span className="upload-icon">
              <UploadCloud size={32} />
            </span>
            <h2>
              {busy
                ? "Reading your spreadsheet…"
                : "Bring your job listings here"}
            </h2>
            <p>Drag and drop your file, or choose one from your computer.</p>
            <Button disabled={busy} onClick={() => input.current?.click()}>
              <FileSpreadsheet size={16} />
              Choose spreadsheet
            </Button>
            <input
              ref={input}
              className="sr-only"
              aria-label="Upload spreadsheet"
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => {
                if (e.target.files?.[0]) void upload(e.target.files[0]);
              }}
            />
            <small>XLSX or CSV · Up to 10 MB · 2,000 rows</small>
          </div>
          {sheetChoices.length > 0 && pendingFile && (
            <div
              className="panel-padding"
              role="group"
              aria-label="Choose worksheet"
            >
              <h3>This workbook has no `jobs` worksheet</h3>
              <p>Select the sheet that contains one job per row.</p>
              <div className="actions">
                <select aria-label="Worksheet" id="worksheet-choice">
                  {sheetChoices.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const selected = (
                      document.getElementById(
                        "worksheet-choice",
                      ) as HTMLSelectElement
                    ).value;
                    void upload(pendingFile, selected);
                  }}
                >
                  Preview worksheet
                </Button>
              </div>
            </div>
          )}
          <div className="upload-notes">
            <div>
              <h3>A simple starting point</h3>
              <p>
                Include company name, job title, and the direct company careers
                URL. Everything else can be added later.
              </p>
              <a href="/api/template.xlsx?sample=true">
                Download fictional sample <ArrowDownToLine size={14} />
              </a>
            </div>
            <div>
              <h3>You stay in control</h3>
              <p>
                Map columns, fix errors, and review duplicates before any jobs
                are saved. No external websites are contacted.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="panel panel-padding">
            <div className="panel-heading flush">
              <div>
                <h2>{preview.filename}</h2>
                <p className="muted">
                  {preview.rows.length} rows · First worksheet · Required:
                  company name, job title, company job URL
                </p>
              </div>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Choose another file
              </Button>
            </div>
            <details open>
              <summary>Column mapping</summary>
              <div className="mapping-grid">
                {Object.entries(mapping).map(([column, field]) => (
                  <label key={column}>
                    <span>{column}</span>
                    <select
                      aria-label={"Map " + column}
                      value={field}
                      onChange={(e) => {
                        setMapping({ ...mapping, [column]: e.target.value });
                        setDirty(true);
                      }}
                    >
                      <option value="">Ignore (preserve original)</option>
                      {preview.fields.map((f) => (
                        <option value={f} key={f}>
                          {label(f)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void review()}
            >
              {busy ? "Validating…" : "Validate mapping & rows"}
            </Button>
            {dirty && (
              <p className="error">
                Mapping changed. Validate again before saving.
              </p>
            )}
          </section>
          <section className="panel review-panel">
            <div className="panel-heading">
              <h2>Review your rows</h2>
              <span className="muted">Duplicates default to skip</span>
            </div>
            <p className="panel-padding muted">
              Verify employer URLs and extracted facts. Possible matches are
              never merged automatically. Update replaces the full mapped job
              record, including blank fields; all changes are shown below.
            </p>
            {preview.rows.map((row) => {
              const d = decisions[row.row_number];
              const changes = row.conflicts[String(d.target_id)] || {};
              return (
                <article className="review-row" key={row.row_number}>
                  <div className="review-title">
                    <span className="row-number">{row.row_number}</span>
                    <div>
                      <strong>
                        {String(row.data.job_title || "Missing job title")}
                      </strong>
                      <p>
                        {String(row.data.company_name || "Missing company")} ·{" "}
                        {String(row.data.city || "Location not specified")}
                      </p>
                    </div>
                    <span
                      className={
                        row.errors.length
                          ? "badge bad"
                          : row.duplicate_kind
                            ? "badge warn"
                            : "badge good"
                      }
                    >
                      {row.errors.length
                        ? "Needs correction"
                        : row.duplicate_kind === "exact"
                          ? "Exact duplicate"
                          : row.duplicate_kind === "possible"
                            ? "Possible duplicate"
                            : "Ready"}
                    </span>
                    <Button variant="ghost" onClick={() => setEditing(row)}>
                      Edit row
                    </Button>
                  </div>
                  <div className="review-url">
                    {String(
                      row.data.canonical_job_url || "Missing employer URL",
                    )}
                  </div>
                  {row.errors.map((e, i) => (
                    <p className="error compact" key={i}>
                      {e}
                    </p>
                  ))}
                  <details>
                    <summary>Preview values & source warnings</summary>
                    <div className="preview-values">
                      {Object.entries(row.data)
                        .filter(
                          ([, v]) =>
                            v !== null &&
                            v !== "" &&
                            (!Array.isArray(v) || v.length),
                        )
                        .map(([k, v]) => (
                          <div key={k}>
                            <strong>{label(k)}</strong>
                            <span>{display(v)}</span>
                          </div>
                        ))}
                    </div>
                    {row.warnings.map((w, i) => (
                      <p className="muted" key={i}>
                        {w}
                      </p>
                    ))}
                    <details>
                      <summary>Original spreadsheet values</summary>
                      <pre>{JSON.stringify(row.raw, null, 2)}</pre>
                    </details>
                  </details>
                  <div className="review-actions">
                    <label>
                      Action for row {row.row_number}
                      <select
                        aria-label={"Action for row " + row.row_number}
                        value={d.action}
                        onChange={(e) =>
                          decision(row.row_number, {
                            action: e.target.value as Decision["action"],
                            target_id: row.candidates[0]?.id,
                            expected_revision: row.candidates[0]?.revision,
                            approve_conflicts: false,
                          })
                        }
                      >
                        <option value="skip">Skip row</option>
                        {!row.errors.length &&
                          row.duplicate_kind !== "exact" && (
                            <option value="insert">Insert as new job</option>
                          )}
                        {!row.errors.length && row.candidates.length > 0 && (
                          <option value="update">Update existing job</option>
                        )}
                      </select>
                    </label>
                    {d.action === "update" && (
                      <label>
                        Existing job
                        <select
                          aria-label={"Update target for row " + row.row_number}
                          value={d.target_id}
                          onChange={(e) => {
                            const target = row.candidates.find(
                              (c) => c.id === Number(e.target.value),
                            )!;
                            decision(row.row_number, {
                              target_id: target.id,
                              expected_revision: target.revision,
                              approve_conflicts: false,
                            });
                          }}
                        >
                          {row.candidates.map((c) => (
                            <option value={c.id} key={c.id}>
                              #{c.id} · {c.company_name} · {c.job_title}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  {d.action === "update" && (
                    <div className="conflicts">
                      <h4>Review replacements</h4>
                      {Object.keys(changes).length ? (
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Field</th>
                                <th>Current value</th>
                                <th>Incoming value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(changes).map(
                                ([field, change]) => (
                                  <tr key={field}>
                                    <td>
                                      {label(field)}
                                      {change.locally_edited && (
                                        <span className="badge warn">
                                          Locally edited
                                        </span>
                                      )}
                                    </td>
                                    <td>{display(change.current)}</td>
                                    <td>{display(change.incoming)}</td>
                                  </tr>
                                ),
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p>No field differences.</p>
                      )}
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={d.approve_conflicts}
                          onChange={(e) =>
                            decision(row.row_number, {
                              approve_conflicts: e.target.checked,
                            })
                          }
                        />
                        I approve these replacements, including any locally
                        edited fields and incoming blanks.
                      </label>
                    </div>
                  )}
                  {d.action === "insert" &&
                    row.duplicate_kind === "possible" && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={d.approve_conflicts}
                          onChange={(e) =>
                            decision(row.row_number, {
                              approve_conflicts: e.target.checked,
                            })
                          }
                        />
                        I verified this is a separate opportunity.
                      </label>
                    )}
                </article>
              );
            })}
            <div className="import-footer">
              <span>
                <strong>{insertCount}</strong> insert ·{" "}
                <strong>{updateCount}</strong> update ·{" "}
                <strong>{skipCount}</strong> skip
              </span>
              <Button
                disabled={busy || dirty || needsApproval}
                onClick={() => setConfirm(true)}
              >
                Review & save
                <ArrowRight size={16} />
              </Button>
            </div>
          </section>
        </>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={"Correct row " + editing?.row_number}
        description="Corrections change the normalized values; the original spreadsheet row remains preserved."
      >
        {editing && (
          <JobForm
            key={editing.row_number}
            initial={editing.data}
            submitLabel="Validate corrected row"
            onSave={async (data) => {
              const next = { ...corrections, [editing.row_number]: data };
              setCorrections(next);
              await review(next);
              setEditing(null);
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Save this import?"
        description="All selected changes will be saved together in one database transaction."
      >
        <p>
          {insertCount} new jobs, {updateCount} updates, and {skipCount} skipped
          rows.
        </p>
        <div className="actions">
          <Button variant="outline" onClick={() => setConfirm(false)}>
            Back to review
          </Button>
          <Button disabled={busy} onClick={() => void commit()}>
            {busy ? "Saving…" : "Confirm import"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
