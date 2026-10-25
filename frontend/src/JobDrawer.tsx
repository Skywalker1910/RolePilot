import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  Clock3,
  Copy,
  MapPin,
  Pencil,
  RotateCcw,
} from "lucide-react";
import {
  api,
  date,
  display,
  label,
  post,
  validUrl,
  type Job,
  type JobDetail,
  type JobInput,
} from "./api";
import { Dialog } from "./components/ui/dialog";
import { Button } from "./components/ui/button";
import { ConfirmDialog } from "./components/ConfirmDialog";
import {
  ActivityTimeline,
  DetailsSection,
  LoadingSkeleton,
  MetadataItem,
  SkillTags,
  StatusBadge,
} from "./components/presentation";
import {
  experience,
  jobLocation,
  salary,
  useJobActions,
  useJobApplication,
} from "./components/JobCard";
import { JobForm } from "./JobForm";
import { ErrorPanel } from "./App";

const sections = [
  "Overview",
  "Requirements",
  "Description",
  "Application",
  "Activity",
] as const;
type Section = (typeof sections)[number];

export function JobDrawer({
  id,
  onClose,
  onNotice,
}: {
  id: number;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [section, setSection] = useState<Section>("Overview");
  const [feedback, setFeedback] = useState("");
  function notify(message: string) {
    setFeedback(message);
    onNotice(message);
  }
  const { data, error } = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<JobDetail>(`/jobs/${id}`),
  });
  const {
    application,
    pending,
    error: applicationError,
  } = useJobApplication(id, !!data);
  const job = data as unknown as Job;
  const actions = useJobActions(job, notify);
  const archive = useMutation({
    mutationFn: () =>
      post(`/jobs/${id}/archive`, {
        archived: !job?.archived_at,
        expected_revision: job?.revision,
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onNotice(
        job?.archived_at
          ? "Job restored."
          : "Job archived. All details are retained.",
      );
      onClose();
    },
  });
  async function save(input: JobInput) {
    await api(`/jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ job: input, expected_revision: job.revision }),
    });
    await client.invalidateQueries();
    setEditing(false);
    notify("Changes saved.");
  }
  async function copy(value: string, name: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${name} copied.`);
    } catch {
      notify(
        `Copy failed. Select the ${name.toLowerCase()} text to copy it manually.`,
      );
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={job?.job_title || "Opportunity details"}
      description={job?.company_name || "Loading listing…"}
      drawer
    >
      {error ? (
        <ErrorPanel error={error} />
      ) : !data ? (
        <LoadingSkeleton label="Loading details" count={2} />
      ) : editing ? (
        <>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            ← Back to details
          </Button>
          <JobForm initial={job} onSave={save} />
        </>
      ) : (
        <>
          <div className="drawer-header-meta">
            <MapPin size={14} />
            {jobLocation(job)}
            <StatusBadge
              status={
                application?.current_status ||
                (job.is_shortlisted ? "Shortlisted" : "Discovered")
              }
            />
          </div>
          <div className="drawer-header-meta">
            <span className="mono">
              Requisition: {display(job.company_job_id)}
            </span>
            <button
              className="icon-button"
              disabled={!job.company_job_id}
              aria-label="Copy requisition ID"
              onClick={() =>
                void copy(String(job.company_job_id), "Requisition ID")
              }
            >
              <Copy size={14} />
            </button>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit job
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              {job.archived_at ? (
                <RotateCcw size={14} />
              ) : (
                <Archive size={14} />
              )}
              {job.archived_at ? "Restore" : "Archive"}
            </Button>
          </div>
          {feedback && (
            <p className="notice" role="status">
              {feedback}
            </p>
          )}
          <div
            className="detail-tabs"
            role="group"
            aria-label="Job detail sections"
          >
            {sections.map((item) => (
              <button
                key={item}
                aria-pressed={section === item}
                aria-controls="job-detail-section"
                onClick={() => setSection(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div id="job-detail-section">
            {section === "Overview" && (
              <>
                <DetailsSection title="At a glance">
                  <p className="pre-wrap">{display(job.job_summary)}</p>
                  <dl className="detail-grid">
                    <MetadataItem icon={BriefcaseBusiness} label="Compensation">
                      {salary(job)}
                    </MetadataItem>
                    <MetadataItem icon={Clock3} label="Experience">
                      {experience(job)}
                    </MetadataItem>
                    {[
                      "remote_type",
                      "employment_type",
                      "seniority",
                      "verification_status",
                      "data_confidence",
                    ].map((field) => (
                      <MetadataItem key={field} label={label(field)}>
                        {display(job[field])}
                      </MetadataItem>
                    ))}
                  </dl>
                </DetailsSection>
                <DetailsSection title="Required skills">
                  <SkillTags skills={job.required_skills} limit={8} />
                  {!job.required_skills.length && (
                    <p className="muted">Not specified</p>
                  )}
                </DetailsSection>
                <DetailsSection title="Research notes">
                  <p className="pre-wrap">{display(job.research_notes)}</p>
                  <p className="muted">
                    Imported research is not independent confirmation that a
                    listing is active. Check the official posting before
                    applying.
                  </p>
                </DetailsSection>
              </>
            )}
            {section === "Requirements" && (
              <>
                <DetailsSection title="Experience & education">
                  <dl className="detail-grid">
                    <MetadataItem icon={Clock3} label="Experience">
                      {experience(job)}
                    </MetadataItem>
                    <MetadataItem label="Education">
                      {display(job.education_requirement)}
                    </MetadataItem>
                  </dl>
                </DetailsSection>
                {["required_skills", "preferred_skills", "job_keywords"].map(
                  (field) => (
                    <DetailsSection key={field} title={label(field)}>
                      {((job[field] as string[]) || []).length ? (
                        <SkillTags
                          skills={job[field] as string[]}
                          limit={Infinity}
                          preferred={field === "preferred_skills"}
                        />
                      ) : (
                        <p className="muted">Not specified</p>
                      )}
                    </DetailsSection>
                  ),
                )}
                <DetailsSection title="Employment eligibility">
                  <p className="muted">
                    Requirements from the listing, for your review. Missing
                    information does not establish eligibility.
                  </p>
                  <dl className="detail-grid">
                    {[
                      "sponsorship_policy",
                      "citizenship_requirement",
                      "security_clearance_requirement",
                      "work_authorization_notes",
                      "remote_eligibility",
                    ].map((field) => (
                      <MetadataItem key={field} label={label(field)}>
                        {display(job[field])}
                      </MetadataItem>
                    ))}
                  </dl>
                </DetailsSection>
              </>
            )}
            {section === "Description" && (
              <>
                {[
                  "full_description",
                  "responsibilities",
                  "qualifications",
                  "application_questions",
                ].map((field) => (
                  <DetailsSection title={label(field)} key={field}>
                    <p className="pre-wrap">{display(job[field])}</p>
                  </DetailsSection>
                ))}
              </>
            )}
            {section === "Application" && (
              <DetailsSection title="Your application">
                {applicationError ? (
                  <ErrorPanel error={applicationError} />
                ) : pending ? (
                  <p role="status">Checking application…</p>
                ) : application ? (
                  <>
                    <StatusBadge status={application.current_status} />
                    <dl className="detail-grid">
                      <MetadataItem label="Applied date">
                        {date(application.applied_at)}
                      </MetadataItem>
                      <MetadataItem label="Archive">
                        {application.archived_at
                          ? date(application.archived_at)
                          : "Active"}
                      </MetadataItem>
                    </dl>
                    <p className="pre-wrap">
                      {application.notes || "No application notes yet."}
                    </p>
                    <Button asChild variant="outline">
                      <Link to={`/applications?selected=${application.id}`}>
                        Open application & follow-ups
                      </Link>
                    </Button>
                  </>
                ) : (
                  <p>
                    You have not started an application for this opportunity.
                  </p>
                )}
                <p className="muted">
                  Apply saves a pending application before opening the employer
                  website. You confirm submission when you return.
                </p>
                <p className="muted">
                  Document attachments and submission snapshots are planned for
                  a later phase.
                </p>
              </DetailsSection>
            )}
            {section === "Activity" && (
              <>
                <DetailsSection title="Application timeline">
                  {application?.history?.length ? (
                    <ActivityTimeline
                      events={application.history.map((item) => ({
                        id: item.id,
                        title: item.previous_status
                          ? `From ${item.previous_status}`
                          : "Application created",
                        status: item.new_status,
                        at: item.changed_at,
                        notes: item.notes,
                      }))}
                    />
                  ) : (
                    <p className="muted">No application history recorded.</p>
                  )}
                </DetailsSection>
                <DetailsSection title="Source & history">
                  <dl className="detail-grid">
                    {[
                      "source_platform",
                      "source_url",
                      "canonical_job_url",
                      "external_job_id",
                      "location",
                    ].map((field) => (
                      <MetadataItem key={field} label={label(field)}>
                        {display(job[field])}
                      </MetadataItem>
                    ))}
                    {[
                      "date_discovered",
                      "posted_at",
                      "application_deadline",
                      "source_checked_at",
                      "imported_at",
                      "updated_at",
                      "archived_at",
                    ].map((field) => (
                      <MetadataItem key={field} label={label(field)}>
                        {date(job[field])}
                      </MetadataItem>
                    ))}
                  </dl>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void copy(job.canonical_job_url, "Official URL")
                    }
                  >
                    <Copy size={14} />
                    Copy official URL
                  </Button>
                </DetailsSection>
                <DetailsSection title="Original records">
                  <p className="muted">
                    Unmodified source values are retained for review.
                  </p>
                  {data.provenance.map((source, i) => (
                    <details key={i}>
                      <summary>
                        {source.batch_id
                          ? `Import #${source.batch_id} · row ${source.row_number}`
                          : "Manual edit"}{" "}
                        · {date(source.created_at)}
                      </summary>
                      <pre>
                        {JSON.stringify(source.original_fields, null, 2)}
                      </pre>
                    </details>
                  ))}
                </DetailsSection>
              </>
            )}
          </div>
          <div className="sticky-actions">
            {!job.archived_at &&
              !application?.archived_at &&
              (!application ||
                application.current_status === "Pending Application") && (
                <Button
                  disabled={pending || !!applicationError || actions.busy}
                  onClick={() => void actions.apply()}
                >
                  {application ? "Continue pending application" : "Apply"}
                </Button>
              )}
            {application && (
              <Button variant="outline" asChild>
                <Link to={`/applications?selected=${application.id}`}>
                  View application
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              disabled={actions.busy}
              aria-pressed={!!job.is_shortlisted}
              onClick={() => void actions.shortlist()}
            >
              <Bookmark size={15} />
              {job.is_shortlisted ? "Shortlisted" : "Shortlist job"}
            </Button>
            {validUrl(job.canonical_job_url) && (
              <Button variant="ghost" asChild>
                <a
                  href={job.canonical_job_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open official posting
                  <ArrowUpRight size={15} />
                </a>
              </Button>
            )}
          </div>
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title={job.archived_at ? "Restore this job?" : "Archive this job?"}
            description="The listing and its complete source history will be retained."
            action={job.archived_at ? "Restore job" : "Archive job"}
            busy={archive.isPending}
            error={archive.error?.message}
            onConfirm={() => archive.mutate()}
          />
        </>
      )}
    </Dialog>
  );
}
