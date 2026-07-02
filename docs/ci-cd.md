# CI/CD and Local Quality Gate

This repository uses pnpm as the only package manager for the frontend and backend.

## Local Install

From the repository root:

```powershell
pnpm install --frozen-lockfile
```

There is one workspace lockfile at the repository root:

```text
pnpm-lock.yaml
```

Do not add per-package npm or pnpm lockfiles unless the workspace strategy changes.

## Local Quality Gate

Run the full gate from the repository root:

```powershell
pnpm run quality
```

Equivalent explicit commands:

```powershell
pnpm --dir oge-tutor-backend run prisma:generate
pnpm --dir oge-tutor-backend run build
pnpm --dir oge-tutor-backend run lint
pnpm --dir oge-tutor-backend test

pnpm --dir oge-tutor-app run build
pnpm --dir oge-tutor-app run lint
pnpm --dir oge-tutor-app run typecheck
pnpm --dir oge-tutor-app test
```

AppModule e2e tests require a real PostgreSQL test database:

```powershell
$env:E2E_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/oge_tutor_e2e?schema=public"
pnpm --dir oge-tutor-backend exec prisma migrate deploy
pnpm --dir oge-tutor-backend run test:e2e
```

Without `E2E_DATABASE_URL`, the local e2e command skips safely and CI remains the source of truth for the database-backed e2e run.

## Prisma Migration Check

With Docker running:

```powershell
cd "C:\Users\Goman Nikita\Downloads\oge-tutor-app-v2"
docker compose up -d postgres
cd .\oge-tutor-backend
pnpm exec prisma migrate status
pnpm exec prisma migrate deploy
pnpm run prisma:generate
```

CI uses a clean PostgreSQL service and runs:

```powershell
pnpm --dir oge-tutor-backend exec prisma migrate deploy
pnpm --dir oge-tutor-backend exec prisma migrate status
```

Seed is not run in CI.

## GitHub Actions CI

`.github/workflows/ci.yml` runs on `push` and `pull_request`.

Jobs:

- `backend`: install, Prisma generate, build, lint, tests.
- `frontend`: install, build, lint, typecheck, tests.
- `prisma-db-check`: clean PostgreSQL service, migration deploy, migration status.
- `e2e`: clean PostgreSQL service, migration deploy, AppModule HTTP e2e tests.
- `docker-build`: backend and frontend Docker image builds.
- `audit`: workspace dependency audit with `--audit-level moderate`. It is blocking now that the Nest 11 upgrade removed the previous known advisories.

## Manual VPS Deployment

`.github/workflows/deploy.yml` runs only via `workflow_dispatch`.

It runs the quality gate, AppModule e2e tests and Docker builds first. A real VPS deploy starts only when the workflow input is:

```text
confirm=deploy-vps
```

If required secrets are missing, the deploy job fails before any server changes. See [deployment.md](deployment.md) for the secret list and server requirements.

## Do Not Commit

```text
.env
.env.*
node_modules/
dist/
uploads/
.idea/
oge-tutor-backend.__before_restore_*/
database dumps
local logs
```
