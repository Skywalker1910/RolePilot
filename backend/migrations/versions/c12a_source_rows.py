"""Preserve physical spreadsheet row numbers in previews."""

import sqlalchemy as sa
from alembic import op

revision = "c12a_source_rows"
down_revision = "be22522601e1"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_previews") as batch:
        batch.add_column(sa.Column("row_numbers", sa.JSON(), nullable=False, server_default="[]"))


def downgrade():
    with op.batch_alter_table("import_previews") as batch:
        batch.drop_column("row_numbers")
