# Deployment

The repository contains Dockerfiles and a root Compose file for a production-style local runtime.

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

## Migrations

Production and CI use:

```powershell
pnpm --dir oge-tutor-backend exec prisma migrate deploy
pnpm --dir oge-tutor-backend exec prisma migrate status
```

Do not use `prisma migrate dev` for production.

Seed is not run automatically by Compose or CI.

## Health Checks

Backend:

```text
GET /health
GET /health/ready
```

`/health/ready` checks database connectivity.

## GitHub Actions Deployment Scaffold

`.github/workflows/deploy.yml` is manual-only (`workflow_dispatch`).

It runs:

- workspace quality gate;
- AppModule e2e tests with PostgreSQL service;
- backend and frontend Docker builds.

The `template` target does not deploy. The `vps` target validates required secrets and intentionally stops before running server-specific commands.

Required future secret names for VPS-style deployment:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_PATH
DATABASE_URL
JWT_SECRET
PUBLIC_BACKEND_URL
SMTP_HOST
SMTP_USER
SMTP_PASS
```

Before enabling real CD, choose the target platform and add target-specific deploy steps for VPS, Render, Railway, Vercel or another provider.
