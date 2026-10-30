#!/usr/bin/env bash
# Replaces the Postiz database with a backup. Everything written after that
# backup is lost, so use it only when the database itself is broken.
# Usage: restore.sh <backups/file.dump | file name under backups/ in the bucket> [image-tag]
# Pass image-tag to also switch Postiz to the version the backup belongs to
# (pre-deploy backups are named ...-from-<tag>-to-<tag>.dump).
# The current database is backed up first (label "pre-restore"). If it is too
# broken to dump, run with SKIP_PRE_RESTORE_BACKUP=1.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

src="${1:?usage: restore.sh <backup> [image-tag]}"
tag="${2:-}"
user="$(env_get POSTGRES_USER)"
db="$(env_get POSTGRES_DB)"

exec 9>"$POSTIZ_DIR/.deploy.lock"
if ! flock -n 9; then
  log "A deploy is running, try again when it has finished"
  exit 1
fi

# Check first, so a missing image fails before the database is touched
if [ -n "$tag" ]; then
  require_image "$tag"
fi

# Work on a copy outside backups/, which backup.sh prunes
name="$(basename "$src")"
file="restore/$name"
mkdir -p restore
if [ -f "backups/$name" ]; then
  cp "backups/$name" "$file"
elif [ ! -f "$file" ]; then
  backup_store_setup
  log "Downloading $BACKUP_BUCKET/backups/$name"
  rclone copyto "store:$BACKUP_BUCKET/backups/$name" "$file"
fi

log "Stopping Postiz"
docker compose stop postiz

if [ "${SKIP_PRE_RESTORE_BACKUP:-0}" != 1 ]; then
  if ! "$POSTIZ_DIR/backup.sh" pre-restore; then
    log "Could not back up the current database, nothing was replaced. Start Postiz"
    log "again with: docker compose up -d postiz. If the database is too broken to"
    log "dump, run again with SKIP_PRE_RESTORE_BACKUP=1."
    exit 1
  fi
fi

log "Recreating database $db from $file"
docker compose exec -T postgres dropdb -U "$user" --if-exists --force "$db"
docker compose exec -T postgres createdb -U "$user" "$db"
docker compose exec -T postgres pg_restore -U "$user" -d "$db" --no-owner --exit-on-error < "$file"

if [ -n "$tag" ]; then
  log "Switching Postiz image to $tag"
  env_set POSTIZ_TAG "$tag"
fi

log "Starting Postiz"
docker compose up -d postiz
if wait_healthy 300; then
  log "Postiz is up"
else
  log "Postiz did not become healthy, check: docker compose logs postiz"
  exit 1
fi
