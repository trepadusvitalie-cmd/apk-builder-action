#!/usr/bin/env bash
# Rulează migrările și testele pe un PostgreSQL temporar, fără Docker și fără Supabase.
# Cerințe: PostgreSQL 15+ instalat (initdb/pg_ctl), de ex. `apt install postgresql`.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PGBIN="${PGBIN:-$(dirname "$(ls /usr/lib/postgresql/*/bin/initdb 2>/dev/null | sort -V | tail -1 || command -v initdb)")}"
WORK="$(mktemp -d)"
PORT="${PGPORT:-54329}"
RUN=()
if [ "$(id -u)" = "0" ]; then   # PostgreSQL refuză să pornească ca root
  chown -R postgres "$WORK"
  RUN=(runuser -u postgres --)
fi

cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust -c wal_level=logical >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses='' -k $WORK" -l "$WORK/log" -w start >/dev/null

run_sql() { "${RUN[@]}" "$PGBIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres "$@"; }

run_sql < "$HERE/00_supabase_stubs.sql"
for migration in "$HERE"/../migrations/*.sql; do
  echo "== migrare: $(basename "$migration")"
  run_sql < "$migration"
done
echo "== teste"
run_sql -o /dev/null < "$HERE/01_rls_test.sql" 2>&1 | sed 's/^NOTICE:  //'
