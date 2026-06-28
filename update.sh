#!/usr/bin/env bash
###############################################################################
# Analyst Rationale Studio — update to the latest code
#
# Run on the VPS after deploy.sh has been used once:
#
#   cd /opt/analyst-rationale-studio && bash update.sh
#
# Pulls the latest commit, installs any new backend/frontend deps, applies
# database migrations (idempotent self-heal), rebuilds the frontend and
# restarts the API. Does NOT touch .env and does NOT reset the admin password.
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/analyst-rationale-studio}"
BRANCH="${BRANCH:-main}"
SERVICE="ars-backend"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

cd "${APP_DIR}"

say "Pulling latest code (${BRANCH})"
git fetch --depth 1 origin "${BRANCH}"
git reset --hard "origin/${BRANCH}"

say "Updating backend dependencies"
"${APP_DIR}/.venv/bin/pip" install --upgrade pip wheel >/dev/null
"${APP_DIR}/.venv/bin/pip" install -r "${APP_DIR}/backend/requirements.txt"

say "Applying database migrations / schema self-heal"
( cd "${APP_DIR}/backend" && "${APP_DIR}/.venv/bin/python" -c "import main; main._ensure_db_schema()" )

say "Rebuilding frontend"
( cd "${APP_DIR}/frontend" && npm ci && npm run build )

say "Restarting API + reloading nginx"
systemctl restart "${SERVICE}"
nginx -t && systemctl reload nginx

say "Update complete — https site is live with the new code"
systemctl --no-pager --lines=0 status "${SERVICE}" || true
