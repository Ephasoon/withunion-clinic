#!/usr/bin/env bash
#
# Restore a WithUnion Clinic backup (made by backup.sh).
#
# DEFAULT - restore test, never touches the live database:
#   restore.sh --identity /path/to/backup-key.txt BACKUP_FILE
#   Starts a throwaway PostgreSQL container with no network, restores the
#   backup into it, prints the row count of every table next to the live
#   database's count, and checks the backup's migration list against the
#   migrations in this repository. The container is removed afterwards
#   (add --keep to leave it running for inspection).
#
# LIVE RESTORE - replaces the live database's contents with the backup:
#   restore.sh --identity KEY --into-live --yes-overwrite-live-database BACKUP_FILE
#   Requires BOTH flags and typing the database name at a prompt. Takes a
#   safety backup first, stops the API, restores in one transaction, then
#   starts the stack again (which re-runs migrations).
#
# The age PRIVATE key is needed only here; keep it off the server and
# bring it when restoring (see docs/deployment.md).
set -euo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BACKUP_CONFIG=${BACKUP_CONFIG:-/etc/withunion-clinic/backup.conf}
# shellcheck source=/dev/null
if [ -f "$BACKUP_CONFIG" ]; then . "$BACKUP_CONFIG"; fi

APP_DIR=${APP_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}
ENV_FILE=${ENV_FILE:-$APP_DIR/.env.production}
COMPOSE_FILE=${COMPOSE_FILE:-$APP_DIR/docker-compose.prod.yml}
COMPOSE_PROJECT=${COMPOSE_PROJECT:-}
MIGRATIONS_DIR=${MIGRATIONS_DIR:-$APP_DIR/server/src/db/migrations}
AGE_IDENTITY_FILE=${AGE_IDENTITY_FILE:-}

usage() {
  sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

identity=$AGE_IDENTITY_FILE
keep=0
into_live=0
confirmed_live=0
backup_file=""
while [ $# -gt 0 ]; do
  case "$1" in
    -i | --identity) identity=$2; shift 2 ;;
    --keep) keep=1; shift ;;
    --into-live) into_live=1; shift ;;
    --yes-overwrite-live-database) confirmed_live=1; shift ;;
    -h | --help) usage ;;
    -*) echo "unknown option: $1" >&2; usage ;;
    *) [ -z "$backup_file" ] || usage; backup_file=$1; shift ;;
  esac
done

