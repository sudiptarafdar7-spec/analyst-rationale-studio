#!/usr/bin/env bash
###############################################################################
# Analyst Rationale Studio — first-time VPS deploy
#
# Run ONCE on a fresh Ubuntu 22.04/24.04 server as root:
#
#   curl -fsSL https://raw.githubusercontent.com/sudiptarafdar7-spec/analyst-rationale-studio/main/deploy.sh | bash
#
# It installs everything (Python, Node, PostgreSQL, nginx, certbot), clones the
# repo, creates the database, builds the frontend, wires systemd + nginx, seeds
# the admin user and obtains an HTTPS certificate.
#
# Idempotent: re-running is safe. It will NOT overwrite an existing .env, and
# will NOT reset the admin password if the user already exists.
# For routine code updates use update.sh instead.
###############################################################################
set -euo pipefail

# ----------------------------------------------------------------------------- config
REPO_URL="${REPO_URL:-https://github.com/sudiptarafdar7-spec/analyst-rationale-studio.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/analyst-rationale-studio}"
DOMAIN="${DOMAIN:-researchrationale.in}"
LE_EMAIL="${LE_EMAIL:-admin@phdcapital.in}"

DB_NAME="${DB_NAME:-ars}"
DB_USER="${DB_USER:-ars}"

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@phdcapital.in}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@123}"
ADMIN_FIRST_NAME="${ADMIN_FIRST_NAME:-Pradip}"
ADMIN_LAST_NAME="${ADMIN_LAST_NAME:-Halder}"

SERVICE="ars-backend"
BACKEND_PORT="8000"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then echo "Run as root (sudo bash deploy.sh)"; exit 1; fi

# ----------------------------------------------------------------------------- 1. system packages
say "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  git curl ca-certificates gnupg build-essential \
  python3 python3-venv python3-dev libpq-dev \
  postgresql postgresql-contrib \
  nginx ffmpeg

# Node.js 20 (NodeSource) — only if node is missing or too old
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]]; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# certbot via snap (most reliable across Ubuntu versions); fall back to apt
if ! command -v certbot >/dev/null 2>&1; then
  say "Installing certbot"
  if command -v snap >/dev/null 2>&1; then
    snap install core >/dev/null 2>&1 || true
    snap install --classic certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
    ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
  else
    apt-get install -y certbot python3-certbot-nginx
  fi
fi

systemctl enable --now postgresql

# ----------------------------------------------------------------------------- 2. clone / update repo
if [[ -d "${APP_DIR}/.git" ]]; then
  say "Repo already present — fetching latest (${BRANCH})"
  git -C "${APP_DIR}" fetch --depth 1 origin "${BRANCH}"
  git -C "${APP_DIR}" reset --hard "origin/${BRANCH}"
else
  say "Cloning ${REPO_URL}"
  rm -rf "${APP_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi
cd "${APP_DIR}"

# ----------------------------------------------------------------------------- 3. database
say "Configuring PostgreSQL database '${DB_NAME}'"
DB_PASSWORD=""
ENV_FILE="${APP_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  # reuse existing DB password so we don't lock ourselves out
  DB_PASSWORD="$(grep -oP 'postgresql\+psycopg2://[^:]+:\K[^@]+' "${ENV_FILE}" | head -1 || true)"
fi
if [[ -z "${DB_PASSWORD}" ]]; then
  DB_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;
SQL
# create DB if absent, owned by the app role
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

# The app role owns the database but is NOT a superuser, so it cannot install
# extensions and (on PostgreSQL 15+) cannot create objects in the public schema.
# Install the extensions as the superuser and hand the public schema to the app
# role so Alembic can create types/tables as the owner.
sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${DB_NAME}" <<SQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
ALTER SCHEMA public OWNER TO ${DB_USER};
GRANT ALL ON SCHEMA public TO ${DB_USER};
SQL

# ----------------------------------------------------------------------------- 4. .env (created once, kept on re-run)
if [[ ! -f "${ENV_FILE}" ]]; then
  say "Writing ${ENV_FILE}"
  JWT_SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
  FERNET_KEY="$(python3 - <<'PY'
try:
    from cryptography.fernet import Fernet
    print(Fernet.generate_key().decode())
except Exception:
    import base64, os
    print(base64.urlsafe_b64encode(os.urandom(32)).decode())
PY
)"
  cat > "${ENV_FILE}" <<ENV
