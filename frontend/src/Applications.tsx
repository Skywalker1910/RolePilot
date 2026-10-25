import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BriefcaseBusiness,
  CalendarClock,
  Check,
  ChevronRight,
  Plus,
  RotateCcw,
  List,
  Columns3,
  Clock3,
} from "lucide-react";
import { api, date, display, post, type Job } from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import {
  ActivityTimeline,
  LoadingSkeleton,
  StatusBadge,
} from "./components/presentation";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorPanel } from "./App";

export const APPLICATION_STATUSES = [
  "Discovered",
  "Shortlisted",
  "Not Interested",
  "Pending Application",
  "Applied",
  "Under Review",
  "Recruiter Screening",
  "Hiring Manager Screening",
  "Assessment",
  "Technical Interview",
  "System Design Interview",
  "Behavioral Interview",
  "Final Interview",
  "On Hold",
  "Offer Received",
  "Offer Accepted",
  "Offer Declined",
  "Rejected",
  "Withdrawn",
  "Position Closed",
  "No Response",
];
const GROUPS: Record<string, string[]> = {
  Discovery: ["Discovered", "Shortlisted", "Not Interested"],
  "To Apply": ["Pending Application", "Applied"],
  "In Process": [
    "Under Review",
    "Recruiter Screening",
    "Hiring Manager Screening",
    "Assessment",
    "Technical Interview",
    "System Design Interview",
    "Behavioral Interview",
    "Final Interview",
    "On Hold",
  ],
  Offers: ["Offer Received", "Offer Accepted", "Offer Declined"],
  Closed: ["Rejected", "Withdrawn", "Position Closed", "No Response"],
};
type History = {
  id: number;
  previous_status: string | null;
  new_status: string;
  changed_at: string;
  source: string;
  notes: string | null;
};
type Task = {
  id: number;
  title: string;
  task_type: string;
  due_at: string;
  completed_at: string | null;
};
type Application = {
  id: number;
  job_id: number;
  job: Job;
  current_status: string;
  custom_stage_label: string | null;
  priority: number;
  applied_at: string | null;
  next_follow_up_at: string | null;
  desired_salary: number | null;
  desired_salary_currency: string | null;
  referral_status: string | null;
  notes: string | null;
  archived_at: string | null;
  pending_confirmation: boolean;
  confirmation_remind_at: string | null;
  revision: number;
  history: History[];
  tasks: Task[];
};
type ApplicationPage = { items: Application[]; total: number };