log() { printf '%s restore: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

[ -n "$backup_file" ] || usage
[ -f "$backup_file" ] || die "backup file not found: $backup_file"
[ -n "$identity" ] || die "pass the age private key with --identity FILE"
[ -r "$identity" ] || die "cannot read the age private key: $identity"
command -v age >/dev/null || die "age is not installed (sudo apt install age)"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"

# COMPOSE_FILE may list several files separated by ":" (Docker's own
# convention), e.g. the production file plus an override; the same list
# must be used everywhere, or `up` would recreate containers differently.
compose_args=(--progress plain --env-file "$ENV_FILE")
IFS=: read -r -a compose_files <<<"$COMPOSE_FILE"
for f in "${compose_files[@]}"; do compose_args+=(-f "$f"); done
[ -n "$COMPOSE_PROJECT" ] && compose_args=(-p "$COMPOSE_PROJECT" "${compose_args[@]}")
compose() { docker compose "${compose_args[@]}" "$@"; }

# Read-only SQL against the live database (tab-separated, no headers).
live_sql() {
  compose exec -T -e PGOPTIONS='-c default_transaction_read_only=on' postgres \
    sh -c 'exec psql -X -q -At -F "	" -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<<"$1"
}

# Exact row count of every table in the public schema.
COUNT_SQL="SELECT table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name;"
MIGRATIONS_SQL="SELECT name FROM pgmigrations ORDER BY name;"

# ===========================================================================
# LIVE RESTORE
# ===========================================================================
if [ "$into_live" -eq 1 ] || [ "$confirmed_live" -eq 1 ]; then
  if [ "$into_live" -ne 1 ] || [ "$confirmed_live" -ne 1 ]; then
    die "restoring over the live database needs BOTH --into-live and --yes-overwrite-live-database. Nothing was changed."
  fi
  [ -t 0 ] || die "a live restore must be confirmed at an interactive terminal. Nothing was changed."
  age --decrypt --identity "$identity" "$backup_file" >/dev/null ||
    die "cannot decrypt $backup_file with this key. Nothing was changed."

  live_db=$(compose exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')
  echo
  echo "  This REPLACES everything in the live database \"$live_db\" with"
  echo "  $backup_file"
  echo "  The API is stopped during the restore. A safety backup is taken first."
  echo
  read -r -p "  Type the database name ($live_db) to continue: " answer
  [ "$answer" = "$live_db" ] || die "confirmation did not match. Nothing was changed."

  log "taking a safety backup of the live database first"
  "$SCRIPT_DIR/backup.sh" --prefix withunion-clinic-prerestore --keep 5 --no-offsite ||
    die "safety backup failed. Nothing was changed."

  log "stopping the API"
  compose stop api
  log "restoring (single transaction: on any error nothing changes)"
  if age --decrypt --identity "$identity" "$backup_file" |
    compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error'; then
    log "restore finished"
    status=0
  else
    log "ERROR: restore failed; the live database was rolled back to its previous state"
    status=1
  fi
  log "starting the stack again (migrations run first)"
  compose up -d
  exit "$status"
fi

# ===========================================================================
# RESTORE TEST (default): a throwaway container, never the live database
# ===========================================================================
live_cid=$(compose ps -q postgres 2>/dev/null || true)
[ -n "$live_cid" ] || die "the postgres service is not running; start the stack first"
pg_image=$(docker inspect --format '{{.Config.Image}}' "$live_cid")
scratch="withunion-restore-test-$(date '+%Y%m%d%H%M%S')"
scratch_db=restore_check

# The image declares a data volume; `-v` removes it with the container, so
# no decrypted copy of the database is left on disk.
cleanup() {
  if [ "$keep" -eq 1 ]; then
    log "kept scratch container $scratch (remove with: docker rm -f -v $scratch)"
  else
    docker rm -f -v "$scratch" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log "starting scratch container $scratch ($pg_image, no network)"
docker run -d --name "$scratch" --network none \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
  -e POSTGRES_DB="$scratch_db" -e TZ=Africa/Addis_Ababa \
  "$pg_image" -c timezone=Africa/Addis_Ababa >/dev/null

# The image's init runs a socket-only server first; TCP answers only once
# the real server is up.
for _ in $(seq 1 60); do
  if docker exec "$scratch" pg_isready -q -h 127.0.0.1 -U postgres -d "$scratch_db" 2>/dev/null; then break; fi
  sleep 1
done
docker exec "$scratch" pg_isready -q -h 127.0.0.1 -U postgres -d "$scratch_db" || die "scratch database did not start"

log "decrypting and restoring $(basename "$backup_file") into the scratch database"
age --decrypt --identity "$identity" "$backup_file" |
  docker exec -i "$scratch" pg_restore -U postgres -d "$scratch_db" --no-owner --no-privileges --exit-on-error

scratch_sql() { docker exec -i "$scratch" psql -X -q -At -F "	" -v ON_ERROR_STOP=1 -U postgres -d "$scratch_db" <<<"$1"; }

declare -A live_counts=()
while IFS=$'\t' read -r t c; do [ -n "$t" ] && live_counts[$t]=$c; done < <(live_sql "$COUNT_SQL")

echo
printf '  %-34s %12s %12s\n' "table" "backup" "live now"
printf '  %-34s %12s %12s\n' "-----" "------" "--------"
differ=0
while IFS=$'\t' read -r t c; do
  [ -n "$t" ] || continue
  l=${live_counts[$t]:--}
  mark=""
  if [ "$l" != "$c" ]; then mark="  <- differs"; differ=1; fi
  printf '  %-34s %12s %12s%s\n' "$t" "$c" "$l" "$mark"
done < <(scratch_sql "$COUNT_SQL")
echo
if [ "$differ" -eq 1 ]; then
  echo "  Some counts differ from the live database. That is expected if the"
  echo "  clinic kept working after the backup was taken."
  echo
fi

# Migrations: the backup must contain exactly the migrations in this repo.
mapfile -t backup_migrations < <(scratch_sql "$MIGRATIONS_SQL" | LC_ALL=C sort)
mapfile -t live_migrations < <(live_sql "$MIGRATIONS_SQL" | LC_ALL=C sort)
mapfile -t repo_migrations < <(find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.ts' -exec basename {} .ts \; | LC_ALL=C sort)
echo "  migrations: backup ${#backup_migrations[@]}, live ${#live_migrations[@]}, repository ${#repo_migrations[@]}"
if [ "$(printf '%s\n' "${backup_migrations[@]}")" = "$(printf '%s\n' "${repo_migrations[@]}")" ]; then
  echo "  migration table matches the repository: OK"
  result=0
else
  echo "  migration table does NOT match the repository:"
  diff <(printf '%s\n' "${repo_migrations[@]}") <(printf '%s\n' "${backup_migrations[@]}") | sed 's/^/    /' || true
  echo "  (expected if the backup predates the current version; restoring it"
  echo "   live would be followed by the newer migrations on start-up)"
  result=1
fi
echo
log "restore test finished (live database untouched)"
exit "$result"
