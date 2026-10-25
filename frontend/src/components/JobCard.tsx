import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  BriefcaseBusiness,
  Clock3,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api, post, validUrl, type Job } from "../api";
import { Button } from "./ui/button";
import { SkillTags, StatusBadge } from "./presentation";

export type JobApplication = {
  id: number;
  current_status: string;
  applied_at?: string | null;
  archived_at?: string | null;
  notes?: string | null;
  history?: {
    id: number;
    previous_status: string | null;
    new_status: string;
    changed_at: string;
    notes: string | null;
  }[];
};

// Bounded to the visible page; shared with the drawer and cached across view changes.
export function useJobApplication(id: number, enabled = true) {
  const active = useQuery({
    queryKey: ["applications", "job", id],
    queryFn: () =>
      api<{ items: JobApplication[] }>(
        `/applications?job_id=${id}&page_size=1`,
      ),
    enabled,
    staleTime: 60_000,
  });
  const archived = useQuery({
    queryKey: ["applications", "job", id, "archived"],
    queryFn: () =>
      api<{ items: JobApplication[] }>(
        `/applications?job_id=${id}&archived=true&page_size=1`,
      ),
    enabled: enabled && !!active.data && !active.data.items?.length,
    staleTime: 60_000,
  });
  return {
    application: active.data?.items?.[0] || archived.data?.items?.[0],
    pending:
      active.isPending ||
      (!!active.data && !active.data.items?.length && archived.isPending),
    error: active.error || archived.error,
  };
}

export function experience(job: Job) {
  const min = job.minimum_experience,
    max = job.maximum_experience;
  return min == null && max == null
    ? "Experience not specified"
    : min == null
      ? `Up to ${max} years`
      : max == null
        ? `${min}+ years`
        : min === max
          ? `${min} years`
          : `${min}–${max} years`;
}
export function salary(job: Job) {
  if (job.salary_min == null && job.salary_max == null)
    return "Compensation not specified";
  const number = (value: unknown) => Number(value).toLocaleString();
  const range =
    job.salary_min == null
      ? `Up to ${number(job.salary_max)}`
      : job.salary_max == null
        ? `From ${number(job.salary_min)}`
        : `${number(job.salary_min)}–${number(job.salary_max)}`;
  return [
    job.salary_currency,
    range,
    job.salary_period && `/ ${job.salary_period}`,
  ]
    .filter(Boolean)
    .join(" ");
}
export function jobLocation(job: Job) {
  return String(
    job.location ||
      [job.city, job.state, job.country].filter(Boolean).join(", ") ||
      "Location not specified",
  );
}

export function JobStatusBadge({ job }: { job: Job }) {
  const { application, pending, error } = useJobApplication(job.id);
  return (
    <StatusBadge
      status={
        pending
          ? "Checking status"
          : error
            ? "Status unavailable"
            : application?.current_status ||
              (job.archived_at
                ? "Archived"
                : job.is_shortlisted
                  ? "Shortlisted"
                  : "Discovered")
      }
    />
  );
}

export function useJobActions(job: Job, onNotice: (message: string) => void) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function shortlist() {
    setBusy(true);
    try {
      await api(`/jobs/${job.id}/shortlist`, {
        method: "PATCH",
        body: JSON.stringify({
          shortlisted: !job.is_shortlisted,
          expected_revision: job.revision,
        }),
      });
      await client.invalidateQueries();
      onNotice(
        job.is_shortlisted ? "Removed from shortlist." : "Added to shortlist.",
      );
    } catch (error) {
      onNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    const url = job.canonical_job_url;
    if (!validUrl(url)) {
      onNotice("This job does not have a valid employer application URL.");
      return;
    }
    const portal = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      await post(`/jobs/${job.id}/apply`, {});
      if (portal) {
        portal.opener = null;
        portal.location.href = url;
      }
      await client.invalidateQueries();
      onNotice(
        portal
          ? "Application saved as Pending Application. Confirm the outcome when you return."
          : "Application saved as Pending Application. Your browser blocked the portal; use Open official posting to continue.",
      );
    } catch (error) {
      portal?.close();
      onNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { shortlist, apply, busy };
}

export function JobCard({
  job,
  onOpen,
  onNotice,
  compact = false,
}: {
  job: Job;
  onOpen: () => void;
  onNotice: (message: string) => void;
  compact?: boolean;
}) {
  const { application, pending, error } = useJobApplication(job.id);
  const actions = useJobActions(job, onNotice);
  return (
    <article
      className={`job-card${compact ? " compact" : ""}`}
      aria-label={`${job.job_title} at ${job.company_name}`}
    >
      <div className="job-card-top">
        <span className="company-icon" aria-hidden="true">
          {job.company_name.slice(0, 2).toUpperCase()}
        </span>
        <span>{job.company_name}</span>
        <button
          className="icon-button"
          title={job.is_shortlisted ? "Remove from shortlist" : "Shortlist job"}
          aria-label={`${job.is_shortlisted ? "Remove from shortlist" : "Shortlist"}: ${job.job_title}`}
          aria-pressed={!!job.is_shortlisted}
          disabled={actions.busy}
          onClick={() => void actions.shortlist()}
        >
          <Bookmark
            size={17}
            fill={job.is_shortlisted ? "currentColor" : "none"}
          />
        </button>
      </div>
      <button className="job-title" onClick={onOpen}>
        <strong>{job.job_title}</strong>
      </button>
      <div className="job-card-metadata">
        <span>
          <MapPin size={14} />
          {jobLocation(job)}
          {job.remote_type ? ` · ${job.remote_type}` : ""}
        </span>
        <span>
          <Clock3 size={14} />
          {experience(job)}
        </span>
        {!compact && (job.salary_min != null || job.salary_max != null) && (
          <span>
            <BriefcaseBusiness size={14} />
            {salary(job)}
          </span>
        )}
      </div>
      <SkillTags skills={job.required_skills || []} limit={compact ? 3 : 5} />
      <div className="job-card-footer">
        <StatusBadge
          status={
            pending
              ? "Checking status"
              : error
                ? "Status unavailable"
                : application?.current_status ||
                  (job.archived_at
                    ? "Archived"
                    : job.is_shortlisted
                      ? "Shortlisted"
                      : "Discovered")
          }
        />
        {compact || job.archived_at ? (
          <Button variant="ghost" onClick={onOpen}>
            Details <ArrowUpRight size={14} />
          </Button>
        ) : application &&
          (application.current_status !== "Pending Application" ||
            application.archived_at) ? (
          <Button variant="outline" asChild>
            <Link to={`/applications?selected=${application.id}`}>
              Track <ArrowUpRight size={14} />
            </Link>
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={pending || !!error || actions.busy}
            onClick={() => void actions.apply()}
          >
            {application ? "Continue" : "Apply"}
            <ArrowUpRight size={14} />
          </Button>
        )}
      </div>
    </article>
  );
}
