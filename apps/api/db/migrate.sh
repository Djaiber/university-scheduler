#!/usr/bin/env bash
# Aplica migraciones SQL pendientes en orden. Uso: DATABASE_URL=postgres://… ./migrate.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL es obligatorio}"
dir="$(cd "$(dirname "$0")/migrations" && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in "$dir"/*.sql; do
  v="$(basename "$f" .sql)"
  if [ -z "$(psql "$DATABASE_URL" -tAq -c "SELECT 1 FROM schema_migrations WHERE version='$v'")" ]; then
    echo "→ $v"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -1 \
      -f "$f" -c "INSERT INTO schema_migrations(version) VALUES ('$v')"
  fi
done
echo "Migraciones al día."