export function Applications() {
  const [params, setParams] = useSearchParams();
  const [board, setBoard] = useState(
    () => localStorage.getItem("rolepilot-application-view") === "board",
  );
  const creating = params.get("create") === "true";
  function setCreating(value: boolean) {
    const next = new URLSearchParams(params);
    if (value) next.set("create", "true");
    else next.delete("create");
    setParams(next);
  }
  const [selected, setSelected] = useState<Application | null>(null);
  const [errorNotice, setErrorNotice] = useState("");
  const client = useQueryClient();
  const archived = params.get("archived") === "true";
  const page = Number(params.get("page") || 1);
  const query = new URLSearchParams({
    page_size: "25",
    page: String(page),
    archived: String(archived),
  });
  if (params.get("status")) query.set("status", params.get("status")!);
  if (params.get("q")) query.set("q", params.get("q")!);
  const { data, error, isPending } = useQuery({
    queryKey: ["applications", query.toString()],
    queryFn: () => api<ApplicationPage>(`/applications?${query}`),
  });
  const details = useQuery({
    queryKey: ["application", params.get("selected")],
    queryFn: () => api<Application>(`/applications/${params.get("selected")}`),
    enabled: !!params.get("selected"),
  });
  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      post(`/applications/${id}/status`, { new_status: status }),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
    onError: (e) => setErrorNotice(e.message),
  });
  const rows = data?.items || [];
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(GROUPS).map(([name, statuses]) => [
          name,
          rows.filter((a) => statuses.includes(a.current_status)),
        ]),
      ),
    [rows],
  );
  function selectApp(app: Application) {
    setSelected(app);
    const next = new URLSearchParams(params);
    next.set("selected", String(app.id));
    setParams(next);
  }
  function closeDetails() {
    setSelected(null);
    const next = new URLSearchParams(params);
    next.delete("selected");
    setParams(next);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">HIRING PIPELINE</div>
          <h1>
            Applications{" "}
            <span className="count-badge">{data?.total ?? "—"}</span>
          </h1>
          <p>Every pursuit, next step and milestone in one place.</p>
        </div>
        <div className="actions">
          <div className="segmented-control" aria-label="Application layout">
            <button
              aria-pressed={board}
              onClick={() => {
                setBoard(true);
                localStorage.setItem("rolepilot-application-view", "board");
              }}
            >
              <Columns3 size={15} />
              Kanban view
            </button>
            <button
              aria-pressed={!board}
              onClick={() => {
                setBoard(false);
                localStorage.setItem("rolepilot-application-view", "table");
              }}
            >
              <List size={15} />
              Table view
            </button>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            Record past application
          </Button>
        </div>
      </div>
      {errorNotice && (
        <p role="alert" className="error">
          {errorNotice}
          <button onClick={() => setErrorNotice("")}>Dismiss</button>
        </p>
      )}
      <section className="panel">
        <div className="filter-bar">
          <input
            aria-label="Search applications"
            placeholder="Search company, role, requisition…"
            value={params.get("q") || ""}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set("q", e.target.value);
              else next.delete("q");
              next.delete("page");
              setParams(next);
            }}
          />
          <select
            aria-label="Filter application stage"
            value={params.get("status") || ""}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.delete("page");
              if (e.target.value) next.set("status", e.target.value);
              else next.delete("status");
              setParams(next);
            }}
          >
            <option value="">All stages</option>
            {APPLICATION_STATUSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
          <label className="check-label">
            <input
              type="checkbox"
              checked={archived}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.checked) next.set("archived", "true");
                else next.delete("archived");
                next.delete("page");
                setParams(next);
              }}
            />
            {archived ? "Archived applications" : "Active applications"}
          </label>
        </div>
        {error ? (
          <ErrorPanel error={error} />
        ) : isPending ? (
          <LoadingSkeleton label="Loading applications" />
        ) : !rows.length ? (
          <div className="empty">
            <BriefcaseBusiness size={38} />
            <h3>
              {archived
                ? "No archived applications"
                : "Your hiring pipeline is empty"}
            </h3>
            <p>
              Use Apply from a job detail, or record an application you
              submitted earlier.
            </p>
          </div>
        ) : board ? (
          <div className="pipeline-board">
            {Object.entries(grouped).map(([group, items]) => (
              <section className="pipeline-lane" key={group}>
                <div className="panel-heading">
                  <h2>{group}</h2>
                  <span className="count-badge">{items.length}</span>
                </div>
                {items.map((app) => (
                  <ApplicationCard
                    key={app.id}
                    app={app}
                    onSelect={() => selectApp(app)}
                    onStatus={(status) =>
                      changeStatus.mutate({ id: app.id, status })
                    }
                  />
                ))}
              </section>
            ))}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Company / role</th>
                  <th>Official ID</th>
                  <th>Status</th>
                  <th>Applied</th>
                  <th>Priority</th>
                  <th>Follow up</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <button
                        className="job-title"
                        onClick={() => selectApp(app)}
                      >
                        <strong>{app.job.job_title}</strong>
                        <span>{app.job.company_name}</span>
                      </button>
                    </td>
                    <td className="mono">{app.job.company_job_id || "—"}</td>
                    <td>
                      <StatusSelect
                        value={app.current_status}
                        onChange={(status) =>
                          changeStatus.mutate({ id: app.id, status })
                        }
                      />
                      {app.pending_confirmation && (
                        <span className="badge warn">Needs confirmation</span>
                      )}
                    </td>
                    <td>{date(app.applied_at)}</td>
                    <td>{app.priority}/5</td>
                    <td>{date(app.next_follow_up_at)}</td>
                    <td>
                      <Button variant="ghost" onClick={() => selectApp(app)}>
                        Details <ChevronRight size={15} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>
            {data?.total ?? 0} applications · 25 per page
            {board ? " · Lanes show this page" : ""}
          </span>
          <div>
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("page", String(page - 1));
                setParams(next);
              }}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="ghost"
              disabled={page * 25 >= (data?.total || 0)}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("page", String(page + 1));
                setParams(next);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      </section>
      {details.error && <ErrorPanel error={details.error} />}
      <p className="muted">
        Submitted counts use applications with an Applied timestamp. Rejected
        applications are archived automatically and remain available in the
        archive.
      </p>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Record a past application"
        description="Create a personal application record without changing the job listing."
      >
        <ManualApplicationForm
          onDone={async () => {
            setCreating(false);
            await client.invalidateQueries();
          }}
        />
      </Dialog>
      {(selected || details.data) && (
        <ApplicationDetails
          key={String(params.get("selected"))}
          app={details.data || selected!}
          onClose={closeDetails}
          onChanged={() => {
            void client.invalidateQueries();
            void details.refetch();
          }}
        />
      )}
    </>
  );
}

function StatusSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (status: string) => void;
}) {
  return (
    <select
      aria-label="Application status"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {APPLICATION_STATUSES.map((status) => (
        <option key={status}>{status}</option>
      ))}
    </select>
  );
}

function ApplicationCard({
  app,
  onSelect,
  onStatus,
}: {
  app: Application;
  onSelect: () => void;
  onStatus: (status: string) => void;
}) {
  const nextTask = app.tasks
    .filter((task) => !task.completed_at)
    .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  return (
    <article className="application-card">
      <span className="badge priority">
        {app.priority === 1
          ? "High priority"
          : app.priority >= 4
            ? "Low priority"
            : "Normal priority"}{" "}
        · {app.priority}/5
      </span>
      <button className="job-title" onClick={onSelect}>
        <strong>{app.job.job_title}</strong>
        <span>{app.job.company_name}</span>
      </button>
      <StatusBadge status={app.current_status} />
      <span className="application-card-meta">
        <CalendarClock size={13} />
        Applied{" "}
        {app.applied_at
          ? new Date(app.applied_at).toLocaleDateString()
          : "date not recorded"}
      </span>
      <span className="application-card-meta">
        <Clock3 size={13} />
        {nextTask
          ? nextTask.title
          : app.next_follow_up_at
            ? `Follow up ${new Date(app.next_follow_up_at).toLocaleDateString()}`
            : "No next action scheduled"}
      </span>
      <StatusSelect value={app.current_status} onChange={onStatus} />
      {app.pending_confirmation && (
        <p className="badge warn">Confirm whether you applied</p>
      )}
      <Button variant="ghost" onClick={onSelect}>
        Details <ChevronRight size={14} />
      </Button>
    </article>
  );
}

