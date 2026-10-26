# OGE Tutor

Tutor and student application with a React frontend, NestJS API, PostgreSQL, and Prisma.

## Local quality check

Use Node.js 22 and pnpm 9.15.9. From the repository root in PowerShell:

```powershell
pnpm install --frozen-lockfile
$env:VITE_API_BASE_URL = 'http://localhost:3000'
pnpm run quality
```

The API URL is embedded in a production frontend build. Set it to the actual API address when building for deployment. Mock mode is rejected by production builds.

## Run locally

For a frontend-only demo:

```powershell
$env:VITE_USE_MOCK = 'true'
pnpm --dir oge-tutor-app run dev
```

For the full stack, copy `.env.example` to `.env` and run `docker compose up -d --build`. The full stack requires a running Docker engine and serves the frontend on `http://localhost:8080`.

See [frontend setup](oge-tutor-app/README.md), [backend setup](oge-tutor-backend/README.md), [current HTTP API](docs/api.md), [environment variables](docs/env.md), and [deployment](docs/deployment.md).

The [multi-subject and group-learning platform design](docs/platform/README.md) describes the roadmap. Blocks 1–6 are accepted in `main`: workspace identity, catalog, courses, enrollments, group lessons, assignments, reviews, materials, files, progress and addressed notifications under `/api/v2`. This branch implements [Block 7: recurring lessons and v2 cutover](docs/platform/block-7-series-cutover.md), with explicit previews, bounded rolling materialization, account recovery, data/file reconciliation and a restored-API drill. See its [verification report](docs/platform/block-7-verification.md) and [cutover runbook](docs/platform/block-7-operations.md). Branch implementation is not production rollout or owner acceptance.

Legacy routes default to enabled. `LEGACY_API_MODE=read_only` freezes v1 educational writes; `disabled` retires v1 and makes imported resources writable through v2. Disabling requires an explicit cutover confirmation and persists a database barrier against configuration-only rollback. Do not toggle this on a working database before following the runbook. Historical tables and files are retained.

Before changing a running stack, create and verify a [database and uploads backup](docs/backups.md).
