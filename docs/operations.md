# Operations Runbook

This runbook assumes the VPS deployment uses the root `docker-compose.yml`.

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

## PostgreSQL Backup

Create a backup directory outside the repository:

```bash
mkdir -p "$HOME/oge-tutor-backups"
```

Dump the database:

```bash
cd "$DEPLOY_PATH"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-oge_tutor}" > "$HOME/oge-tutor-backups/oge_tutor_$(date +%Y%m%d_%H%M%S).sql"
```

For MVP, take at least a daily database backup and copy it to encrypted off-server storage.

## PostgreSQL Restore

Stop write traffic first, then restore into the intended database:

```bash
cd "$DEPLOY_PATH"
docker compose exec -T postgres psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-oge_tutor}" < "$HOME/oge-tutor-backups/<backup-file>.sql"
```

Validate:

```bash
docker compose run --rm migrate
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
```

## Uploads Backup

Archive the uploads volume:

```bash
cd "$DEPLOY_PATH"
docker run --rm -v "$(basename "$DEPLOY_PATH")_oge_tutor_uploads:/data:ro" -v "$HOME/oge-tutor-backups:/backup" alpine sh -c 'tar czf /backup/uploads_$(date +%Y%m%d_%H%M%S).tgz -C /data .'
```

If the Compose project name is customized, replace the volume name accordingly. Never commit upload archives to git.

## Uploads Restore

```bash
cd "$DEPLOY_PATH"
docker compose stop backend
docker run --rm -v "$(basename "$DEPLOY_PATH")_oge_tutor_uploads:/data" -v "$HOME/oge-tutor-backups:/backup" alpine sh -c 'rm -rf /data/* && tar xzf /backup/<uploads-backup>.tgz -C /data'
docker compose up -d backend
```

## Rollback

If the server keeps a Git checkout:

```bash
cd "$DEPLOY_PATH"
git checkout <previous-good-commit>
docker compose up -d --build
curl --fail "$PUBLIC_BACKEND_URL/health/ready"
```

If deployment uses rsync release copies, restore the previous release directory and rerun:

```bash
docker compose up -d --build
```

Before rolling back code across database migrations, check whether the migration is backward-compatible. Restore a database backup if the previous code cannot read the current schema.
