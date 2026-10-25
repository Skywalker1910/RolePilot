import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { Button } from "./components/ui/button";

type Profile = {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: "admin" | "user";
  created_at: string;
  password_changed_at: string;
};

export function ProfilePage({ adminMode = false }: { adminMode?: boolean }) {
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<Profile>("/auth/profile"),
  });
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!profile.data) return;
    setDisplayName(profile.data.display_name ?? "");
    setEmail(profile.data.email ?? "");
  }, [profile.data]);

  const update = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      api<Profile>("/auth/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: async (result) => {
      client.setQueryData(["profile"], result);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice("Profile updated.");
      await client.invalidateQueries({ queryKey: ["auth-session"] });
    },
  });

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    update.mutate({ display_name: displayName.trim() || null, email: email.trim() || null });
  }

  function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    if (newPassword !== confirmPassword) {
      setNotice("The new passwords do not match.");
      return;
    }
    update.mutate({ current_password: currentPassword, new_password: newPassword });
  }

  return (
    <div className="workspace-page profile-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCOUNT</div>
          <h1>Profile</h1>
          <p>Manage your account details and password.</p>
        </div>
        {adminMode && <Link className="button button-outline" to="/admin">Back to admin</Link>}
      </div>
      {profile.error && <p role="alert" className="error">{profile.error.message}</p>}
      {notice && <p role="status" className={notice.includes("match") ? "error" : "notice"}>{notice}</p>}
      {update.error && <p role="alert" className="error">{update.error.message}</p>}
      {profile.data && (
        <>
          <section className="panel panel-padding profile-section">
            <h2>Account details</h2>
            <p className="muted">My username is fixed for this account. An administrator can change it.</p>
            <form onSubmit={saveProfile} className="profile-form">
              <label>Username<input value={profile.data.username} readOnly aria-readonly="true" /></label>
              <label>Display name<input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} /></label>
              <label>Email<input type="email" autoComplete="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} /></label>
              <div className="profile-meta">
                <span>Role: <strong>{profile.data.role === "admin" ? "Administrator" : "User"}</strong></span>
                <span>Joined: <strong>{new Date(profile.data.created_at).toLocaleDateString()}</strong></span>
              </div>
              <Button disabled={update.isPending}>{update.isPending ? "Saving…" : "Save profile"}</Button>
            </form>
          </section>

          <section className="panel panel-padding profile-section">
            <h2>Change password</h2>
            <p className="muted">Use at least 14 characters. Other signed-in sessions will be signed out.</p>
            <form onSubmit={changePassword} className="profile-form">
              <label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>New password<input type="password" autoComplete="new-password" minLength={14} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>Confirm new password<input type="password" autoComplete="new-password" minLength={14} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
              <Button disabled={update.isPending}>{update.isPending ? "Updating…" : "Update password"}</Button>
            </form>
            <p className="muted profile-password-date">Last changed: {new Date(profile.data.password_changed_at).toLocaleString()}</p>
          </section>
        </>
      )}
    </div>
  );
}
