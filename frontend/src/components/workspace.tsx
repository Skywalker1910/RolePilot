import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "default",
  to,
}: {
  label: string;
  value: number | string;
  note?: string;
  icon: LucideIcon;
  tone?: "default" | "attention";
  to?: string;
}) {
  return (
    <section className={`metric-card ${tone}`}>
      <div className="metric-label">
        <span>{label}</span>
        <Icon size={16} aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
      {to && (
        <Link
          className="metric-link"
          to={to}
          aria-label={`View ${label.toLowerCase()}`}
        />
      )}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={22} aria-hidden="true" />}
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
