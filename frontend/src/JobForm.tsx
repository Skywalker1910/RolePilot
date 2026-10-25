import { useState, type FormEvent } from "react";
import { label, type JobInput, type Value, validUrl } from "./api";
import { Button } from "./components/ui/button";

export const fields = [
  "company_name",
  "job_title",
  "canonical_job_url",
  "company_job_id",
  "company_industry",
  "location",
  "city",
  "state",
  "country",
  "remote_type",
  "employment_type",
  "seniority",
  "salary_min",
  "salary_max",
  "salary_currency",
  "salary_period",
  "minimum_experience",
  "maximum_experience",
  "required_skills",
  "preferred_skills",
  "job_keywords",
  "sponsorship_policy",
  "work_authorization_notes",
  "security_clearance_requirement",
  "education_requirement",
  "citizenship_requirement",
  "remote_eligibility",
  "verification_status",
  "data_confidence",
  "date_discovered",
  "qualifications",
  "job_summary",
  "application_questions",
  "research_notes",
  "full_description",
  "responsibilities",
  "source_platform",
  "source_url",
  "external_job_id",
  "posted_at",
  "application_deadline",
  "source_checked_at",
];
const numbers = [
  "salary_min",
  "salary_max",
  "minimum_experience",
  "maximum_experience",
];
export const emptyJob: JobInput = {
  company_name: "",
  job_title: "",
  canonical_job_url: "",
  required_skills: [],
  preferred_skills: [],
};
export function JobForm({
  initial = emptyJob,
  onSave,
  busy = false,
  submitLabel = "Save job",
}: {
  initial?: JobInput;
  onSave: (data: JobInput) => Promise<unknown> | void;
  busy?: boolean;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, Value>>(() =>
    Object.fromEntries(fields.map((f) => [f, initial[f] ?? ""])),
  );
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!validUrl(String(values.canonical_job_url))) {
      setError("Enter a complete HTTP(S) employer job URL.");
      return;
    }
    const data = Object.fromEntries(
      fields.map((f) => [
        f,
        f.endsWith("_skills")
          ? Array.isArray(values[f])
            ? values[f]
            : String(values[f] || "")
                .split(/[,;|\n]/)
                .map((v) => v.trim())
                .filter(Boolean)
          : numbers.includes(f)
            ? values[f] === "" || values[f] === null
              ? null
              : Number(values[f])
            : values[f] || null,
      ]),
    ) as JobInput;
    if (
      data.salary_min !== null &&
      data.salary_max !== null &&
      Number(data.salary_min) > Number(data.salary_max)
    ) {
      setError("Minimum salary must not exceed maximum salary.");
      return;
    }
    try {
      await onSave(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="job-form">
      <p className="muted">
        Keep unknown values blank. Required fields are marked *. Dates use ISO
        format; skills use commas or semicolons.
      </p>
      <div className="form-grid">
        {fields.map((field) => {
          const required = [
            "company_name",
            "job_title",
            "canonical_job_url",
          ].includes(field);
          const value = values[field];
          const text = Array.isArray(value) ? value.join("; ") : (value ?? "");
          return (
            <label
              className={
                [
                  "full_description",
                  "responsibilities",
                  "qualifications",
                  "job_summary",
                  "research_notes",
                  "canonical_job_url",
                ].includes(field)
                  ? "span-two"
                  : ""
              }
              key={field}
            >
              {label(field)}
              {required ? " *" : ""}
              {["full_description", "responsibilities", "qualifications", "job_summary", "research_notes"].includes(field) ? (
                <textarea
                  rows={5}
                  value={text}
                  onChange={(e) =>
                    setValues({ ...values, [field]: e.target.value })
                  }
                />
              ) : (
                <input
                  required={required}
                  type={numbers.includes(field) ? "number" : "text"}
                  min={numbers.includes(field) ? 0 : undefined}
                  step="any"
                  value={text}
                  onChange={(e) =>
                    setValues({ ...values, [field]: e.target.value })
                  }
                />
              )}
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-footer">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
