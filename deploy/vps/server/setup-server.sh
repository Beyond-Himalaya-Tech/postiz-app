#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 24.04 server (ARM or x86). Paste it into
# the server's cloud-init / user data box when creating it (Oracle: "Initialization
# script"), or run it once as root. Fill in DEPLOY_PUBLIC_KEY first (see README).
#
# Installs Docker + Compose and rclone, opens 80/443 in the OS firewall, adds
# swap, log rotation, the nightly backup cron, SSH hardening and the "deploy"
# user GitHub Actions logs in as. Everything else arrives with the first deploy.
set -euo pipefail

# Public half of the GitHub Actions deploy key: one line, "ssh-ed25519 AAAA... postiz-deploy"
DEPLOY_PUBLIC_KEY=''

# First boot often has unattended-upgrades holding the dpkg lock; wait for it
apt_get() {
  apt-get -o DPkg::Lock::Timeout=600 "$@"
}

apt_get update
apt_get install -y ca-certificates curl rclone

# Oracle's Ubuntu images ship iptables rules that reject everything but SSH.
# Open 80/443 before Docker adds its own rules, so the reload can't drop them
if [ -f /etc/iptables/rules.v4 ]; then
  for rule in '-p tcp -m tcp --dport 80' '-p tcp -m tcp --dport 443' '-p udp -m udp --dport 443'; do
    if ! grep -qF -- "-A INPUT $rule -j ACCEPT" /etc/iptables/rules.v4; then
      sed -i "0,/^-A INPUT -j REJECT/s//-A INPUT $rule -j ACCEPT\n&/" /etc/iptables/rules.v4
    fi
  done
  netfilter-persistent reload
fi

# Docker from Docker's own apt repository
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt_get update
apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Cap container logs, pm2 writes everything to stdout
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "50m", "max-file": "5" }
}
EOF
systemctl enable docker
systemctl restart docker

# 4 GB swap so a memory spike slows things down instead of killing Postgres
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

mkdir -p /opt/postiz/backups /opt/postiz/releases /opt/postiz/build /var/log/postiz-deploy
chmod 700 /opt/postiz

# Nightly database backup at 16:00 UTC (02:00-03:00 in Sydney)
cat > /etc/cron.d/postiz-backup <<'EOF'
0 16 * * * root /opt/postiz/backup.sh nightly >> /var/log/postiz-backup.log 2>&1
EOF
cat > /etc/logrotate.d/postiz-backup <<'EOF'
/var/log/postiz-backup.log {
  monthly
  rotate 6
  compress
  missingok
  notifempty
}
EOF

# SSH: keys only. Sorts before 50-cloud-init.conf, and the first value wins
cat > /etc/ssh/sshd_config.d/10-postiz.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl try-reload-or-restart ssh || true

# The only thing GitHub Actions can run on this server. It reads the command
# the workflow asked for from SSH_ORIGINAL_COMMAND:
#   build <sha>                        build postiz-app:<sha> from a source .tar.gz on stdin
#   install-release <id>               unpack a .tar.gz from stdin into releases/<id>
#   deploy <id> <sha> [--keep-schema]  run releases/<id>/deploy.sh
# deploy runs as its own systemd unit, so a dropped SSH connection doesn't stop
# it halfway; the log is in /var/log/postiz-deploy/<id>.log either way.
cat > /usr/local/sbin/postiz-ci <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
releases=/opt/postiz/releases
read -r -a args <<< "${SSH_ORIGINAL_COMMAND:-}"

release_id() {
  if [[ ! "${1:-}" =~ ^[0-9]+-[0-9]+$ ]]; then
    echo "Invalid release id: ${1:-}" >&2
    exit 2
  fi
}

commit_sha() {
  if [[ ! "${1:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid image tag, expected a full commit SHA: ${1:-}" >&2
    exit 2
  fi
}

case "${args[0]:-}" in
  build)
    commit_sha "${args[1]:-}"
    if docker image inspect "postiz-app:${args[1]}" >/dev/null 2>&1; then
      echo "postiz-app:${args[1]} is already built"
      cat > /dev/null
      exit 0
    fi
    src="/opt/postiz/build/${args[1]}"
    rm -rf "$src"
    mkdir -p "$src"
    trap 'rm -rf "$src"' EXIT
    tar -xzf - -C "$src" --no-same-owner
    docker build --progress=plain -f "$src/Dockerfile.dev" \
      --build-arg "NEXT_PUBLIC_VERSION=${args[1]}" -t "postiz-app:${args[1]}" "$src"
    ;;
  install-release)
    release_id "${args[1]:-}"
    rm -rf "${releases:?}/${args[1]}"
    mkdir -p "$releases/${args[1]}"
    tar -xzf - -C "$releases/${args[1]}" --no-same-owner
    ;;
  deploy)
    release_id "${args[1]:-}"
    commit_sha "${args[2]:-}"
    flags=()
    if [ "${args[3]:-}" = "--keep-schema" ]; then
      flags=(--keep-schema)
    fi
    log="/var/log/postiz-deploy/${args[1]}.log"
    : > "$log"
    tail -n +1 -f "$log" &
    tail_pid=$!
    status=0
    systemd-run --quiet --wait --collect --unit="postiz-deploy-${args[1]}" \
      --setenv=HOME=/root \
      -p StandardOutput="append:$log" -p StandardError="append:$log" \
      /usr/bin/bash "$releases/${args[1]}/deploy.sh" "${args[2]}" "${flags[@]}" || status=$?
    sleep 1
    kill "$tail_pid" 2>/dev/null || true
    exit "$status"
    ;;
  *)
    echo "Not allowed: ${SSH_ORIGINAL_COMMAND:-<interactive login>}" >&2
    exit 2
    ;;
esac
EOF
chmod 755 /usr/local/sbin/postiz-ci

cat > /etc/sudoers.d/postiz-deploy <<'EOF'
Defaults:deploy env_keep += "SSH_ORIGINAL_COMMAND"
deploy ALL=(root) NOPASSWD: /usr/local/sbin/postiz-ci
EOF
chmod 440 /etc/sudoers.d/postiz-deploy
visudo -cf /etc/sudoers.d/postiz-deploy

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -n "$DEPLOY_PUBLIC_KEY" ]; then
  # restrict: no shell, no port forwarding; the key can only run postiz-ci
  echo "restrict,command=\"/usr/bin/sudo -n /usr/local/sbin/postiz-ci\" $DEPLOY_PUBLIC_KEY" \
    > /home/deploy/.ssh/authorized_keys
  chown deploy:deploy /home/deploy/.ssh/authorized_keys
  chmod 600 /home/deploy/.ssh/authorized_keys
else
  echo "DEPLOY_PUBLIC_KEY was empty: add it to /home/deploy/.ssh/authorized_keys (see README)."
fi

echo "Server ready. Next: create /opt/postiz/.env and /opt/postiz/backup.env (see deploy/vps/README.md)."