function ManualApplicationForm({ onDone }: { onDone: () => void }) {
  const [search, setSearch] = useState("");
  const { data, error: searchError, isPending } = useQuery({
    queryKey: ["jobs", "application-picker", search],
    queryFn: () => api<{ items: Job[]; total: number }>(`/jobs?page_size=25&sort=newest&q=${encodeURIComponent(search)}`),
  });
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState("Applied");
  const [appliedAt, setAppliedAt] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    try {
      await post("/applications/manual", {
        job_id: Number(jobId),
        current_status: status,
        applied_at: appliedAt ? new Date(appliedAt).toISOString() : null,
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="detail-section">
      <label>Find an opportunity<input type="search" value={search} placeholder="Search title, company or requisition…" onChange={e => { setSearch(e.target.value); setJobId(""); }} /></label>
      {isPending && <p role="status">Searching opportunities…</p>}
      {searchError && <p className="error" role="alert">{searchError.message}</p>}
      {data && data.total > 25 && <p className="muted">Showing the first 25 matches. Refine the search to find another listing.</p>}
      <label>
        Job
        <select
          aria-label="Select job"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        >
          <option value="">Choose a job</option>
          {data?.items.map((job) => (
            <option value={job.id} key={job.id}>
              {job.company_name} · {job.job_title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Current stage
        <StatusSelect value={status} onChange={setStatus} />
      </label>
      <label>
        Submission date (optional)
        <input
          aria-label="Submission date"
          type="datetime-local"
          value={appliedAt}
          onChange={(e) => setAppliedAt(e.target.value)}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={!jobId} onClick={() => void submit()}>
        Save application
      </Button>
    </div>
  );
}

function ApplicationDetails({
  app,
  onClose,
  onChanged,
}: {
  app: Application;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [saved, setSaved] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [notes, setNotes] = useState(app.notes || "");
  const [followup, setFollowup] = useState(
    app.next_follow_up_at?.slice(0, 16) || "",
  );
  const [priority, setPriority] = useState(String(app.priority));
  const [referralStatus, setReferralStatus] = useState(
    app.referral_status || "",
  );
  const [desiredSalary, setDesiredSalary] = useState(
    app.desired_salary?.toString() || "",
  );
  const [error, setError] = useState("");
  const client = useQueryClient();
  const { data: fresh } = useQuery({
    queryKey: ["application", app.id],
    queryFn: () => api<Application>(`/applications/${app.id}`),
  });
  const current = fresh || app;
  async function save() {
    try {
      await api(`/applications/${current.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: current.revision,
          notes,
          next_follow_up_at: followup ? new Date(followup).toISOString() : null,
          priority: Number(priority),
          referral_status: referralStatus || null,
          desired_salary: desiredSalary ? Number(desiredSalary) : null,
        }),
      });
      onChanged();
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addTask() {
    try {
      await post(`/applications/${current.id}/tasks`, {
        title: taskTitle,
        due_at: taskDue ? new Date(taskDue).toISOString() : "",
      });
      setTaskTitle("");
      onChanged();
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function toggleTask(task: Task) {
    try {
      await api(
        `/applications/${current.id}/tasks/${task.id}?completed=${!task.completed_at}`,
        { method: "PATCH" },
      );
      await client.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function archive() {
    try {
      await post(`/applications/${current.id}/archive`, {
        archived: !current.archived_at,
        expected_revision: current.revision,
      });
      onChanged();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={current.job.job_title}
      description={`${current.job.company_name} · ${current.custom_stage_label || current.current_status}`}
      drawer
    >
      <div className="drawer-actions">
        <Button asChild variant="outline">
          <a
            href={current.job.canonical_job_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Employer posting
          </a>
        </Button>
        <Button variant="ghost" onClick={() => setConfirmArchive(true)}>
          {current.archived_at ? (
            <RotateCcw size={15} />
          ) : (
            <Archive size={15} />
          )}{" "}
          {current.archived_at ? "Restore" : "Archive"}
        </Button>
      </div>
      {saved && (
        <p role="status" className="notice">
          Application details saved.
        </p>
      )}
      <div className="detail-section">
        <h3>Stage & history</h3>
        <StatusSelect
          value={current.current_status}
          onChange={(status) =>
            void post(`/applications/${current.id}/status`, {
              new_status: status,
            })
              .then(onChanged)
              .catch((e) => setError(e.message))
          }
        />
        <ActivityTimeline
          events={current.history.map((item) => ({
            id: item.id,
            status: item.new_status,
            title: item.previous_status
              ? `From ${item.previous_status}`
              : "Application created",
            at: item.changed_at,
            notes: item.notes,
          }))}
        />
      </div>
      <div className="detail-section">
        <h3>Follow-up & notes</h3>
        <label>
          Next follow-up
          <input
            aria-label="Next follow-up"
            type="datetime-local"
            value={followup}
            onChange={(e) => setFollowup(e.target.value)}
          />
        </label>
        <label>
          Priority
          <select
            aria-label="Application priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
                {n === 1 ? " · Highest" : n === 5 ? " · Lowest" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desired salary
          <input
            aria-label="Desired salary"
            type="number"
            min="0"
            value={desiredSalary}
            onChange={(e) => setDesiredSalary(e.target.value)}
          />
        </label>
        <label>
          Referral status
          <input
            aria-label="Referral status"
            value={referralStatus}
            onChange={(e) => setReferralStatus(e.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <Button variant="outline" onClick={() => void save()}>
          Save details
        </Button>
      </div>
      <div className="detail-section">
        <h3>Tasks</h3>
        {current.tasks.map((task) => (
          <label className="task-row" key={task.id}>
            <input
              type="checkbox"
              checked={!!task.completed_at}
              onChange={() => void toggleTask(task)}
            />
            <span>
              {task.title} · due {date(task.due_at)}
            </span>
            <Check size={14} />
          </label>
        ))}
        <label>
          Task title
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Follow up with recruiter"
          />
        </label>
        <label>
          Due at
          <input
            type="datetime-local"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
          />
        </label>
        <Button
          disabled={!taskTitle || !taskDue}
          onClick={() => void addTask()}
        >
          <CalendarClock size={15} />
          Add task
        </Button>
      </div>
      <div className="detail-section">
        <h3>Application facts</h3>
        <dl className="detail-grid">
          <dt>Applied</dt>
          <dd>{date(current.applied_at)}</dd>
          <dt>Referral</dt>
          <dd>{display(current.referral_status)}</dd>
          <dt>Requisition ID</dt>
          <dd>{display(current.job.company_job_id)}</dd>
        </dl>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={
          current.archived_at ? "Restore application?" : "Archive application?"
        }
        description="Your history and notes are preserved. You can restore this application later."
        action={
          current.archived_at ? "Restore application" : "Archive application"
        }
        onConfirm={() => void archive()}
        error={error}
      />
    </Dialog>
  );
}
