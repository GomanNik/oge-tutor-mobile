# Operations Runbook

This runbook assumes a VPS deployment using the root `docker-compose.yml`. As of 2026-10-22 there is no VPS for this project, so the deployment and timer steps below are preparation, not evidence of an active service. The proposed multi-subject platform has its own [target architecture and rollout plan](platform/README.md); this runbook describes the current stack only.

## Manual Deploy

Use GitHub Actions for staging deployment:

1. Open Actions.
2. Select `Manual VPS Deploy`.
3. Click `Run workflow`.
4. Select branch `main`.
5. Enter `deploy-vps` in the `confirm` input.

The workflow runs quality checks, AppModule e2e tests, Docker builds, syncs files to the VPS, writes `.env`, runs `docker compose up -d --build`, then checks backend and frontend endpoints.

## Health

Backend liveness:

```bash
curl --fail "$PUBLIC_BACKEND_URL/health"
```

Backend readiness with database check:

```bash
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
```

Container state:

```bash
cd "$DEPLOY_PATH"
docker compose ps
```

Frontend:

```bash
curl --fail "$APP_FRONTEND_URL"
```

## SMTP

Staging and production require SMTP. Configure these GitHub Secrets before deployment:

```text
MAILER_PROVIDER=smtp
SMTP_HOST=<provider-host>
SMTP_PORT=587
SMTP_USER=<provider-user>
SMTP_PASS=<provider-password>
SMTP_FROM=OGE Tutor <no-reply@example.com>
```

Use `SMTP_SECURE=true` only when the provider requires implicit TLS, usually on port `465`; otherwise keep it `false` for STARTTLS on port `587`.

After deploy, send a password reset or invite flow from the app and verify:

```bash
cd "$DEPLOY_PATH"
docker compose logs --tail=200 backend
```

## Logs

```bash
cd "$DEPLOY_PATH"
docker compose logs --tail=200 backend
docker compose logs --tail=200 frontend
docker compose logs --tail=200 postgres
```

Follow backend logs:

```bash
docker compose logs -f backend
```

Backend request logs are structured JSON and include `requestId`, method, path, status and duration. They do not log authorization headers, raw tokens, passwords or request body values.

## Restart

```bash
cd "$DEPLOY_PATH"
docker compose up -d
docker compose ps
```

Restart only the backend:

```bash
docker compose restart backend
```

## Migrations

Apply pending production migrations:

```bash
cd "$DEPLOY_PATH"
docker compose run --rm migrate
docker compose exec backend pnpm --dir /app/oge-tutor-backend exec prisma migrate status
```

Do not run `prisma migrate dev` against production.

## Database and Upload Backups

Use the [verified database-and-uploads backup procedure](backups.md). It snapshots both components together, checks hashes, and tests an isolated restore. A database-only dump or an uploads-only archive is not a complete recovery point. Keep an encrypted off-server copy and alert on stale/failed backups. The systemd timer must be installed and enabled **on the actual VPS**; merely merging its script does not schedule backups.

Never restore directly over the only live copy. Preserve the failing environment, restore into a new isolated environment first, validate data and file links, plan write downtime and only then perform a controlled cutover. The repository scripts deliberately do not overwrite the live database or volume. A production restore needs a separate reviewed runbook for the exact deployment and backup location.

## Rollback

Identify the exact previously healthy release and check whether its schema is compatible with the **current** database before changing containers. The manual deploy uses rsync rather than guaranteeing a Git checkout on the VPS; keep an immutable copy of the previous release. If new writes have used a newer schema, reverting only code can corrupt or hide data. Prefer a forward fix where possible; restoring a snapshot loses later writes unless they are reconciled. See [the platform migration plan](platform/migration-and-acceptance.md) for the future multi-subject rollout rules.
