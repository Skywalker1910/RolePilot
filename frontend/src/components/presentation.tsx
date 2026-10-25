import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Bookmark, CheckCircle2, Circle, Clock3, X } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import { date } from "../api";

export function StatusBadge({ status }: { status: string }) {
  const tone = [
    "Offer Received",
    "Offer Accepted",
    "Completed",
    "Final",
    "Indexed",
  ].includes(status)
    ? "success"
    : /Pending|On Hold|Needs Review|Missing|Unverified/.test(status)
      ? "warning"
      : /Rejected|Withdrawn|Closed|Declined|Archived|Not Interested|No Response/.test(
            status,
          )
        ? "closed"
        : /Shortlisted/.test(status)
          ? "info"
          : /Applied|Review|Screening|Assessment|Interview|Tailored|Master/.test(
                status,
              )
            ? "active"
            : "neutral";
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? Clock3
        : status === "Shortlisted"
          ? Bookmark
          : Circle;
  return (
    <span className={`status-badge status-${tone}`}>
      <Icon size={12} aria-hidden="true" />
      {status}
    </span>
  );
}

export function SkillTag({
  children,
  preferred = false,
}: {
  children: ReactNode;
  preferred?: boolean;
}) {
  return (
    <span className={`skill-tag${preferred ? " preferred" : ""}`}>
      {children}
    </span>
  );
}

export function SkillTags({
  skills,
  limit = 5,
  preferred = false,
}: {
  skills: string[];
  limit?: number;
  preferred?: boolean;
}) {
  return (
    <div className="chips">
      {skills.slice(0, limit).map((skill) => (
        <SkillTag key={skill} preferred={preferred}>
          {skill}
        </SkillTag>
      ))}
      {skills.length > limit && (
        <span
          className="skill-overflow"
          aria-label={`${skills.length - limit} more skills; open details to view all`}
        >
          +{skills.length - limit}
        </span>
      )}
    </div>
  );
}

export function MetadataItem({
  icon: Icon,
  label,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="metadata-item">
      {Icon && <Icon size={15} aria-hidden="true" />}
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function DetailsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function FilterChip({
  label,
  value,
  onRemove,
}: {
  label: string;
  value: string;
  onRemove: () => void;
}) {
  return (
    <button
      className="filter-chip"
      onClick={onRemove}
      aria-label={`Remove ${label} filter`}
    >
      <span>
        {label}: {value}
      </span>
      <X size={13} aria-hidden="true" />
    </button>
  );
}

export function QuickAction({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Link className="quick-action" to={to}>
      <Icon size={16} aria-hidden="true" />
      {children}
    </Link>
  );
}

export function LoadingSkeleton({
  label = "Loading",
  count = 3,
}: {
  label?: string;
  count?: number;
}) {
  return (
    <div className="skeleton-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-card" key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function ActivityTimeline({
  events,
}: {
  events: {
    id: number;
    title: string;
    at: string;
    notes?: string | null;
    status?: string;
  }[];
}) {
  return (
    <ol className="activity-timeline">
      {events.map((event) => (
        <li key={event.id}>
          <span className="timeline-icon">
            <Clock3 size={14} aria-hidden="true" />
          </span>
          <div>
            {event.status ? (
              <StatusBadge status={event.status} />
            ) : (
              <strong>{event.title}</strong>
            )}
            {event.status && <p>{event.title}</p>}
            <time dateTime={event.at}>{date(event.at)}</time>
            {event.notes && <p className="pre-wrap">{event.notes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OpportunityTabs() {
  return (
    <nav className="workspace-tabs" aria-label="Opportunity views">
      <NavLink to="/jobs">Opportunities</NavLink>
      <NavLink to="/companies">Companies</NavLink>
    </nav>
  );
}
