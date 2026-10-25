from alembic import context
from app import application_models, auth_models, library_models, models  # noqa: F401
from app.db import Base, engine

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
