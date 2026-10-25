import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrfToken } from "./api";
import { Login, type AuthSession } from "./Login";
import "./styles.css";
import "./workspace.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

function AuthGate() {
  const client = useQueryClient();
  const location = useLocation();
  const auth = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      try {
        return await api<AuthSession>("/auth/session");
      } catch (error) {
        // Keep a locally running Phase 1–3 API usable during frontend-only
        // iteration. Production never falls back when its auth endpoint is absent.
        if (
          import.meta.env.DEV &&
          (error as { status?: number }).status === 404
        ) {
          return {
            auth_required: false,
            authenticated: true,
            csrf_token: null,
          };
        }
        throw error;
      }
    },
    retry: false,
  });
  useEffect(() => {
    setCsrfToken(auth.data?.csrf_token ?? null);
  }, [auth.data?.csrf_token]);
  if (auth.isPending)
    return <div className="auth-loading" aria-label="Checking session" />;
  if (auth.error)
    return (
      <main className="auth-error">
        <h1>RolePilot is unavailable</h1>
        <p>{auth.error.message}</p>
        <button onClick={() => void auth.refetch()}>Try again</button>
      </main>
    );
  if (auth.data?.auth_required && !auth.data.authenticated) {
    const dark = localStorage.getItem("rolepilot-theme") === "dark";
    return (
      <div className={`app auth-app${dark ? " dark" : ""}`}>
        <Login
          adminRoute={location.pathname.startsWith("/admin")}
          onAuthenticated={(session) =>
            client.setQueryData(["auth-session"], session)
          }
        />
      </div>
    );
  }
  return <App />;
}
