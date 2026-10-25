import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "./api";
import { Button } from "./components/ui/button";

type User = {
  id: number;
  username: string;
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

export function AdminPage() {
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
    mutationFn: ({ id, role, is_active }: Pick<User, "id" | "role" | "is_active">) =>
      api(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role, is_active }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="workspace-page admin-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ROLEPILOT</div>
          <h1>Administration</h1>
          <p>Manage accounts and the one-time codes used to create them.</p>
        </div>
      </div>

      <section className="panel panel-padding">
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
      </section>

      <section className="panel panel-padding">
        <h2>Accounts</h2>
        <p className="muted">Inactive accounts cannot sign in. Account data is retained when access is turned off.</p>
        {users.error && <p role="alert" className="error">{users.error.message}</p>}
        {update.error && <p role="alert" className="error">{update.error.message}</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Username</th><th>Role</th><th>Access</th><th>Joined</th><th>Invitation</th><th>Action</th></tr></thead>
            <tbody>
              {(users.data ?? []).map((user) => (
                <UserRow key={user.id} user={user} busy={update.isPending} onSave={(next) => update.mutate({ id: user.id, ...next })} />
              ))}
              {users.data?.length === 0 && <tr><td colSpan={6}>No accounts found.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
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
  onSave: (value: Pick<User, "role" | "is_active">) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  useEffect(() => {
    setRole(user.role);
    setIsActive(user.is_active);
  }, [user.role, user.is_active]);
  const changed = role !== user.role || isActive !== user.is_active;
  return (
    <tr>
      <td>{user.username}</td>
      <td><select aria-label={`Role for ${user.username}`} value={role} onChange={(event) => setRole(event.target.value as User["role"])}><option value="user">User</option><option value="admin">Admin</option></select></td>
      <td><label className="admin-active"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active</label></td>
      <td>{new Date(user.created_at).toLocaleDateString()}</td>
      <td>{user.invitation_id ? `Invitation ${user.invitation_id}` : "Owner account"}</td>
      <td><Button variant="outline" disabled={!changed || busy} onClick={() => onSave({ role, is_active: isActive })}>Save</Button></td>
    </tr>
  );
}
