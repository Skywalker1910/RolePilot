import { useState } from "react";
import type { FormEvent } from "react";
import { Compass, LockKeyhole } from "lucide-react";
import { api, setCsrfToken } from "./api";
import { Button } from "./components/ui/button";

export type AuthSession = {
  auth_required: boolean;
  authenticated: boolean;
  csrf_token: string | null;
  user?: { id: number; username: string; role: "admin" | "user" } | null;
};

export function Login({
  onAuthenticated,
  adminRoute = false,
}: {
  onAuthenticated: (session: AuthSession) => void;
  adminRoute?: boolean;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [signingUp, setSigningUp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api<AuthSession>(signingUp ? "/auth/signup" : "/auth/login", {
        method: "POST",
        body: JSON.stringify(
          signingUp
            ? { username, password, invitation_code: invitationCode }
            : { username, password },
        ),
      });
      setCsrfToken(result.csrf_token ?? null);
      onAuthenticated({ ...result, auth_required: true, authenticated: true });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <main className="auth-card">
        <div className="brand auth-brand"><span className="brand-mark"><Compass size={21} /></span><span>Role<span className="brand-light">Pilot</span><small>YOUR NEXT CHAPTER</small></span></div>
        <div className="auth-lock"><LockKeyhole size={18} /></div>
        <h1>{signingUp ? "Create an account" : adminRoute ? "Administrator sign-in" : "Welcome back"}</h1>
        <p>{signingUp ? "Use an invitation code from a RolePilot administrator." : adminRoute ? "Sign in with an active administrator account to manage users." : "Sign in to your career workspace."}</p>
        <form onSubmit={(event) => void submit(event)}>
          <label>Username<input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>Password<input autoComplete={signingUp ? "new-password" : "current-password"} type="password" minLength={signingUp ? 14 : 1} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {signingUp && <label>Invitation code<input autoComplete="off" required value={invitationCode} onChange={(event) => setInvitationCode(event.target.value)} /></label>}
          {error && <p role="alert" className="error compact">{error}</p>}
          <Button disabled={busy}>{busy ? "Please wait…" : signingUp ? "Create account" : "Sign in"}</Button>
        </form>
        {!adminRoute && (
          <button className="text-action auth-switch" type="button" onClick={() => { setSigningUp(!signingUp); setError(""); }}>
            {signingUp ? "Already have an account? Sign in" : "Have an invitation code? Create an account"}
          </button>
        )}
      </main>
    </div>
  );
}
