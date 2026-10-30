#!/usr/bin/env bash
# Deploys one Postiz image tag. GitHub Actions has the server build the image
# and sends the release folder over SSH, then runs this as root (through
# /usr/local/sbin/postiz-ci):
#   /opt/postiz/releases/<release>/deploy.sh <image-tag> [--keep-schema]
#
# 1. Install this release's compose/Caddy/script files into /opt/postiz
# 2. Check the image is here and make sure the databases and Temporal are up
# 3. Back up the database (named after the old and new tags)
# 4. Ask Prisma whether the new version changes the database
# 5. If it does, apply the change while the old version keeps serving
# 6. Switch to the new image and wait for it to answer
#    - unhealthy, database untouched  -> automatic rollback to the old image
#    - unhealthy, database changed    -> stop and alert, no automatic rollback
# 7. Check that the missed-post sweep is running in Temporal
#
# --keep-schema skips steps 4-5. Use it when redeploying an older image: its
# schema is behind the database, and `db push` would try to remove the newer
# tables and columns. The workflow passes it whenever image_tag is set.
set -euo pipefail
release_dir="$(cd "$(dirname "$0")" && pwd)"
source "$release_dir/lib.sh"

new_tag="${1:?usage: deploy.sh <image-tag> [--keep-schema]}"
keep_schema=0
saved_previous=0
if [ "${2:-}" = "--keep-schema" ]; then
  keep_schema=1
fi

exec 9>"$POSTIZ_DIR/.deploy.lock"
if ! flock -n 9; then
  log "Another deploy is running"
  exit 1
fi

if [ ! -f .env ]; then
  log "$POSTIZ_DIR/.env is missing, create it from env.example first"
  exit 1
fi

if [ "$release_dir" != "$POSTIZ_DIR" ]; then
  # Keep the running setup, so an automatic rollback can put it back too
  rm -rf previous
  if [ -f docker-compose.yml ]; then
    mkdir -p previous/dynamicconfig
    cp docker-compose.yml Caddyfile previous/
    cp -r dynamicconfig/. previous/dynamicconfig/
    saved_previous=1
  fi

  log "Installing deploy files from $release_dir"
  cp "$release_dir"/{docker-compose.yml,Caddyfile,env.example,backup.env.example,lib.sh,deploy.sh,backup.sh,restore.sh} .
  # Copy into the existing folder: running Temporal has it bind-mounted, and a
  # new folder would leave Temporal reading the deleted one until it restarts
  mkdir -p dynamicconfig
  cp -r "$release_dir/dynamicconfig/." dynamicconfig/
  chmod +x ./*.sh
fi

prev_tag="$(env_get POSTIZ_TAG)"
if [ "$prev_tag" = "none" ]; then
  prev_tag=""
fi

free_gb="$(df -BG --output=avail / | tail -n 1 | tr -dc '0-9')"
if [ "$free_gb" -lt 5 ]; then
  log "Only ${free_gb} GB free on disk, need at least 5 GB. Nothing changed."
  exit 1
fi

require_image "$new_tag"

log "Starting databases and Temporal"
docker compose up -d --wait postgres redis temporal-postgresql temporal
docker compose up -d temporal-ui

backup_file="$("$POSTIZ_DIR/backup.sh" "from-${prev_tag:-empty}-to-$new_tag" | tee -a /dev/stderr | tail -n 1)"

run_new() {
  POSTIZ_TAG="$new_tag" docker compose run --rm --no-deps -T postiz "$@"
}

schema_changed=0
if [ "$keep_schema" = 1 ]; then
  log "--keep-schema: leaving the database as it is"
else
  schema=./libraries/nestjs-libraries/src/database/prisma/schema.prisma
  log "Comparing the database with the new version's schema"
  set +e
  # Same Prisma version and invocation as the repo's prisma-db-push script.
  # --script prints "-- This is an empty migration." when nothing differs;
  # that is checked instead of --exit-code, which pnpm dlx may not pass through
  diff_output="$(run_new sh -c "pnpm dlx prisma@6.5.0 migrate diff --from-url \"\$DATABASE_URL\" --to-schema-datamodel $schema --script" 2>&1)"
  diff_status=$?
  set -e

  if [ "$diff_status" != 0 ]; then
    log "Could not compare the schema (exit $diff_status). Nothing changed, ${prev_tag:-nothing} is still running."
    echo "$diff_output"
    exit 1
  elif grep -qF -- '-- This is an empty migration.' <<< "$diff_output"; then
    log "No database changes in this version"
  else
    schema_changed=1
    log "This version changes the database:"
    echo "$diff_output"
  fi
fi

if [ "$schema_changed" = 1 ]; then
  log "Applying database changes while ${prev_tag:-nothing} keeps running"
  if ! run_new pnpm run prisma-db-push; then
    log "Database update failed, ${prev_tag:-nothing} is still running."
    log "If Prisma refused because data would be lost, the database is unchanged."
    exit 1
  fi
fi

log "Switching Postiz to $new_tag"
env_set POSTIZ_TAG "$new_tag"
docker compose up -d postiz caddy

if ! wait_healthy 300; then
  log "New version $new_tag did not become healthy. Last logs:"
  docker compose logs --tail 80 postiz || true

  if [ "$schema_changed" = 0 ] && [ -n "$prev_tag" ]; then
    log "The database was not changed, rolling back to $prev_tag"
    if [ "$saved_previous" = 1 ]; then
      cp previous/docker-compose.yml previous/Caddyfile .
      cp -r previous/dynamicconfig/. dynamicconfig/
    fi
    env_set POSTIZ_TAG "$prev_tag"
    docker compose up -d postiz caddy
    if wait_healthy 300; then
      log "Rolled back to $prev_tag"
    else
      log "Rollback to $prev_tag is not healthy either, check: docker compose logs postiz"
    fi
  elif [ -z "$prev_tag" ]; then
    log "This is the first deploy, so there is no older version to roll back to."
  else
    log "This version changed the database, so it was NOT rolled back automatically:"
    log "the old version would try to undo the change and fail to start."
    log "Either fix forward and deploy again, or restore the pre-deploy backup:"
    log "  sudo $POSTIZ_DIR/restore.sh $backup_file ${prev_tag:-<old-tag>}"
  fi
  exit 1
fi
log "Postiz $new_tag is healthy"

# Caddy doesn't watch its config file, so apply this release's Caddyfile
if ! docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
  log "WARNING: Caddy could not reload the Caddyfile, it keeps its previous settings"
fi

# Keep the live image plus the 3 newest others for rollbacks (newest first)
docker image ls postiz-app --format '{{.Tag}}' | grep -vxF "$new_tag" | tail -n +4 \
  | xargs -r -I{} docker image rm "postiz-app:{}" >/dev/null || true
docker image prune -f >/dev/null || true
docker builder prune -f --filter "until=168h" >/dev/null || true
ls -1dt releases/*/ 2>/dev/null | tail -n +11 | xargs -r rm -rf --
find /var/log/postiz-deploy -name '*.log' -mtime +60 -delete 2>/dev/null || true

if ! cron_running; then
  log "missing-post-workflow is not running in Temporal, restarting Postiz once"
  docker compose restart postiz
  wait_healthy 300 || true
  if ! cron_running; then
    log "WARNING: Postiz $new_tag is live, but missing-post-workflow is still not running."
    log "Posts Temporal loses will not be re-queued. Check RUN_CRON and: docker compose logs postiz"
    exit 1
  fi
fi
log "Missed-post sweep is running"
log "Deployed $new_tag"