# Generated by deploy.sh — infrastructure secrets only. Provider API keys are
# managed in-app (Admin > Manage API Keys), never here.
DATABASE_URL=postgresql+psycopg2://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
APP_ENCRYPTION_KEY=${FERNET_KEY}
ACCESS_TOKEN_MINUTES=30
REFRESH_TOKEN_DAYS=14
FRONTEND_ORIGIN=https://${DOMAIN}
JOB_FILES_DIR=job_files
UPLOAD_DIR=uploads
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_FIRST_NAME=${ADMIN_FIRST_NAME}
ADMIN_LAST_NAME=${ADMIN_LAST_NAME}
ENV
  chmod 600 "${ENV_FILE}"
else
  warn ".env already exists — leaving it untouched"
fi

# ----------------------------------------------------------------------------- 5. python venv + deps
say "Creating Python virtualenv + installing backend deps"
python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip wheel
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/backend/requirements.txt"

# ----------------------------------------------------------------------------- 6. database schema + admin seed
say "Initialising database schema"
( cd "${APP_DIR}/backend" && "${APP_DIR}/.venv/bin/python" -c "import main; main._ensure_db_schema()" )

# Fail loudly here (not later at seed) if the schema did not build.
say "Verifying schema"
( cd "${APP_DIR}/backend" && "${APP_DIR}/.venv/bin/python" - <<'PYCHECK'
from sqlalchemy import inspect
from db.session import engine
insp = inspect(engine)
missing = [t for t in ("users", "jobs", "pdf_template") if not insp.has_table(t)]
if missing:
    raise SystemExit(f"Schema init failed - missing tables: {missing}")
print("Schema verified: core tables present")
PYCHECK
)

say "Seeding admin user (${ADMIN_EMAIL})"
( cd "${APP_DIR}/backend" && "${APP_DIR}/.venv/bin/python" -m scripts.seed )

# ----------------------------------------------------------------------------- 7. frontend build
say "Building frontend"
( cd "${APP_DIR}/frontend" && npm ci && npm run build )

# ----------------------------------------------------------------------------- 8. systemd service (uvicorn)
say "Installing systemd service '${SERVICE}'"
cat > "/etc/systemd/system/${SERVICE}.service" <<UNIT
[Unit]
Description=Analyst Rationale Studio API
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/backend
ExecStart=${APP_DIR}/.venv/bin/uvicorn main:app --host 127.0.0.1 --port ${BACKEND_PORT}
Restart=always
RestartSec=3
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable "${SERVICE}"
systemctl restart "${SERVICE}"

# ----------------------------------------------------------------------------- 9. nginx
say "Configuring nginx for ${DOMAIN}"
cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    client_max_body_size 1024M;
    root ${APP_DIR}/frontend/dist;
    index index.html;

    # SPA assets
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }

    # Uploaded files (avatars, logos) served by the backend
    location /uploads/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Live pipeline progress WebSocket
    location /ws/ {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 86400s;
    }
}
NGINX
ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# ----------------------------------------------------------------------------- 10. HTTPS (best effort — needs DNS pointed at this server)
say "Requesting HTTPS certificate (Let's Encrypt)"
if certbot --nginx -d "${DOMAIN}" -d "www.${DOMAIN}" \
     --non-interactive --agree-tos -m "${LE_EMAIL}" --redirect 2>/dev/null; then
  echo "HTTPS enabled for ${DOMAIN}"
elif certbot --nginx -d "${DOMAIN}" \
     --non-interactive --agree-tos -m "${LE_EMAIL}" --redirect 2>/dev/null; then
  echo "HTTPS enabled for ${DOMAIN} (apex only)"
else
  warn "Could not obtain certificate automatically. Point ${DOMAIN}'s DNS A record to this server, then run:"
  warn "  certbot --nginx -d ${DOMAIN} -m ${LE_EMAIL} --agree-tos --redirect"
fi

# ----------------------------------------------------------------------------- done
say "Deploy complete"
cat <<DONE

  Site      : https://${DOMAIN}
  Admin     : ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}
  Backend   : systemctl status ${SERVICE}   (127.0.0.1:${BACKEND_PORT})
  Logs      : journalctl -u ${SERVICE} -f
  App dir   : ${APP_DIR}
  Updates   : cd ${APP_DIR} && bash update.sh

  Next: add provider API keys in-app under Admin > Manage API Keys.
DONE
