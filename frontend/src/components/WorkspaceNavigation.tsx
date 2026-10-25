import {
  Archive,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";

export function WorkspaceNavigation({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  return (
    <nav aria-label="Workspace navigation" onClick={onNavigate}>
      <div className="nav-group-label">WORKSPACE</div>
      <NavLink to="/" end title="Overview" aria-label="Overview">
        <LayoutDashboard />
        <span>Overview</span>
      </NavLink>
      <NavLink
        to="/jobs"
        title="Opportunities"
        aria-label="Opportunities"
        className={
          ["/companies", "/imports"].includes(pathname) ? "active" : undefined
        }
      >
        <BriefcaseBusiness />
        <span>Opportunities</span>
      </NavLink>
      <NavLink
        to="/applications"
        title="Applications"
        aria-label="Applications"
      >
        <BriefcaseBusiness />
        <span>Applications</span>
      </NavLink>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Network — coming soon"
      >
        <Users />
        <span>Network</span><small>Soon</small>
      </span>
      <NavLink to="/documents" title="Documents" aria-label="Documents">
        <FileText />
        <span>Documents</span>
      </NavLink>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Interviews — coming soon"
      >
        <CalendarDays />
        <span>Interviews</span><small>Soon</small>
      </span>
      <div className="nav-group-label">MORE</div>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Analytics — coming soon"
      >
        <ChartNoAxesCombined />
        <span>Analytics</span><small>Soon</small>
      </span>
      <NavLink to="/archive" title="Archive" aria-label="Archive">
        <Archive />
        <span>Archive</span>
      </NavLink>
      <NavLink to="/settings" title="Settings" aria-label="Settings">
        <Settings />
        <span>Settings</span>
      </NavLink>
    </nav>
  );
}
