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
        Overview
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
        Opportunities
      </NavLink>
      <NavLink
        to="/applications"
        title="Applications"
        aria-label="Applications"
      >
        <BriefcaseBusiness />
        Applications
      </NavLink>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Network — coming soon"
      >
        <Users />
        Network<small>Soon</small>
      </span>
      <NavLink to="/documents" title="Documents" aria-label="Documents">
        <FileText />
        Documents
      </NavLink>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Interviews — coming soon"
      >
        <CalendarDays />
        Interviews<small>Soon</small>
      </span>
      <div className="nav-group-label">MORE</div>
      <span
        className="nav-disabled"
        aria-disabled="true"
        title="Analytics — coming soon"
      >
        <ChartNoAxesCombined />
        Analytics<small>Soon</small>
      </span>
      <NavLink to="/archive" title="Archive" aria-label="Archive">
        <Archive />
        Archive
      </NavLink>
      <NavLink to="/settings" title="Settings" aria-label="Settings">
        <Settings />
        Settings
      </NavLink>
    </nav>
  );
}
