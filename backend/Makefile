# Database / migration helpers. Run from backend/ (where alembic.ini lives).
# Reads DATABASE_URL from the environment / ../.env.
.PHONY: migrate seed revision downgrade

# Apply all migrations up to the latest revision.
migrate:
	alembic upgrade head

# Create/refresh baseline rows (admin, model_settings, ai_models). Idempotent.
seed:
	python -m scripts.seed

# Autogenerate a new migration:  make revision m="add widgets table"
revision:
	alembic revision --autogenerate -m "$(m)"

# Roll back the most recent migration.
downgrade:
	alembic downgrade -1
