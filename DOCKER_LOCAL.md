# Running Postiz locally with Docker

This builds Postiz from **this checkout**, including your local changes, and runs the full stack in Docker: the app, Postgres, Redis and Temporal. You don't need Node, pnpm or a local database.

## Prerequisites

- Docker Desktop, or Colima, running
- About 8 GB of memory available to Docker. The build uses up to 4 GB.
- Ports `4007`, `7233` and `8080` free on your machine

## Build, run and test (one command)

From the repo root:

```bash
docker compose -p postiz-local -f docker-compose.yaml -f docker-compose.local.yaml up -d --build
```

Then open **http://localhost:4007** and register an account.

- The first build takes 10–15 minutes. Later builds reuse Docker's cache and are faster.
- Database tables are created or updated automatically when the app starts (`prisma db push`).
- `-p postiz-local` gives this stack its own containers and volumes, kept separate from the dev stack.

## What runs

| Service            | URL / port            | Notes                                    |
| ------------------ | --------------------- | ---------------------------------------- |
| Postiz (app + API) | http://localhost:4007 | API is served under `/api`               |
| Temporal UI        | http://localhost:8080 | Background jobs, such as post publishing |
| Temporal           | `localhost:7233`      |                                          |
| Spotlight          | http://localhost:8969 | Debugging / monitoring                   |
| Postgres, Redis    | internal only         | Not exposed to your machine              |

## Everyday commands

```bash
# Rebuild after changing code (same command as above)
docker compose -p postiz-local -f docker-compose.yaml -f docker-compose.local.yaml up -d --build

# Follow the app logs
docker logs -f postiz

# See running containers
docker compose -p postiz-local -f docker-compose.yaml -f docker-compose.local.yaml p

# Stop everything (keeps data)
docker compose -p postiz-local -f docker-compose.yaml -f docker-compose.local.yaml down

# Stop and DELETE all data (database, uploads)
docker compose -p postiz-local -f docker-compose.yaml -f docker-compose.local.yaml down -v
```

## Configuration

- **Core settings**, such as URLs, the database, Redis and Temporal, are set in `docker-compose.yaml` under the `postiz` service.
- **Everything else** comes from your root `.env`, which is copied into the image at build time. This includes social media app keys and `GOOGLE_SEO_*` / `YANDEX_*`. A value in `docker-compose.yaml` always wins over `.env`. **Rebuild after editing `.env`.**
- **OAuth redirect URLs** must use port 4007. Register these with each provider:
  - Social channels: `http://localhost:4007/integrations/social/<provider>`
  - Google Analytics 4: `http://localhost:4007/websites/oauth/ga4`
  - Google Search Console: `http://localhost:4007/websites/oauth/search-console`
  - Yandex Webmaster: `http://localhost:4007/websites/oauth/yandex-webmaster`
- **Platforms that need a public HTTPS URL** (TikTok, Threads, Pinterest, and Instagram media) won't work on `localhost`. Put a tunnel in front of port 4007, for example `cloudflared tunnel --url http://localhost:4007`. Then set `MAIN_URL`, `FRONTEND_URL` and `NEXT_PUBLIC_BACKEND_URL` (`<tunnel>/api`) in `docker-compose.yaml` to the tunnel URL.

## Troubleshooting

- **`port is already allocated`**: another container is using the port. Find it with `docker ps`, then stop it or change the port mapping.
- **Container name conflicts (`postiz-postgres`, `temporal`, ...)**: the dev stack is still running. Stop it with `docker compose -f docker-compose.dev.yaml down`.
- **Build runs out of memory**: increase Docker's memory limit in Docker Desktop under Settings → Resources.
- **App starts but the page is blank or errors**: check `docker logs -f postiz`. Database or Temporal connection errors usually clear up once those containers are healthy.

## Faster alternative for active development

Rebuilding the image after every change is slow. While coding, run only the supporting services in Docker and the apps from your machine with hot reload:

```bash
pnpm run dev:docker          # Postgres, Redis, Temporal (+ pgAdmin :8085, RedisInsight :5540)
pnpm install && pnpm run prisma-db-push
pnpm run dev                 # backend :3000, frontend :4200, orchestrator
docker compose -f docker-compose.dev.yaml down
docker compose -f docker-compose.dev.yaml stop


```

This needs Node 22, pnpm 10, and in `.env`:
`DATABASE_URL="postgresql://postiz-local:postiz-local-pwd@localhost:5432/postiz-db-local"`.
Don't run this and the full Docker stack at the same time, because they use the same container names.
