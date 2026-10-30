# Postiz on one server (Oracle Cloud Always Free)

Runs this fork on one Ubuntu server with Docker Compose, deployed by GitHub
Actions on every push to `main`. Written for Oracle Cloud's Always Free ARM
server in Sydney (A$0 a month), and works on any Ubuntu 24.04 server.

```
Your team -> postiz.beyondhimalayatech.com.au (Hostinger DNS) -> server public IP
Server: Caddy (80/443) -> Postiz -> Postgres, Redis, Temporal (+ its Postgres)
Backups: nightly pg_dump (30 days) + uploaded media -> AWS S3 (or Cloudflare R2), weekly boot volume backup
Deploys: GitHub Actions -> SSH -> server builds the image -> deploy.sh
```

| File | What it does |
|---|---|
| `server/docker-compose.yml` | The stack. Only Caddy has public ports; every database has a named volume |
| `server/Caddyfile` | HTTPS with an automatic Let's Encrypt certificate |
| `server/env.example` | Template for `/opt/postiz/.env` (passwords, domain, social app keys) |
| `server/backup.env.example` | Template for `/opt/postiz/backup.env` (backup bucket keys, kept out of the containers) |
| `server/deploy.sh` | Backup, schema check, switch, health check, rollback (see the top of the file) |
| `server/backup.sh` / `restore.sh` | Nightly dump and new media to the backup bucket / put a dump back (backs up the current database first) |
| `iam/s3-backup-user-policy.json` / `iam/s3-lifecycle.json` | S3 only: what the server's key may do (add and read, never delete) and how long the bucket keeps things |
| `server/setup-server.sh` | One-time server setup, including `postiz-ci`, the only command the deploy key can run |
| `../../.github/workflows/deploy-vps.yml` | Sends the source, has the server build and deploy it |

The image is built on the server, not on GitHub: GitHub's free runners are
x86 and the Oracle server is ARM. There is no image registry. The server
keeps the live image plus the 3 newest others for rollbacks.

## Costs

| Item | A$/month |
|---|---|
| Oracle Always Free server (4 CPU, 24 GB RAM, 150 GB disk) | 0 |
| AWS S3 backups in Sydney (about A$0.04 per GB stored; Cloudflare R2 is free up to 10 GB) | under 1 |
| GitHub Actions (about 20-35 minutes of the free 2,000 a month per deploy) | 0 |

## Before you start: the login cookie

Postiz sets its login cookie on the whole parent domain
(`getCookieUrlFromDomain` in `libraries/helpers/src/subdomain/subdomain.management.ts`).
On `postiz.beyondhimalayatech.com.au` that is `.beyondhimalayatech.com.au`, so
browsers also send the Postiz login token to the company website and every
other subdomain. If those are run by someone else (a Hostinger site,
WordPress, a marketing tool), consider a separate cheap domain just for
Postiz instead (about A$20 a year).

## One-time setup

### 1. Oracle account
1. Sign up at cloud.oracle.com. Pick **Australia East (Sydney)** as the home
   region. You can't change it later, and free servers only run there.
2. Billing → **Upgrade to Pay As You Go**. You still pay nothing within the
   Always Free limits, but Oracle stops reclaiming "idle" free servers (a
   1-2 person team looks idle) and capacity is easier to get.
3. Billing → Budgets → create a budget of **US$1** with an email alert, so any
   paid resource created by mistake is caught within a day.

### 2. SSH keys (on your laptop)
```
ssh-keygen -t ed25519 -N '' -C postiz-deploy -f ~/.ssh/postiz-deploy
```
`postiz-deploy.pub` goes on the server, `postiz-deploy` (private) goes into
GitHub. Use your own personal key (e.g. `~/.ssh/id_ed25519.pub`) to log in
yourself.

Open a copy of `server/setup-server.sh` and paste the one line in
`~/.ssh/postiz-deploy.pub` into `DEPLOY_PUBLIC_KEY=''`.

### 3. The server
Compute → Instances → Create instance:
- Name `postiz`
- Image: **Canonical Ubuntu 24.04** (the aarch64 build)
- Shape: Ampere → **VM.Standard.A1.Flex**, **4 OCPU, 24 GB**
- Networking: create a new virtual cloud network with a public subnet, and
  assign a public IPv4 address
- SSH keys: upload **your personal** public key
- Boot volume: specify a custom size of **150 GB** (free up to 200 GB in total)
- Advanced options → Management → Initialization script: paste your edited
  `setup-server.sh`

"Out of host capacity" is common for free ARM servers in Sydney. Retry later
(early morning often works); the Pay As You Go upgrade usually helps.

Note the public IP. It stays the same through reboots and stop/start, and
only changes if the instance is deleted.

### 4. Open the ports in Oracle's firewall
Networking → Virtual cloud networks → your network → the public subnet →
its Security List → Add ingress rules, source `0.0.0.0/0`:
TCP `80`, TCP `443`, UDP `443`. SSH (22) is already open.

