#!/usr/bin/env bash
# Dumps the Postiz database to backups/ in the bucket from backup.env (S3 or
# R2), and copies new uploaded media to uploads/ in the same bucket.
# Usage: backup.sh [label]   (cron runs it nightly with label "nightly")
# Temporal's own database is not dumped: the weekly boot volume backup covers
# it, and with RUN_CRON on, the missed-post sweep re-queues posts if it is ever
# lost.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

label="${1:-manual}"
user="$(env_get POSTGRES_USER)"
db="$(env_get POSTGRES_DB)"
backup_store_setup

if [ -z "$(docker compose ps -q --status running postgres)" ]; then
  log "Postgres is not running, nothing to back up"
  exit 0
fi

mkdir -p backups
file="backups/postiz-$(date -u +%Y%m%dT%H%M%SZ)-$label.dump"

# Write to .tmp first, so a failed dump never looks like a usable backup
log "Dumping database to $file"
docker compose exec -T postgres pg_dump -U "$user" -d "$db" -Fc > "$file.tmp"
mv "$file.tmp" "$file"

log "Uploading to $BACKUP_BUCKET/$file"
rclone copyto "$file" "store:$BACKUP_BUCKET/$file"

# copy, not sync: media deleted here stays in the bucket, so a wiped volume
# can't wipe the copy too. Only new files are sent. The volume doesn't exist
# yet during the very first deploy
if uploads="$(uploads_dir 2>/dev/null)"; then
  log "Copying new uploads to $BACKUP_BUCKET/uploads/"
  rclone copy "$uploads" "store:$BACKUP_BUCKET/uploads/"
fi

# Keep the 7 newest dumps on disk, the bucket's lifecycle rule keeps 30 days
rm -f backups/*.tmp
ls -1t backups/*.dump | tail -n +8 | xargs -r rm --

echo "$file"
