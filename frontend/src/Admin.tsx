import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, KeyRound, LayoutDashboard, LogOut, Moon, ShieldCheck, Sun, UserRound, Users } from "lucide-react";
import { api, post } from "./api";
import { Button } from "./components/ui/button";
import { ProfilePage } from "./Profile";

type AdminUser = { id: number; username: string; role: "admin" | "user"; };

export function AdminPortal({
  user,
  onLogout,
  dark,
  toggleTheme,
}: {
  user: AdminUser;
  onLogout: () => void;
  dark: boolean;
  toggleTheme: () => void;
}) {
  const location = useLocation();
  if (!location.pathname.startsWith("/admin")) return <Navigate to="/admin" replace />;
  const title = location.pathname.startsWith("/admin/users")
    ? "Users"
    : location.pathname.startsWith("/admin/invitations")
      ? "Invitation codes"
      : location.pathname.startsWith("/admin/profile")
        ? "My profile"
        : "Admin dashboard";
  return (
    <div className={`app admin-app${dark ? " dark" : ""}`}>
      <aside className="admin-sidebar">
        <Link to="/admin" className="admin-brand">
          <span className="brand-mark"><Compass size={20} /></span>
          <span>RolePilot<small>ADMIN CONSOLE</small></span>
        </Link>
        <div className="admin-scope"><ShieldCheck size={15} /><span>User management only</span></div>
        <nav aria-label="Administration navigation">
          <NavLink to="/admin" end aria-label="Dashboard" title="Dashboard"><LayoutDashboard size={17} />Dashboard</NavLink>
          <NavLink to="/admin/users" aria-label="Users" title="Users"><Users size={17} />Users</NavLink>
          <NavLink to="/admin/invitations" aria-label="Invitation codes" title="Invitation codes"><KeyRound size={17} />Invitation codes</NavLink>
        </nav>
        <div className="admin-sidebar-bottom">
          <Link to="/admin/profile" className="admin-account-link">
            <span className="avatar">{user.username.slice(0, 2).toUpperCase()}</span>
            <span>{user.username}<small>Administrator profile</small></span>
            <UserRound size={16} />
          </Link>
          <button className="admin-logout" onClick={onLogout}><LogOut size={16} />Sign out</button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div><span>ADMINISTRATION</span><h1>{title}</h1></div>
          <button className="icon-button" onClick={toggleTheme} aria-label={dark ? "Use light theme" : "Use dark theme"}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>
        <main id="main-content" className="admin-content">
          <Routes>
            <Route path="/admin" element={<AdminPage section="overview" />} />
            <Route path="/admin/users" element={<AdminPage section="users" />} />
            <Route path="/admin/invitations" element={<AdminPage section="invitations" />} />
            <Route path="/admin/profile" element={<ProfilePage adminMode />} />
            <Route path="/admin/*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

type User = {
  id: number;
  username: string;
  display_name?: string | null;
  email?: string | null;
  role: "admin" | "user";
  is_active: boolean;
  created_at: string;
  password_changed_at: string;
  invitation_id: number | null;
};
type Invitation = {
  id: number;
  status: "unused" | "used" | "revoked";
  created_by: string;
  created_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
};

export function AdminPage({ section = "all" }: { section?: "all" | "overview" | "users" | "invitations" }) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api<User[]>("/admin/users"),
  });
  const invitations = useQuery({
    queryKey: ["admin-invitations"],
    queryFn: () => api<Invitation[]>("/admin/invitations"),
  });
  const create = useMutation({
    mutationFn: () => post<{ id: number; code: string }>("/admin/invitations", {}),
    onSuccess: async (result) => {
      setCode(result.code);
      await client.invalidateQueries({ queryKey: ["admin-invitations"] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: number) =>
      api(`/admin/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-invitations"] }),
  });
  const update = useMutation({
    mutationFn: ({ id, username, role, is_active }: Pick<User, "id" | "username" | "role" | "is_active">) =>
      api(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ username, role, is_active }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["admin-users"] }),
        client.invalidateQueries({ queryKey: ["auth-session"] }),
      ]);
    },
  });

  return (
    <div className="workspace-page admin-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ROLEPILOT</div>
          <h1>Administration</h1>
          <p>{section === "overview" ? "Manage access to the hosted RolePilot service." : "Manage accounts and the one-time codes used to create them."}</p>
        </div>
      </div>

      {section === "overview" && (
        <>
          <div className="primary-metrics admin-metrics">
            <div className="metric-card"><span>Accounts</span><strong>{users.data?.length ?? "—"}</strong></div>
            <div className="metric-card"><span>Active accounts</span><strong>{users.data?.filter((user) => user.is_active).length ?? "—"}</strong></div>
            <div className="metric-card"><span>Unused invitations</span><strong>{invitations.data?.filter((item) => item.status === "unused").length ?? "—"}</strong></div>
          </div>
          <div className="admin-shortcuts">
            <Link to="/admin/users" className="panel panel-padding"><strong>Manage users</strong><span>Roles, account access, and usernames</span></Link>
            <Link to="/admin/invitations" className="panel panel-padding"><strong>Invitation codes</strong><span>Create, review, and revoke unused codes</span></Link>
          </div>
        </>
      )}

      {(section === "all" || section === "invitations") && <section className="panel panel-padding">
        <div className="section-heading">
          <div><h2>Invitation codes</h2><p className="muted">Each code can create one account. The full code is shown only when it is created.</p></div>
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "Create invitation"}
          </Button>
        </div>
        {code && (
          <div className="invitation-created" role="status">
            <strong>Copy this code now. It will not be shown again.</strong>
            <code>{code}</code>
            <Button variant="outline" onClick={() => void navigator.clipboard.writeText(code)}>Copy code</Button>
            <button className="text-action" onClick={() => setCode("")}>Hide code</button>
          </div>
        )}
        {create.error && <p role="alert" className="error">{create.error.message}</p>}
        {revoke.error && <p role="alert" className="error">{revoke.error.message}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Status</th><th>Created by</th><th>Created</th><th>Used by</th><th>Action</th></tr></thead>
            <tbody>
              {(invitations.data ?? []).map((item) => (
                <tr key={item.id}>
                  <td>Invitation {item.id}</td><td>{item.status}</td><td>{item.created_by}</td>
                  <td>{new Date(item.created_at).toLocaleString()}</td><td>{item.used_by ?? "—"}</td>
                  <td>{item.status === "unused" ? <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)}>Revoke</Button> : "—"}</td>
                </tr>
              ))}
              {invitations.data?.length === 0 && <tr><td colSpan={6}>No invitation codes yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {(section === "all" || section === "users") && <section className="panel panel-padding">
        <h2>Accounts</h2>
        <p className="muted">Usernames can only be changed here. Inactive accounts cannot sign in; their data is retained.</p>
        {users.error && <p role="alert" className="error">{users.error.message}</p>}
        {update.error && <p role="alert" className="error">{update.error.message}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Username</th><th>Profile</th><th>Role</th><th>Access</th><th>Joined</th><th>Invitation</th><th>Action</th></tr></thead>
            <tbody>
              {(users.data ?? []).map((user) => (
                <UserRow key={user.id} user={user} busy={update.isPending} onSave={(next) => update.mutate({ id: user.id, ...next })} />
              ))}
              {users.data?.length === 0 && <tr><td colSpan={7}>No accounts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}
    </div>
  );
}

function UserRow({
  user,
  busy,
  onSave,
}: {
  user: User;
  busy: boolean;
  onSave: (value: Pick<User, "username" | "role" | "is_active">) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [username, setUsername] = useState(user.username);
  const [isActive, setIsActive] = useState(user.is_active);
  useEffect(() => {
    setRole(user.role);
    setUsername(user.username);
    setIsActive(user.is_active);
  }, [user.username, user.role, user.is_active]);
  const changed = username !== user.username || role !== user.role || isActive !== user.is_active;
  return (
    <tr>
      <td><input aria-label={`Username for ${user.username}`} value={username} maxLength={120} onChange={(event) => setUsername(event.target.value)} /></td>
      <td>{user.display_name || "—"}{user.email && <small className="admin-user-email">{user.email}</small>}</td>
      <td><select aria-label={`Role for ${user.username}`} value={role} onChange={(event) => setRole(event.target.value as User["role"])}><option value="user">User</option><option value="admin">Admin</option></select></td>
      <td><label className="admin-active"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active</label></td>
      <td>{new Date(user.created_at).toLocaleDateString()}</td>
      <td>{user.invitation_id ? `Invitation ${user.invitation_id}` : "Owner account"}</td>
      <td><Button variant="outline" disabled={!changed || busy || !username.trim()} onClick={() => onSave({ username: username.trim(), role, is_active: isActive })}>Save</Button></td>
    </tr>
  );
}