The server has a second firewall (iptables) of its own; `setup-server.sh`
opens the same ports there.

Wait about 5 minutes, then check from your laptop:
```
ssh ubuntu@<server-ip> 'sudo ls /opt/postiz'
```
It should show `backups  build  releases`. If not, read
`sudo cat /var/log/cloud-init-output.log`.

### 5. A bucket for backups (AWS S3)
Keep backups outside Oracle: if the Oracle account is ever suspended, the
server and anything else in it go together.

1. S3 → Create bucket, region **Asia Pacific (Sydney) ap-southeast-2**, a
   unique name such as `beyond-postiz-backups-<random>`. Keep "Block all
   public access" on. Turn on **Bucket Versioning**.
2. Add the lifecycle rules in `iam/s3-lifecycle.json` (Management →
   Lifecycle rules, or
   `aws s3api put-bucket-lifecycle-configuration --bucket <bucket> --lifecycle-configuration file://deploy/vps/iam/s3-lifecycle.json`).
   Dumps go after 30 days; media in `uploads/` is kept, because it is the
   only off-server copy.
3. IAM → Users → Create user `postiz-backup` (no console access). Add an
   inline policy from `iam/s3-backup-user-policy.json`, with `BACKUP_BUCKET`
   replaced by the bucket name.
4. The user → Security credentials → Create access key → "Application
   running outside AWS". Copy the Access Key ID and the Secret Access Key.

The key can add and read backups but not delete them, and versioning keeps
the old copy if one is ever overwritten, so a compromised server can't
destroy the backups.

**Cloudflare R2 instead** (free up to 10 GB): create bucket `postiz-backups`
with location hint Oceania, add a lifecycle rule deleting `backups/` after
30 days, and create an API token with **Object Read & Write** on that bucket
only. In `backup.env` set `BACKUP_PROVIDER=r2` and `R2_ACCOUNT_ID`. R2 tokens
can delete, so this loses the protection above.

### 6. The `.env` and `backup.env` files
On the server (`ssh ubuntu@<server-ip>`, then `sudo -i`):
```
nano /opt/postiz/.env          # paste server/env.example and fill it in
nano /opt/postiz/backup.env    # paste server/backup.env.example and fill it in
chmod 600 /opt/postiz/.env /opt/postiz/backup.env
```
Generate each password with `openssl rand -hex 32`. Keep a copy of both
files in your password manager.

### 7. DNS at Hostinger
Domains → `beyondhimalayatech.com.au` → DNS records → add:
`A` record, name `postiz`, points to the server IP, TTL 300.
It has to resolve before the first deploy, or Caddy can't get a certificate.

### 8. GitHub
Repo → Settings → Secrets and variables → Actions.

**Secret** `DEPLOY_SSH_KEY`: the whole content of `~/.ssh/postiz-deploy`
(the private key).

**Variables**:

| Name | Value |
|---|---|
| `DEPLOY_HOST` | the server IP |
| `DEPLOY_KNOWN_HOSTS` | the output of this, run on the server: `echo "<server-ip> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"` |

`DEPLOY_KNOWN_HOSTS` pins the server's identity, so GitHub refuses to deploy
to anything pretending to be it.

The deploy key is effectively root on the server (it deploys code that runs
there). Anyone with write access to the repo can use it through a workflow,
so give write access only to people you'd trust with the server.

### 9. First deploy
The workflow file has to be on `main` before GitHub shows it. Merge it, which
also starts the first deploy, or later use Actions → "Deploy to server" → Run
workflow. The first
build takes 20-30 minutes. Then open `https://postiz.beyondhimalayatech.com.au`,
sign up (this first account owns the workspace), and lock sign-ups:
```
sudo sed -i 's/^DISABLE_REGISTRATION=.*/DISABLE_REGISTRATION=true/' /opt/postiz/.env
cd /opt/postiz && sudo docker compose up -d postiz
```
Invite teammates from Settings.

### 10. Safety nets
1. **Boot volume backup:** Storage → Block volume backup policies → create a
   policy with one **weekly** backup kept for **4 weeks**, and assign it to
   the instance's boot volume. That stays within the 5 free backups.
2. **Uptime alert:** add a free monitor at uptimerobot.com for
   `https://postiz.beyondhimalayatech.com.au`, alerting your email.

### 11. Prove it works (do this once)
- **Backup and restore:** `sudo /opt/postiz/backup.sh manual`, then restore
  that file with `restore.sh` and check your data is there.
- **Rollback:** run the workflow with `image_tag` set to the previous commit's
  full SHA and confirm the app comes back.

## How a deploy works
1. GitHub sends the commit's source (about 13 MB) to the server, which builds
   `postiz-app:<sha>`. The live version keeps running during the build.
