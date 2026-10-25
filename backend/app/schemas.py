import re
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from .application_models import APPLICATION_STATUSES


def normalize(value: str) -> str:
    return " ".join(value.casefold().split())


def safe_url(value: str) -> str:
    if any(ord(c) < 32 for c in value) or "\\" in value:
        raise ValueError("URL contains invalid characters")
    HttpUrl(value)  # Validate host syntax as well as scheme before canonicalizing.
    parts = urlsplit(value.strip())
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        raise ValueError("A complete HTTP(S) company careers URL is required")
    if parts.username or parts.password:
        raise ValueError("URLs must not contain credentials")
    try:
        port = parts.port
    except ValueError as exc:
        raise ValueError("Invalid URL port") from exc
    host = parts.hostname.lower().encode("idna").decode()
    if ":" in host:
        host = f"[{host}]"
    netloc = host + (f":{port}" if port else "")
    query = urlencode(
        sorted(
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if not k.lower().startswith("utm_") and k.lower() not in {"gclid", "fbclid"}
        )
    )
    return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", query, ""))


class JobInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    company_name: str = Field(min_length=1, max_length=300)
    company_industry: str | None = None
    job_title: str = Field(min_length=1, max_length=500)
    canonical_job_url: str
    company_job_id: str | None = None
    external_job_id: str | None = None
    source_platform: str | None = None
    source_url: str | None = None
    city: str | None = None
    state: str | None = None
    country: str | None = None
    location: str | None = None
    remote_type: str | None = None
    employment_type: str | None = None
    seniority: str | None = None
    minimum_experience: float | None = Field(default=None, ge=0)
    maximum_experience: float | None = Field(default=None, ge=0)
    salary_min: float | None = Field(default=None, ge=0)
    salary_max: float | None = Field(default=None, ge=0)
    salary_currency: str | None = None
    salary_period: str | None = None
    education_requirement: str | None = None
    work_authorization_notes: str | None = None
    sponsorship_policy: str | None = None
    security_clearance_requirement: str | None = None
    citizenship_requirement: str | None = None
    remote_eligibility: str | None = None
    date_discovered: str | None = None
    qualifications: str | None = None
    job_summary: str | None = None
    application_questions: list[str] = Field(default_factory=list)
    data_confidence: str = "Unknown"
    verification_status: str = "Unverified"
    research_notes: str | None = None
    is_shortlisted: bool = False
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    job_keywords: list[str] = Field(default_factory=list)
    responsibilities: str | None = None
    full_description: str | None = None
    posted_at: str | None = None
    application_deadline: str | None = None
    source_checked_at: str | None = None

    @field_validator("*", mode="before")
    @classmethod
    def blanks(cls, value):
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("canonical_job_url", "source_url")
    @classmethod
    def urls(cls, value):
        return safe_url(value) if value else value

    @field_validator(
        "required_skills",
        "preferred_skills",
        "job_keywords",
        "application_questions",
        mode="before",
    )
    @classmethod
    def skills(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = re.split(r"[,;|\n]", value)
        return [str(v).strip() for v in value if str(v).strip()]

    @field_validator("posted_at", "application_deadline", "source_checked_at", "date_discovered")
    @classmethod
    def dates(cls, value):
        if not value:
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Use an ISO date or timestamp, e.g. 2026-10-15") from exc
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()

    @field_validator("remote_type", "employment_type")
    @classmethod
    def types(cls, value):
        if value is None:
            return value
        normalized = normalize(value).replace("-", " ")
        return {
            "full time": "Full-time",
            "part time": "Part-time",
            "on site": "On-site",
            "onsite": "On-site",
            "remote": "Remote",
            "hybrid": "Hybrid",
            "contract": "Contract",
            "internship": "Internship",
        }.get(normalized, value)

    @field_validator("data_confidence")
    @classmethod
    def confidence(cls, value):
        allowed = {"High", "Medium", "Low", "Unknown"}
        if value not in allowed:
            raise ValueError("Use High, Medium, Low, or Unknown")
        return value

    @field_validator("verification_status")
    @classmethod
    def verification(cls, value):
        allowed = {"Verified", "Unverified", "Needs Review"}
        if value not in allowed:
            raise ValueError("Use Verified, Unverified, or Needs Review")
        return value

    @model_validator(mode="after")
    def ranges(self):
        for low, high in [
            ("salary_min", "salary_max"),
            ("minimum_experience", "maximum_experience"),
        ]:
            a, b = getattr(self, low), getattr(self, high)
            if a is not None and b is not None and a > b:
                raise ValueError(f"{low} must not exceed {high}")
        return self


class ReviewRequest(BaseModel):
    mapping: dict[str, str]
    corrections: dict[int, dict[str, str | float | list[str] | None]] = Field(default_factory=dict)


class Decision(BaseModel):
    row_number: int
    action: str = Field(pattern="^(insert|update|skip)$")
    target_id: int | None = None
    expected_revision: int | None = None
    approve_conflicts: bool = False


class CommitRequest(BaseModel):
    decisions: list[Decision]


class EditRequest(BaseModel):
    job: JobInput
    expected_revision: int


class ArchiveRequest(BaseModel):
    archived: bool
    expected_revision: int


class ShortlistRequest(BaseModel):
    shortlisted: bool
    expected_revision: int


class ApplicationStart(BaseModel):
    priority: int = Field(default=3, ge=1, le=5)
    notes: str | None = None


class ManualApplication(BaseModel):
    job_id: int
    current_status: str = "Applied"
    applied_at: str | None = None
    priority: int = Field(default=3, ge=1, le=5)
    next_follow_up_at: str | None = None
    desired_salary: float | None = Field(default=None, ge=0)
    desired_salary_currency: str | None = Field(default=None, max_length=10)
    referral_status: str | None = None
    notes: str | None = None

    @field_validator("current_status")
    @classmethod
    def status(cls, value):
        if value not in APPLICATION_STATUSES:
            raise ValueError("Select a supported application stage")
        return value


class ApplicationStatusChange(BaseModel):
    new_status: str
    custom_stage_label: str | None = Field(default=None, max_length=120)
    notes: str | None = None

    @field_validator("new_status")
    @classmethod
    def status(cls, value):
        if value not in APPLICATION_STATUSES:
            raise ValueError("Select a supported application stage")
        return value


class ApplicationConfirmation(BaseModel):
    action: str = Field(pattern="^(applied|not_yet|archive|remind_later)$")
    notes: str | None = None


class ApplicationUpdate(BaseModel):
    expected_revision: int
    priority: int | None = Field(default=None, ge=1, le=5)
    next_follow_up_at: str | None = None
    desired_salary: float | None = Field(default=None, ge=0)
    desired_salary_currency: str | None = Field(default=None, max_length=10)
    referral_status: str | None = None
    notes: str | None = None


class ApplicationArchive(BaseModel):
    archived: bool
    expected_revision: int


class ApplicationTaskInput(BaseModel):
    task_type: str = Field(default="Follow up", min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=250)
    description: str | None = None
    due_at: str
    completed: bool = False


class CompanyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=300)
    industry: str | None = None
    website: str | None = None
    careers_page_url: str | None = None
    headquarters: str | None = None
    notes: str | None = None

    @field_validator("website", "careers_page_url")
    @classmethod
    def company_urls(cls, value):
        return safe_url(value) if value else value


class CompanyPatch(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expected_revision: int
    name: str | None = Field(default=None, min_length=1, max_length=300)
    industry: str | None = None
    website: str | None = None
    careers_page_url: str | None = None
    headquarters: str | None = None
    notes: str | None = None

    @field_validator("website", "careers_page_url")
    @classmethod
    def company_urls(cls, value):
        return safe_url(value) if value else value


class JobPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int
    job: JobInput
