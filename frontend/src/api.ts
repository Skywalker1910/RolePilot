export type Value = string | number | string[] | null;
let csrfToken: string | null = null;
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export type JobInput = {
  company_name: string;
  job_title: string;
  canonical_job_url: string;
  required_skills: string[];
  preferred_skills: string[];
  [key: string]: Value;
};
export type Job = JobInput & {
  id: number;
  company_id: number;
  revision: number;
  imported_at: string;
  updated_at: string;
  archived_at: string | null;
  listing_status: "Available" | "Unavailable" | "Removed";
  locally_edited_fields: string[];
};
export type Provenance = {
  batch_id: number | null;
  row_number: number | null;
  created_at: string;
  original_fields: Record<string, Value>;
};
export type JobDetail = Omit<Job, "provenance"> & { provenance: Provenance[] };
export type Candidate = {
  id: number;
  revision: number;
  company_name: string;
  job_title: string;
};
export type ReviewRow = {
  row_number: number;
  raw: Record<string, string>;
  data: JobInput;
  errors: string[];
  warnings: string[];
  duplicate_kind: "exact" | "possible" | null;
  candidates: Candidate[];
  conflicts: Record<
    string,
    Record<string, { current: Value; incoming: Value; locally_edited: boolean }>
  >;
};
export type Preview = {
  id: string;
  filename: string;
  mapping: Record<string, string>;
  rows: ReviewRow[];
  fields: string[];
  worksheets?: string[];
  worksheet_name?: string | null;
};
export type Decision = {
  row_number: number;
  action: "insert" | "update" | "skip";
  target_id?: number;
  expected_revision?: number;
  approve_conflicts: boolean;
};
export type Batch = {
  id: number;
  filename: string;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  created_at: string;
  validation_errors?: { row: number; errors: string[] }[];
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "x-rolepilot": "local",
      ...(csrfToken && options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase())
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    const detail = body.detail;
    const message = typeof detail === "string" ? detail : detail?.message || JSON.stringify(detail);
    const error = new Error(message) as Error & { status: number; body: unknown };
    error.status = response.status;
    error.body = detail;
    throw error;
  }
  return response.json();
}
export const post = <T>(path: string, data: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data) });
export function date(value: Value | undefined) {
  return typeof value === "string" && value
    ? new Date(value).toLocaleString()
    : "Not specified";
}
export function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
export function display(value: Value | undefined) {
  return Array.isArray(value)
    ? value.join(", ")
    : value === null || value === undefined || value === ""
      ? "Not specified"
      : String(value);
}
export function validUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
