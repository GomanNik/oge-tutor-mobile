#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
source scripts/backup-common.sh
backup_init

run_id="run-$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
started_epoch="$(date +%s)"
stage=lock
status=failed
backup_name=
backend_stopped=0
pending=
mkdir -p "$backup_root/runs"
exec > >(tee -a "$backup_root/runs/$run_id.log") 2>&1

finish() {
  local rc=$?
  trap - EXIT INT TERM
  if [[ "$backend_stopped" == 1 ]]; then
    if ! docker start "$backend_container"; then
      echo 'CRITICAL: backend restart failed; operator intervention required.' >&2
      stage=restart-failed
      rc=1
    fi
  fi
  # Failed snapshots remain private for diagnosis; retention never removes them.
  if [[ -n "$pending" && -d "$pending" ]]; then
    echo "Incomplete snapshot retained: $pending"
  fi
  [[ "$rc" == 0 ]] || status=failed
  local record="$backup_root/runs/$run_id.record"
  {
    printf 'status=%s\nstage=%s\nexit_code=%s\n' "$status" "$stage" "$rc"
    printf 'started_epoch=%s\nfinished_epoch=%s\n' "$started_epoch" "$(date +%s)"
    printf 'backup=%s\nrun=%s\n' "$backup_name" "$run_id"
  } > "$record.tmp"
  mv "$record.tmp" "$record"
  cp "$record" "$backup_root/.latest-$run_id"
  mv "$backup_root/.latest-$run_id" "$backup_root/latest.record"
  if [[ "$rc" == 0 ]]; then
    cp "$record" "$backup_root/.success-$run_id"
    mv "$backup_root/.success-$run_id" "$backup_root/latest-success.record"
  fi
  printf 'Backup run %s: %s (stage=%s, exit=%s)\n' "$run_id" "$status" "$stage" "$rc"
  exit "$rc"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

backup_lock
stage=preflight
backup_validate_retention
database_container="$(docker compose ps -q postgres)"
backend_container="$(docker compose ps -q backend)"
if [[ -z "$database_container" || -z "$backend_container" ]]; then
  echo 'PostgreSQL and backend must be running in this Compose project.' >&2
  exit 1
fi

# Refuse to back up the bundled database when the app uses a managed database.
database_name="$(docker exec "$database_container" sh -c 'printf %s "$POSTGRES_DB"')"
docker exec "$backend_container" node -e '
  try {
    const u = new URL(process.env.DATABASE_URL);
    if (u.hostname !== "postgres" || (u.port && u.port !== "5432") ||
      decodeURIComponent(u.pathname.slice(1)) !== process.argv[1]) {
      throw new Error();
    }
  } catch {
    console.error("Backup requires a valid URL for the bundled Compose PostgreSQL database.");
    process.exit(1);
  }
' "$database_name"
uploads_volume="$(docker inspect "$backend_container" --format '{{range .Mounts}}{{if eq .Destination "/app/oge-tutor-backend/uploads"}}{{.Name}}{{end}}{{end}}')"
if [[ -z "$uploads_volume" ]]; then
  echo 'Backend uploads volume was not found.' >&2
  exit 1
fi
docker image inspect postgres:16-alpine > /dev/null
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pending="$(mktemp -d "$backup_root/.pending-$stamp-XXXXXX")"
backup_name="backup-$stamp-${pending##*-}"
stage=snapshot
backend_stopped=1
docker compose stop backend > /dev/null
docker exec "$database_container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$pending/database.dump"
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$uploads_volume:/data:ro" \
  postgres:16-alpine tar -czf - -C /data . > "$pending/uploads.tar.gz"
test -s "$pending/database.dump"
test -s "$pending/uploads.tar.gz"
(cd "$pending" && sha256sum database.dump uploads.tar.gz > SHA256SUMS)

stage=restart
docker start "$backend_container" > /dev/null
backend_stopped=0
healthy=0
for _ in {1..60}; do
  if [[ "$(docker inspect "$backend_container" --format '{{.State.Health.Status}}')" == healthy ]]; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" != 1 ]]; then
  echo 'Backend did not become healthy after backup.' >&2
  exit 1
fi
mv "$pending" "$backup_root/$backup_name"
pending=
stage=restore-check
bash scripts/verify-backup.sh "$backup_root/$backup_name"
stage=retention
backup_prune
stage=complete
status=success
printf 'Verified backup ready: %s\n' "$backup_root/$backup_name"