2. GitHub sends the release files (compose, Caddyfile, scripts) and runs
   `deploy.sh`. It runs as its own systemd unit, so a dropped connection
   doesn't stop it halfway. Its log is
   `/var/log/postiz-deploy/<run id>-<attempt>.log`, kept for 60 days.
3. `deploy.sh` backs up the database, then asks Prisma whether the new
   version changes it:
   - **No database change:** switch images. If the new version doesn't answer
     within 5 minutes, the old image, compose file and Caddyfile are put back
     automatically.
   - **Database change:** `prisma db push` runs while the old version keeps
     serving. If Prisma refuses (for example because data would be lost), the
     deploy stops and nothing switched. If the change applies but the new
     version then fails, there is **no automatic rollback** (the old code
     would try to undo the change and fail to start). The log prints the exact
     restore command.

**Rollbacks** (running the workflow with `image_tag`) pass `--keep-schema`:
the older image runs against the newer database as it is, with no
`db push`. That works when the newer version only added tables or columns.
If it renamed or removed something the old code needs, use `restore.sh`
with the pre-deploy backup instead. Only images still on the server can be
rolled back to; for anything older, re-run that commit's workflow.

**Check once after the first deploy:** Postiz keeps Mastra's AI tables in the
same database. After the app has been used for a while (including its AI
features), compare the database with the schema without changing anything:
```
cd /opt/postiz && sudo docker compose run --rm --no-deps -T postiz sh -c \
  'pnpm dlx prisma@6.5.0 migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel ./libraries/nestjs-libraries/src/database/prisma/schema.prisma --script'
```
It should print `-- This is an empty migration.` If it lists changes nobody made, Mastra's
tables have drifted from `schema.prisma`: every deploy then runs `db push`,
which would try to undo them and will refuse if that drops data, so **every
deploy would fail**. Fix `schema.prisma` to match before the next deploy.

Each deploy ends by checking that `missing-post-workflow` is running in
Temporal. That is the hourly sweep that re-queues posts Temporal lost, and it
only runs with `RUN_CRON` set (the compose file sets it).

**Not tested before first use:** these scripts were checked for syntax and
the compose file validates, but nothing has run on a real server yet, and
this fork has not been built for ARM before. Watch the first deploy's log in
GitHub Actions. The schema check looks for Prisma's
`-- This is an empty migration.` line; if a deploy with no schema change
reports one, check that text in the log. `cron_running` reads the text output of
`temporal workflow describe`; if the first deploy says the missed-post sweep
isn't running while the Temporal UI shows `missing-post-workflow` as
Running, the output format differs and the check needs adjusting.

## Runbook

Log in with `ssh ubuntu@<server-ip>`, then `sudo -i` and `cd /opt/postiz`.

| Situation | What to do |
|---|---|
| See what's running | `docker compose ps`, `docker compose logs --tail 100 postiz` |
| Read a deploy's log | `ls -t /var/log/postiz-deploy/ \| head`, then `less` the newest |
| Roll back to an older version | GitHub → Actions → Deploy to server → Run workflow, `image_tag` = that commit's full SHA (database left as it is). `docker image ls postiz-app` lists what's available |
| Database broken, need a backup | Find the file in the bucket's `backups/` folder (S3 console, or Cloudflare → R2; the 7 newest are also in `/opt/postiz/backups`), then `./restore.sh <file name> [image-tag]`, which downloads it if needed |
| Temporal data lost | `docker compose restart postiz` so the missed-post sweep starts again. Posts due in the last 2 days go out within the hour |
| Changed `.env` | `docker compose up -d postiz` (a plain restart does not reload `.env`) |
| Open the Temporal UI | On your laptop: `ssh -L 8080:localhost:8080 ubuntu@<server-ip>`, then open `http://localhost:8080` |
| Disk filling up | `df -h`, `docker system df`. Uploads live in the `postiz_postiz-uploads` volume |
| Oracle reclaimed or lost the server | Create a new one (steps 3-8), copy `.env` and `backup.env` back, deploy, then `SKIP_PRE_RESTORE_BACKUP=1 ./restore.sh` the newest nightly backup, then bring the media back: `bash -c 'source lib.sh && backup_store_setup && rclone copy "store:$BACKUP_BUCKET/uploads/" "$(uploads_dir)"'` |

**Never run `docker compose down -v`.** The `-v` deletes every database volume.

## Fallback: a paid server

If Oracle never has capacity, or the account causes trouble, the same files
work on any Ubuntu 24.04 server, for example Hetzner. Because the image is
built on the server, pick one with **16 GB of RAM** (the build needs about
4-6 GB on top of the running app), then follow steps 2-11, skipping the
Oracle-specific parts (Pay As You Go, security list; use the provider's own
firewall to allow 22, 80 and 443 instead). Hetzner's login user is `root`
rather than `ubuntu`.
