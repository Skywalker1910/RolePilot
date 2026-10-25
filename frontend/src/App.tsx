import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowRight,
  BriefcaseBusiness,
  ChevronRight,
  Compass,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Sun,
  CalendarDays,
  ClipboardCheck,
  LogOut,
  X,
  Clock3,
} from "lucide-react";
import { api, date, post, setCsrfToken, type Job } from "./api";
import { Explorer } from "./Explorer";
import { ImportWizard } from "./ImportWizard";
import { Button } from "./components/ui/button";
import { DocumentLibrary, LibrarySettings } from "./DocumentLibrary";
import { Companies } from "./Companies";
import { Applications } from "./Applications";
import { Dialog } from "./components/ui/dialog";
import { EmptyState, MetricCard, PageHeader } from "./components/workspace";

import { JobCard } from "./components/JobCard";
import {
  ActivityTimeline,
  SectionHeader,
  StatusBadge,
} from "./components/presentation";
import { WorkspaceNavigation } from "./components/WorkspaceNavigation";
import { CommandPalette } from "./components/CommandPalette";
import { AdminPortal } from "./Admin";
import { ProfilePage } from "./Profile";

export function App() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: () =>
      api<{
        auth_required: boolean;
        authenticated: boolean;
        user?: { id: number; username: string; role: "admin" | "user" } | null;
      }>("/auth/session"),
  });
  const [dark, setDark] = useState(
    () => localStorage.getItem("rolepilot-theme") === "dark",
  );
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("rolepilot-sidebar") === "collapsed",
  );
  const [search, setSearch] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || target.isContentEditable)
        return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const navigate = useNavigate();
  async function logout() {
    await api("/auth/logout", { method: "POST", body: JSON.stringify({}) });
    setCsrfToken(null);
    queryClient.setQueryData(["auth-session"], {
      auth_required: true,
      authenticated: false,
      csrf_token: null,
    });
  }
  function toggleTheme() {
    const value = !dark;
    setDark(value);
    localStorage.setItem("rolepilot-theme", value ? "dark" : "light");
  }
  if (auth.data?.auth_required && auth.data.user?.role === "admin") {
    return (
      <AdminPortal
        user={auth.data.user}
        onLogout={() => void logout()}
        dark={dark}
        toggleTheme={toggleTheme}
      />
    );
  }
  if (location.pathname.startsWith("/admin")) {
    return (
      <div className={`${dark ? "app dark" : "app"} admin-access-app`}>
        <main className="admin-access-card">
          <div className="eyebrow">ROLEPILOT ADMINISTRATION</div>
          <h1>Administrator sign-in required</h1>
          <p>
            The admin console is available at <strong>/admin</strong>. Sign in
            with an active administrator account to manage users and invitations.
          </p>
          {auth.data?.auth_required ? (
            <Button onClick={() => void logout()}>
              Sign out and switch account
            </Button>
          ) : (
            <Link className="button button-outline" to="/">
              Return to workspace
            </Link>
          )}
        </main>
      </div>
    );
  }
  return (
    <div
      className={`${dark ? "app dark" : "app"}${collapsed ? " nav-collapsed" : ""}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="sidebar-topline">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <Compass size={24} />
            </span>
            <span>
              Role<span className="brand-light">Pilot</span>
              <small>YOUR NEXT CHAPTER</small>
            </span>
          </Link>
          <button
            className="icon-button collapse-button"
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              localStorage.setItem(
                "rolepilot-sidebar",
                next ? "collapsed" : "expanded",
              );
            }}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
        {auth.data?.user ? (
          <Link to="/profile" className="workspace profile-switcher" aria-label="Open my profile">
            <span className="avatar">{auth.data.user.username.slice(0, 2).toUpperCase()}</span>
            <div>
              {auth.data.user.username}
              <small>Hosted · User</small>
            </div>
            <ChevronRight size={16} />
          </Link>
        ) : (
          <div className="workspace">
            <span className="avatar">ME</span>
            <div>Personal workspace<small>Local · Single user</small></div>
          </div>
        )}
        <WorkspaceNavigation />
        <div className="local-card">
          <ShieldCheck size={19} />
          <strong>
            {auth.data?.auth_required
              ? "Private hosted workspace."
              : "Your search stays yours."}
          </strong>
          <p>
            {auth.data?.auth_required ? (
              "Invitation-only accounts keep each hosted job search private."
            ) : (
              <>
                Stored on this computer.
                <br />
                No cloud sync. No telemetry.
              </>
            )}
          </p>
          <span>
            <i />{" "}
            {auth.data?.auth_required ? "PRIVATE ACCOUNT" : "LOCAL WORKSPACE"}
          </span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label="Toggle navigation"
            aria-expanded={menu}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("/jobs?q=" + encodeURIComponent(search));
            }}
          >
            <Search size={17} />
            <input
              aria-label="Search all jobs"
              placeholder="Search your opportunities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="command-trigger"
              onClick={() => setCommandOpen(true)}
              aria-label="Open quick actions (Ctrl+K)"
            >
              <kbd>Ctrl K</kbd>
            </button>
          </form>
          <div className="topbar-right">
            {auth.data?.auth_required ? (
              <button
                className="icon-button sign-out"
                onClick={() => void logout()}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={16} />
              </button>
            ) : (
              <span className="local-pill">
                <i /> Local only
              </span>
            )}
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {auth.data?.user ? (
              <Link to="/profile" className="avatar profile-avatar" aria-label="Open my profile">
                {auth.data.user.username.slice(0, 2).toUpperCase()}
              </Link>
            ) : (
              <span className="avatar">ME</span>
            )}
          </div>
        </header>
        <main id="main-content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/jobs" element={<Explorer />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/imports" element={<ImportWizard />} />
            <Route path="/archive" element={<Explorer archived />} />
            <Route path="/documents" element={<DocumentLibrary />} />
            <Route
              path="/profile"
              element={auth.data?.user ? <ProfilePage /> : <Navigate to="/settings" replace />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  authRequired={Boolean(auth.data?.auth_required)}
                  dark={dark}
                  toggleTheme={toggleTheme}
                />
              }
            />
            <Route
              path="*"
              element={
                <div className="empty">
                  <h1>Page not found</h1>
                  <Link to="/">Back to overview</Link>
                </div>
              }
            />
          </Routes>
        </main>
        <Dialog
          open={menu}
          onOpenChange={setMenu}
          title="Your workspace"
          description="Navigate RolePilot"
        >
          <div className="mobile-navigation">
            {auth.data?.user && <Link className="mobile-profile-link" to="/profile" onClick={() => setMenu(false)}>My profile · {auth.data.user.username}</Link>}
            <WorkspaceNavigation onNavigate={() => setMenu(false)} />
          </div>
        </Dialog>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        <PendingApplicationConfirmation />
        <footer>
          RolePilot{" "}
          <span>
            {auth.data?.auth_required
              ? "Private hosted workspace"
              : "Private by design · Local workspace"}
          </span>
        </footer>
      </div>
    </div>
  );
}

type PendingApplication = { id: number; job: Job; current_status: string };
export function PendingApplicationConfirmation() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<PendingApplication[]>([]);
  const [error, setError] = useState("");
  const application = queue[0];
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const items = await api<PendingApplication[]>(
          "/applications/pending-confirmations",
        );
        if (active) {
          setQueue(items);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    const focus = () => {
      if (document.visibilityState === "visible") void check();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active = false;
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, []);
  async function choose(
    action: "applied" | "not_yet" | "archive" | "remind_later",
  ) {
    if (!application) return;
    try {
      await post(`/applications/${application.id}/confirm`, { action });
      setQueue((items) => items.slice(1));
      await queryClient.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog
      open={!!application}
      onOpenChange={() => {}}
      title="Did you submit your application for this position?"
      description={`${application?.job.company_name || ""} · ${application?.job.job_title || ""}`}
    >
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        RolePilot saved this as Pending Application. Opening or focusing a tab
        does not count as a submission.
      </p>
      <div className="actions confirmation-actions">
        <Button onClick={() => void choose("applied")}>Yes, I applied</Button>
        <Button variant="outline" onClick={() => void choose("not_yet")}>
          No, not yet
        </Button>
        <Button variant="destructive" onClick={() => void choose("archive")}>
          No, archive this job
        </Button>
        <Button variant="ghost" onClick={() => void choose("remind_later")}>
          Remind me later
        </Button>
      </div>
    </Dialog>
  );
}
type OverviewData = {
  total_jobs: number;
  archived_jobs: number;
  companies: number;
  import_batches: number;
  recent_jobs: Job[];
  companies_chart: { name: string; jobs: number }[];
  activity: { id: number; message: string; created_at: string }[];
  application_metrics: {
    applications_total: number;
    applications_active: number;
    pending_confirmations: number;
    submitted: number;
    under_review: number;
    interview_opportunities: number;
    offers: number;
    rejections: number;
    follow_ups_due: number;
    response_rate: number | null;
    interview_conversion_rate: number | null;
    stage_distribution: { status: string; count: number }[];
    applications_over_time: { month: string; count: number }[];
    rate_denominator: string;
    response_rule: string;
  };
};
type DashboardApplication = {
  id: number;
  current_status: string;
  pending_confirmation: boolean;
  next_follow_up_at: string | null;
  job: Job;
  tasks: {
    id: number;
    title: string;
    due_at: string;
    completed_at: string | null;
  }[];
};

export function Overview() {
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () => api<OverviewData>("/overview"),
  });
  const applications = useQuery({
    queryKey: ["dashboard-applications"],
    queryFn: () =>
      api<{ items: DashboardApplication[] }>(
        "/applications?page=1&page_size=100",
      ),
  });
  const confirmations = useQuery({
    queryKey: ["dashboard-confirmations"],
    queryFn: () =>
      api<DashboardApplication[]>("/applications/pending-confirmations"),
  });
  const shortlisted = useQuery({
    queryKey: ["dashboard-shortlisted"],
    queryFn: () =>
      api<{ items: Job[]; total: number }>(
        "/jobs?shortlisted=true&page=1&page_size=100",
      ),
  });
  if (
    [overview, applications, confirmations, shortlisted].some(
      (query) => query.isPending,
    )
  ) {
    return (
      <div className="dashboard-loading" aria-label="Loading dashboard">
        <div />
        <div />
        <div />
        <div />
      </div>
    );
  }
  const error =
    overview.error ||
    applications.error ||
    confirmations.error ||
    shortlisted.error;
  if (error) return <ErrorPanel error={error as Error} />;
  const data = overview.data!;
  const applicationRows = applications.data!.items;
  const pendingRows = confirmations.data!;
  const dueItems = applicationRows
    .flatMap((app) => {
      const appDue =
        app.next_follow_up_at && new Date(app.next_follow_up_at) <= new Date();
      const taskItems = app.tasks.filter(
        (task) => !task.completed_at && new Date(task.due_at) <= new Date(),
      );
      return [
        ...(appDue
          ? [
              {
                id: `app-${app.id}`,
                title: `Follow up · ${app.job.company_name}`,
                subtitle: app.job.job_title,
                due: app.next_follow_up_at!,
                applicationId: app.id,
              },
            ]
          : []),
        ...taskItems.map((task) => ({
          id: `task-${task.id}`,
          title: task.title,
          subtitle: app.job.company_name,
          due: task.due_at,
          applicationId: app.id,
        })),
      ];
    })
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 4);
  const shortlistedRows = shortlisted.data!.items.slice(0, 4);
  const metrics = data.application_metrics;
  const stages = metrics.stage_distribution
    .filter((stage) => stage.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxStage = Math.max(1, ...stages.map((stage) => stage.count));
  const attentionItems = [
    ...dueItems.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: `${item.subtitle} · ${date(item.due)}`,
      status: "Follow-up due",
      to: `/applications?selected=${item.applicationId}`,
    })),
    ...pendingRows.map((app) => ({
      id: `confirm-${app.id}`,
      title: app.job.job_title,
      subtitle: app.job.company_name,
      status: "Pending confirmation",
      to: `/applications?selected=${app.id}`,
    })),
    ...shortlistedRows.map((job) => ({
      id: `shortlist-${job.id}`,
      title: job.job_title,
      subtitle: job.company_name,
      status: "Shortlisted",
      to: `/jobs?job=${job.id}`,
    })),
  ].slice(0, 5);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="dashboard-page">
      <PageHeader
        eyebrow={today.toUpperCase()}
        title="Overview"
        description="Your search, organized around the next useful move."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/applications?create=true">Add application</Link>
            </Button>
            <Button asChild>
              <Link to="/imports">
                <ArrowDownToLine size={15} />
                Import jobs
              </Link>
            </Button>
          </>
        }
      />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="primary-metrics">
        <MetricCard
          to="/jobs"
          label="Active opportunities"
          value={data.total_jobs}
          note={`${data.companies} companies`}
          icon={BriefcaseBusiness}
        />
        <MetricCard
          to="/applications"
          label="Submitted applications"
          value={metrics.submitted}
          note={`${metrics.applications_active} active pursuits`}
          icon={ClipboardCheck}
        />
        <MetricCard
          to="/applications"
          label="Interviews"
          value={metrics.interview_opportunities}
          note="Distinct applications"
          icon={CalendarDays}
        />
        <MetricCard
          to="/applications"
          label="Pending actions"
          value={metrics.pending_confirmations + metrics.follow_ups_due}
          note={`${metrics.pending_confirmations} confirmations · ${metrics.follow_ups_due} follow-ups`}
          icon={Clock3}
          tone={
            metrics.pending_confirmations + metrics.follow_ups_due
              ? "attention"
              : "default"
          }
        />
      </div>
      <div className="secondary-metrics" aria-label="Additional search metrics">
        <Link to="/jobs?shortlisted=true">
          <strong>{shortlisted.data!.total}</strong> shortlisted
        </Link>
        <Link to="/archive">
          <strong>{data.archived_jobs}</strong> archived
        </Link>
        <span>
          <strong>{metrics.offers}</strong> offers
        </span>
        <span>
          <strong>
            {metrics.response_rate === null ? "—" : `${metrics.response_rate}%`}
          </strong>{" "}
          response rate
        </span>
      </div>
      <section className="workspace-section attention-section">
        <SectionHeader
          title="Needs attention"
          action={
            <Link to="/applications">
              Open applications <ArrowRight size={14} />
            </Link>
          }
        />
        <div className="attention-summary">
          <span>{metrics.follow_ups_due} follow-ups due</span>
          <span>{pendingRows.length} confirmations</span>
          <span>{shortlisted.data!.total} shortlisted</span>
        </div>
        {attentionItems.length ? (
          <div className="attention-list">
            {attentionItems.map((item) => (
              <Link key={item.id} to={item.to} className="attention-list-row">
                <span className="timeline-icon">
                  <Clock3 size={14} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle}</small>
                </span>
                <StatusBadge status={item.status} />
                <ChevronRight size={15} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="All caught up"
            description="No application confirmations are waiting."
            action={
              <Link className="text-action" to="/jobs">
                Explore opportunities
              </Link>
            }
          />
        )}
        {!pendingRows.length && attentionItems.length > 0 && (
          <p className="sr-only">No application confirmations are waiting.</p>
        )}
      </section>
      <div className="dashboard-columns">
        <section className="workspace-section recent-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">LATEST OPPORTUNITIES</span>
              <h2>Recently added</h2>
            </div>
            <Link to="/jobs">
              All jobs <ArrowRight size={14} />
            </Link>
          </div>
          {data.recent_jobs.length ? (
            <div className="recent-card-grid">
              {data.recent_jobs.slice(0, 4).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  compact
                  onOpen={() => navigate(`/jobs?job=${job.id}`)}
                  onNotice={setNotice}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No opportunities yet"
              description="Import your first workbook to start building your search."
              action={
                <Button asChild>
                  <Link to="/imports">Import jobs</Link>
                </Button>
              }
            />
          )}
        </section>
        <section className="workspace-section pipeline-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">APPLICATIONS</span>
              <h2>Hiring pipeline</h2>
            </div>
            <Link to="/applications">
              View pipeline <ArrowRight size={14} />
            </Link>
          </div>
          {stages.length ? (
            <div className="stage-list">
              {stages.slice(0, 7).map((stage) => (
                <div className="stage-row" key={stage.status}>
                  <span>{stage.status}</span>
                  <div className="stage-track">
                    <span
                      style={{
                        width: `${Math.max(5, (stage.count / maxStage) * 100)}%`,
                      }}
                    />
                  </div>
                  <strong>{stage.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="No active applications"
              description="Starting an application creates its place in the pipeline."
              action={
                <Link className="text-action" to="/jobs">
                  Browse opportunities
                </Link>
              }
            />
          )}
          {metrics.submitted > 0 && (
            <p className="pipeline-footnote">
              Response rate{" "}
              <strong>
                {metrics.response_rate === null
                  ? "—"
                  : `${metrics.response_rate}%`}
              </strong>
              <span>·</span> Interview conversion{" "}
              <strong>
                {metrics.interview_conversion_rate === null
                  ? "—"
                  : `${metrics.interview_conversion_rate}%`}
              </strong>
            </p>
          )}
        </section>
        <section className="workspace-section activity-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">RECENT CHANGES</span>
              <h2>Activity</h2>
            </div>
          </div>
          {data.activity.length ? (
            <ActivityTimeline
              events={data.activity
                .slice(0, 5)
                .map((event) => ({
                  id: event.id,
                  title: event.message,
                  at: event.created_at,
                }))}
            />
          ) : (
            <EmptyState
              icon={Clock3}
              title="Your workspace is ready"
              description="Imports and application updates will show here."
            />
          )}
        </section>
      </div>
    </div>
  );
}
export function ErrorPanel({ error }: { error: Error }) {
  return (
    <div role="alert" className="error panel-padding">
      <strong>Something needs attention</strong>
      <p>{error.message}</p>
      <p>Check that the local backend is running, then retry.</p>
    </div>
  );
}
function SettingsPage({
  authRequired,
  dark,
  toggleTheme,
}: {
  authRequired: boolean;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const { data, error } = useQuery({
    queryKey: ["health"],
    queryFn: () => api<{ status: string; schema_version: string }>("/health"),
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORKSPACE</div>
          <h1>Settings</h1>
          <p>Private by design, local by default.</p>
        </div>
      </div>
      <section className="panel panel-padding">
        <h2>Appearance</h2>
        <p className="muted">
          Choose a theme for this browser. Both use a restrained slate accent.
        </p>
        <div className="segmented-control" aria-label="Theme preference">
          <button
            aria-pressed={!dark}
            onClick={() => {
              if (dark) toggleTheme();
            }}
          >
            <Sun size={16} />
            Cloud White
          </button>
          <button
            aria-pressed={dark}
            onClick={() => {
              if (!dark) toggleTheme();
            }}
          >
            <Moon size={16} />
            Obsidian
          </button>
        </div>
      </section>
      <section className="panel panel-padding">
        <h2>Local storage & privacy</h2>
        <p>
          {authRequired
            ? "Your job-search data lives in the private SQLite database on this hosted instance. Sign-in is required for private workspace APIs."
            : "Your jobs and import history live in SQLite on this workstation. Both development servers bind to 127.0.0.1."}
        </p>
        <dl className="detail-grid">
          <dt>API status</dt>
          <dd>{error ? error.message : data?.status || "Checking…"}</dd>
          <dt>Schema revision</dt>
          <dd>{data?.schema_version || "—"}</dd>
          <dt>AI providers</dt>
          <dd>Not enabled — planned for Phase 6</dd>
          <dt>Runtime data</dt>
          <dd>Configured by ROLEPILOT_DATA_DIR</dd>
          <dt>Authentication</dt>
          <dd>
            {authRequired
              ? "Hosted sign-in required"
              : "Local workstation mode"}
          </dd>
          <dt>Backups</dt>
          <dd>
            {authRequired
              ? "Daily local SQLite and document backup"
              : "Manual SQLite online backup available"}
          </dd>
        </dl>
        <p className="muted">
          Hosted backups are stored on the same server; configure a protected
          off-instance copy for disaster recovery. Never copy a live SQLite
          database file by itself.
        </p>
      </section>
      <LibrarySettings />
      <section className="panel panel-padding roadmap">
        <h2>Future improvements</h2>
        <p>
          Contacts, interview records, richer analytics, document previews and
          submitted-document snapshots are planned for later phases.
        </p>
        <p>
          Job discovery, application history, pending confirmations, tasks,
          archive/restore, and dashboard counts are available now.
        </p>
      </section>
    </>
  );
}
