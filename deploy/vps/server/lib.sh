# Shared helpers for deploy.sh, backup.sh and restore.sh. Source it, don't run it.

export PATH="$PATH:/usr/local/sbin:/usr/local/bin"
export HOME="${HOME:-/root}"
POSTIZ_DIR=/opt/postiz
cd "$POSTIZ_DIR"

log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

# Reads one key from .env (strips optional surrounding quotes)
env_get() {
  { grep -E "^$1=" .env || true; } | tail -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

env_set() {
  if grep -qE "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}

# Exits 0 when the backend, frontend and orchestrator inside the postiz
# container all answer without a server error
postiz_healthy() {
  docker compose exec -T postiz node -e '
    const urls = [
      "http://localhost:3000/",
      "http://localhost:4200/",
      "http://localhost:3002/health/status",
    ];
    Promise.all(urls.map((u) => fetch(u, { redirect: "manual" }).then((r) => {
      if (r.status >= 500) throw new Error(u + " returned " + r.status);
    })))
      .then(() => process.exit(0))
      .catch((e) => { console.error(e.message); process.exit(1); });
  ' >/dev/null 2>&1
}

# Waits up to $1 seconds (default 300) for postiz_healthy
wait_healthy() {
  local deadline=$((SECONDS + ${1:-300}))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if postiz_healthy; then
      return 0
    fi
    sleep 10
  done
  return 1
}

# The backend starts missing-post-workflow on boot when RUN_CRON is set, and
# swallows any error doing it, so check Temporal directly
cron_running() {
  docker compose exec -T temporal temporal workflow describe \
    --address temporal:7233 --namespace default \
    --workflow-id missing-post-workflow -o json 2>/dev/null \
    | grep -q '"status": "WORKFLOW_EXECUTION_STATUS_RUNNING"'
}

# Images only exist on this server (the deploy workflow builds them here), and
# deploy.sh keeps the newest few
require_image() {
  if ! docker image inspect "postiz-app:$1" >/dev/null 2>&1; then
    log "Image postiz-app:$1 is not on this server. Kept versions:"
    docker image ls postiz-app --format '  {{.Tag}}  {{.CreatedSince}}'
    log "To deploy an older commit that is not listed, re-run its workflow in GitHub Actions."
    return 1
  fi
}

# Where Docker keeps the uploaded media (STORAGE_PROVIDER=local)
uploads_dir() {
  docker volume inspect -f '{{.Mountpoint}}' postiz_postiz-uploads
}

# Points rclone's "store" remote at the bucket in backup.env (AWS S3 or
# Cloudflare R2) and sets BACKUP_BUCKET. backup.env stays out of the
# containers, unlike .env
backup_store_setup() {
  if [ ! -f backup.env ]; then
    log "$POSTIZ_DIR/backup.env is missing, create it from backup.env.example"
    return 1
  fi
  set -a
  source ./backup.env
  set +a
  export RCLONE_CONFIG_STORE_TYPE=s3
  export RCLONE_CONFIG_STORE_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY_ID"
  export RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="$BACKUP_SECRET_ACCESS_KEY"
  # The keys can't create or list buckets
  export RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true
  case "${BACKUP_PROVIDER:-}" in
    s3)
      export RCLONE_CONFIG_STORE_PROVIDER=AWS
      export RCLONE_CONFIG_STORE_REGION="$S3_REGION"
      ;;
    r2)
      export RCLONE_CONFIG_STORE_PROVIDER=Cloudflare
      export RCLONE_CONFIG_STORE_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
      ;;
    *)
      log "BACKUP_PROVIDER in backup.env must be s3 or r2, got '${BACKUP_PROVIDER:-}'"
      return 1
      ;;
  esac
}
