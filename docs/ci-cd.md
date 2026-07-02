# CI/CD and Local Quality Gate

This repository uses pnpm as the only package manager for the frontend and backend.

## Local install

From the repository root:

```powershell
pnpm install --frozen-lockfile
```

There is one workspace lockfile at the repository root:

```text
pnpm-lock.yaml
```

Do not add per-package npm or pnpm lockfiles unless the workspace strategy changes.

## Local quality gate

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

## Prisma migration check

With Docker running:

```powershell
cd "C:\Users\Goman Nikita\Downloads\oge-tutor-app-v2\oge-tutor-backend"
docker compose up -d
pnpm exec prisma migrate status
pnpm exec prisma migrate dev
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
- `audit`: workspace dependency audit. It is non-blocking while planned major upgrades are still pending.

## Manual deployment scaffold

`.github/workflows/deploy.yml` runs only via `workflow_dispatch`.

It runs the quality gate first. The deploy job is a scaffold and does not attempt a production deploy until a real hosting target is selected.

Expected future secret names:

```text
DATABASE_URL
JWT_SECRET
PUBLIC_BACKEND_URL
DEPLOY_HOST
DEPLOY_USER
DEPLOY_SSH_KEY
FRONTEND_DEPLOY_TOKEN
```

Do not put secret values in the repository.

## Do not commit

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
