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

## First Teacher Bootstrap

On a clean production database, run migrations first, then create the first teacher with the one-time bootstrap command:

```powershell
$env:BOOTSTRAP_TEACHER_EMAIL="teacher@example.com"
$env:BOOTSTRAP_TEACHER_PASSWORD="<unique-strong-password>"
$env:BOOTSTRAP_TEACHER_NAME="Teacher Name"
pnpm --dir oge-tutor-backend run bootstrap:teacher
```

The command can also receive CLI flags:

```powershell
pnpm --dir oge-tutor-backend run bootstrap:teacher -- --email teacher@example.com --password "<unique-strong-password>" --name "Teacher Name"
```

For the Compose runtime, run it against the backend image after `migrate` has completed:

```bash
docker compose run --rm \
  -e BOOTSTRAP_TEACHER_EMAIL=teacher@example.com \
  -e BOOTSTRAP_TEACHER_PASSWORD='<unique-strong-password>' \
  -e BOOTSTRAP_TEACHER_NAME='Teacher Name' \
  backend pnpm run bootstrap:teacher
```

This command is intentionally one-time: it refuses to run when any teacher already exists and never prints the password. Do not run `prisma:seed` in production; the seed is destructive demo data only.

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

### One-Time VPS Setup

Provision the server before running the workflow:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl rsync
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Create the deploy directory and ensure the SSH deploy user can write to it:

```bash
sudo mkdir -p /opt/oge-tutor
sudo chown "$USER":"$USER" /opt/oge-tutor
docker compose version
```

The workflow syncs the repository to `DEPLOY_PATH` with `rsync`, writes a server-side `.env` from GitHub Secrets, runs `docker compose config`, then runs:

```bash
docker compose up -d --build
docker compose ps
```

It finishes by checking:

```bash
curl --fail "$PUBLIC_BACKEND_URL/health"
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
curl --fail "$APP_FRONTEND_URL"
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
MAILER_PROVIDER
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

Set `MAILER_PROVIDER=smtp` for VPS deployment. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `SMTP_FROM` must be real provider values; production startup rejects incomplete SMTP configuration.

If `DATABASE_URL` points to an external managed database, `POSTGRES_PASSWORD` can be empty, but the bundled `postgres` service will still be present in Compose unless the Compose file is adapted for the managed database target.

### Manual Deploy Run

After all Secrets are configured:

1. Open GitHub Actions.
2. Select `Manual VPS Deploy`.
3. Click `Run workflow`.
4. Use branch `main`.
5. Set `confirm` to `deploy-vps`.

After the workflow succeeds, verify the server:

```bash
cd "$DEPLOY_PATH"
docker compose ps
curl --fail "$PUBLIC_BACKEND_URL/health"
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
curl --fail "$APP_FRONTEND_URL"
```

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
