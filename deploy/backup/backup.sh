#!/usr/bin/env bash
#
# Encrypted backup of the WithUnion Clinic database.
#
#   pg_dump (custom format) inside the postgres container
#     | age, encrypted to the PUBLIC key(s) in AGE_RECIPIENTS_FILE
#     > BACKUP_DIR/withunion-clinic_YYYYmmdd-HHMMSS.dump.age
#
# The unencrypted dump never touches the disk. Only the newest
# KEEP_BACKUPS files with this prefix are kept. If OFFSITE_RSYNC_TARGET
# is set, the new file is also copied there (see the OFF-SITE HOOK below).
#
# Settings: /etc/withunion-clinic/backup.conf (or $BACKUP_CONFIG); see
# deploy/backup/backup.conf.example. Run as a user allowed to use docker.
#
# Options (used by restore.sh for its safety copy; not needed normally):
#   --prefix NAME   file-name prefix (default withunion-clinic)
#   --keep N        how many files with that prefix to keep
#   --no-offsite    skip the off-site copy
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
BACKUP_DIR=${BACKUP_DIR:-/var/backups/withunion-clinic}
AGE_RECIPIENTS_FILE=${AGE_RECIPIENTS_FILE:-/etc/withunion-clinic/backup-recipients.txt}
KEEP_BACKUPS=${KEEP_BACKUPS:-14}
OFFSITE_RSYNC_TARGET=${OFFSITE_RSYNC_TARGET:-}
OFFSITE_SSH_OPTS=${OFFSITE_SSH_OPTS:-}
PREFIX=withunion-clinic

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX=$2; shift 2 ;;
    --keep) KEEP_BACKUPS=$2; shift 2 ;;
    --no-offsite) OFFSITE_RSYNC_TARGET=""; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

log() { printf '%s backup: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is not installed"
command -v age >/dev/null || die "age is not installed (sudo apt install age)"
[ -s "$AGE_RECIPIENTS_FILE" ] || die "no age public key in $AGE_RECIPIENTS_FILE"
[ -f "$ENV_FILE" ] || die "env file not found: $ENV_FILE"
case "$KEEP_BACKUPS" in '' | *[!0-9]*) die "KEEP_BACKUPS must be a whole number" ;; esac
[ "$KEEP_BACKUPS" -ge 1 ] || die "KEEP_BACKUPS must be at least 1"
case "$PREFIX" in '' | *[!A-Za-z0-9._-]*) die "invalid prefix: $PREFIX" ;; esac

# COMPOSE_FILE may list several files separated by ":" (Docker's own
# convention), e.g. the production file plus an override; the same list
# must be used everywhere, or `up` would recreate containers differently.
compose_args=(--progress plain --env-file "$ENV_FILE")
IFS=: read -r -a compose_files <<<"$COMPOSE_FILE"
for f in "${compose_files[@]}"; do compose_args+=(-f "$f"); done
[ -n "$COMPOSE_PROJECT" ] && compose_args=(-p "$COMPOSE_PROJECT" "${compose_args[@]}")
compose() { docker compose "${compose_args[@]}" "$@"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

out="$BACKUP_DIR/${PREFIX}_$(date '+%Y%m%d-%H%M%S').dump.age"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

log "dumping database to $out"
# pipefail: a pg_dump failure fails the whole pipeline (and the script).
compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6' |
  age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" --output "$tmp"

[ "$(head -c 21 "$tmp")" = "age-encryption.org/v1" ] || die "output is not an age file"
mv "$tmp" "$out"
log "wrote $(wc -c <"$out" | tr -d ' ') bytes (encrypted)"

# Rotation: names sort by timestamp, newest first; keep the first N.
# Counting files (not days) means a stopped backup job never deletes the
# last good copies.
mapfile -t existing < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIX}_*.dump.age" | sort -r)
if [ "${#existing[@]}" -gt "$KEEP_BACKUPS" ]; then
  for old in "${existing[@]:$KEEP_BACKUPS}"; do
    log "rotating out $(basename "$old")"
    rm -f -- "$old"
  done
fi

# ---------------------------------------------------------------------------
# OFF-SITE HOOK. Backups contain patient data and must stay in Ethiopia:
# point OFFSITE_RSYNC_TARGET only at a machine you control inside Ethiopia
# (for example a second server at the clinic or the owner's office),
# e.g.  backup@192.0.2.10:/srv/withunion-backups/
# The file is already encrypted; the target never needs the private key.
# Rotation on the target is the target's job.
# ---------------------------------------------------------------------------
if [ -n "$OFFSITE_RSYNC_TARGET" ]; then
  command -v rsync >/dev/null || die "rsync is not installed (sudo apt install rsync)"
  log "copying off-site to $OFFSITE_RSYNC_TARGET"
  rsync -a --chmod=F600 -e "ssh -o BatchMode=yes $OFFSITE_SSH_OPTS" "$out" "$OFFSITE_RSYNC_TARGET" ||
    die "off-site copy failed (the local backup $out is fine)"
fi

log "done: $out"
