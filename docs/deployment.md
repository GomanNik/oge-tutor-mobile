# Deployment

The repository contains Dockerfiles and a root Compose file for a production-style runtime:

- PostgreSQL 16;
- one-shot migration service using `prisma migrate deploy`;
- NestJS backend;
- nginx-served Vite frontend;
- persistent uploads volume.

## Local Docker Compose

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Services:

- `postgres`: PostgreSQL 16.
- `migrate`: runs `prisma migrate deploy` once.
- `backend`: runs the built NestJS app.
- `frontend`: serves the Vite static build through nginx.

Uploads are stored in the `oge_tutor_uploads` Docker volume.

## Production Migrations

Production and CI use:

```powershell
pnpm --dir oge-tutor-backend exec prisma migrate deploy
pnpm --dir oge-tutor-backend exec prisma migrate status
```

Do not use `prisma migrate dev` for production. Seed is not run automatically by Compose, CI or deploy.

## Health Checks

Backend:

```text
GET /health
GET /health/ready
```

`/health/ready` checks database connectivity.

## VPS Deployment

`.github/workflows/deploy.yml` is manual-only (`workflow_dispatch`). It runs:

- workspace quality gate;
- AppModule e2e tests with a PostgreSQL service;
- backend and frontend Docker builds;
- VPS deployment through SSH when the workflow input is `confirm=deploy-vps`.

The workflow syncs the repository to `DEPLOY_PATH` with `rsync`, writes a server-side `.env` from GitHub Secrets, runs `docker compose config`, then runs:

```bash
docker compose up -d --build
docker compose ps
```

It finishes by checking:

```bash
curl --fail "$PUBLIC_BACKEND_URL/health"
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
```

### Required GitHub Secrets

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PATH
DATABASE_URL
JWT_SECRET
PUBLIC_BACKEND_URL
APP_FRONTEND_URL
FRONTEND_ORIGIN
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

Recommended for the bundled PostgreSQL service:

```text
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD
```

Optional:

```text
SMTP_SECURE
```

If `DATABASE_URL` points to an external managed database, `POSTGRES_PASSWORD` can be empty, but the bundled `postgres` service will still be present in Compose unless the Compose file is adapted for the managed database target.

## Server Requirements

The VPS needs:

- Docker Engine and Docker Compose plugin;
- an SSH user allowed to write to `DEPLOY_PATH`;
- enough disk space for Docker images, PostgreSQL data and uploads;
- firewall rules exposing the chosen frontend/backend ports or a reverse proxy in front of them.

The workflow does not install Docker on the server. Provisioning remains a one-time server setup task.

## Rollback

To roll back on the VPS:

```bash
cd "$DEPLOY_PATH"
git rev-parse HEAD
git checkout <previous-good-commit>
docker compose up -d --build
docker compose ps
```

If deployment uses rsync without a Git checkout on the server, keep a copy of the previous release directory or restore it from the server backup before running Compose again.
