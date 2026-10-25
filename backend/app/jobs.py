from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import utcnow
from .models import ActivityEvent, Company, Job, JobProvenance, JobSkill, Skill
from .schemas import JobInput, normalize

SKILL_ALIASES = {
    "pytorch": "PyTorch",
    "scikit learn": "scikit-learn",
    "scikit-learn": "scikit-learn",
    "sklearn": "scikit-learn",
    "aws": "AWS",
    "amazon web services": "AWS",
    "llm": "LLM",
    "llms": "LLMs",
    "mlops": "MLOps",
    "nlp": "NLP",
    "sql": "SQL",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "javascript": "JavaScript",
    "typescript": "TypeScript",
    "fastapi": "FastAPI",
    "api": "API",
    "apis": "APIs",
    "kubernetes": "Kubernetes",
    "docker": "Docker",
    "mlflow": "MLflow",
    "machine learning": "Machine Learning",
    "deep learning": "Deep Learning",
    "node.js": "Node.js",
    "react": "React",
    "c++": "C++",
    "c#": "C#",
}


def canonical_skill(value: str) -> tuple[str, str]:
    normalized = normalize(value)
    canonical = SKILL_ALIASES.get(normalized, " ".join(value.split()))
    return canonical, normalize(canonical)


def job_data(job: Job):
    data = {
        field: getattr(job, field)
        for field in JobInput.model_fields
        if field
        not in {
            "company_name",
            "company_industry",
            "required_skills",
            "preferred_skills",
            "job_keywords",
        }
    }
    data["company_name"] = job.company.name
    data["company_industry"] = job.company.industry
    data["listing_status"] = job.listing_status
    for kind, field in (
        ("Required", "required_skills"),
        ("Preferred", "preferred_skills"),
        ("Keyword", "job_keywords"),
    ):
        data[field] = sorted(
            (s.skill.canonical_name or s.skill.name) for s in job.skills if s.kind == kind
        )
    return data


def serialize(job: Job, detail=False):
    result = job_data(job) | {
        "id": job.id,
        "company_id": job.company_id,
        "revision": job.revision,
        "imported_at": job.imported_at,
        "updated_at": job.updated_at,
        "archived_at": job.archived_at,
        "locally_edited_fields": job.locally_edited_fields,
    }
    result.update(
        {
            "job_id": result["company_job_id"],
            "job_url": result["canonical_job_url"],
            "work_mode": result["remote_type"],
            "experience_min": result["minimum_experience"],
            "experience_max": result["maximum_experience"],
            "date_posted": result["posted_at"],
            "date_verified": result["source_checked_at"],
            "security_clearance": result["security_clearance_requirement"],
        }
    )
    if detail:
        result["provenance"] = [
            {
                "batch_id": p.batch_id,
                "row_number": p.row_number,
                "original_fields": p.original_fields,
                "imported_fields": p.imported_fields,
                "created_at": p.created_at,
            }
            for p in job.provenance
        ]
    return result


def company_for(session: Session, name: str, industry: str | None = None):
    key = normalize(name)
    company = session.scalar(select(Company).where(Company.normalized_name == key))
    if not company:
        company = Company(name=name.strip(), normalized_name=key, industry=industry)
        session.add(company)
        session.flush()
    elif industry:
        # Industry is shared company metadata; only explicit nonblank input updates it.
        company.industry = industry
    return company


def duplicates(session: Session, data: JobInput):
    company = session.scalar(
        select(Company).where(Company.normalized_name == normalize(data.company_name))
    )
    exact = []
    if company and data.company_job_id:
        exact += list(
            session.scalars(
                select(Job).where(
                    Job.company_id == company.id,
                    Job.normalized_requisition == normalize(data.company_job_id),
                )
            )
        )
    by_url = session.scalar(select(Job).where(Job.canonical_job_url == data.canonical_job_url))
    if by_url and by_url not in exact:
        exact.append(by_url)
    if exact:
        return "exact", exact
    possible = (
        []
        if not company
        else list(
            session.scalars(
                select(Job).where(
                    Job.company_id == company.id,
                    Job.normalized_title == normalize(data.job_title),
                )
            )
        )
    )
    possible = [
        j
        for j in possible
        if all(
            normalize(getattr(j, f) or "") == normalize(getattr(data, f) or "")
            for f in ("city", "state", "country")
        )
    ]
    return ("possible" if possible else None), possible


def write_job(
    session, data: JobInput, job=None, *, local=False, batch_id=None, raw=None, row_number=None
):
    before = job_data(job) if job else {}
    if job is None:
        job = Job(company=company_for(session, data.company_name, data.company_industry))
        session.add(job)
    else:
        job.company = company_for(session, data.company_name, data.company_industry)
        job.revision += 1
    values = data.model_dump()
    for field, value in values.items():
        if field not in {
            "company_name",
            "company_industry",
            "required_skills",
            "preferred_skills",
            "job_keywords",
        }:
            setattr(job, field, value)
    job.normalized_title = normalize(data.job_title)
    job.normalized_requisition = normalize(data.company_job_id) if data.company_job_id else None
    if local:
        job.locally_edited_fields = sorted(
            set(job.locally_edited_fields or [])
            | {key for key, value in values.items() if before.get(key) != value}
        )
    job.updated_at = utcnow()
    # Flush deleted join rows before re-adding the same composite identity.
    job.skills.clear()
    session.flush()
    for kind, field in (
        ("Required", "required_skills"),
        ("Preferred", "preferred_skills"),
        ("Keyword", "job_keywords"),
    ):
        seen_names = set()
        for raw_name in values[field]:
            canonical, normalized_name = canonical_skill(raw_name)
            if normalized_name in seen_names:
                continue
            seen_names.add(normalized_name)
            skill = session.scalar(select(Skill).where(Skill.normalized_name == normalized_name))
            if not skill:
                skill = Skill(
                    name=canonical,
                    canonical_name=canonical,
                    normalized_name=normalized_name,
                )
                session.add(skill)
                session.flush()
            job.skills.append(JobSkill(skill=skill, kind=kind))
    job.provenance.append(
        JobProvenance(
            batch_id=batch_id,
            row_number=row_number,
            original_fields=raw if raw is not None else values,
            imported_fields=values,
        )
    )
    session.add(
        ActivityEvent(
            event_type="job.updated" if before else "job.created",
            message=f"{data.company_name} · {data.job_title}",
        )
    )
    session.flush()
    return job
