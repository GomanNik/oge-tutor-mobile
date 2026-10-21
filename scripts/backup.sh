#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
umask 077

backup_root="${BACKUP_DIR:-$PWD/backups}"
mkdir -p "$backup_root"
backup_root="$(cd "$backup_root" && pwd -P)"
chmod 700 "$backup_root"
database_container="$(docker compose ps -q postgres)"
backend_container="$(docker compose ps -q backend)"

if [[ -z "$database_container" || -z "$backend_container" ]]; then
  echo 'PostgreSQL and backend must be running in this Compose project.' >&2
  exit 1
fi

uploads_volume="$(docker inspect "$backend_container" --format '{{range .Mounts}}{{if eq .Destination "/app/oge-tutor-backend/uploads"}}{{.Name}}{{end}}{{end}}')"
if [[ -z "$uploads_volume" ]]; then
  echo 'Backend uploads volume was not found.' >&2
  exit 1
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
pending="$(mktemp -d "$backup_root/.pending-$stamp-XXXXXX")"
final="$backup_root/backup-$stamp-${pending##*-}"
backend_stopped=0

cleanup() {
  if [[ "$backend_stopped" -eq 1 ]]; then
    docker start "$backend_container" >&2 || true
  fi
  if [[ -d "$pending" ]]; then
    rm -f "$pending/database.dump" "$pending/uploads.tar.gz" "$pending/SHA256SUMS"
    rmdir "$pending"
  fi
}
trap cleanup EXIT

backend_stopped=1
docker compose stop backend > /dev/null
docker exec "$database_container" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$pending/database.dump"
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$uploads_volume:/data:ro" \
  postgres:16-alpine tar -czf - -C /data . > "$pending/uploads.tar.gz"

test -s "$pending/database.dump"
test -s "$pending/uploads.tar.gz"
docker exec -i "$database_container" pg_restore --list < "$pending/database.dump" > /dev/null
tar -tzf "$pending/uploads.tar.gz" > /dev/null

(cd "$pending" && sha256sum database.dump uploads.tar.gz > SHA256SUMS)
docker start "$backend_container" > /dev/null
backend_stopped=0
healthy=0
for _ in {1..60}; do
  if [[ "$(docker inspect "$backend_container" --format '{{.State.Health.Status}}')" == 'healthy' ]]; then
    healthy=1
    break
  fi
  sleep 1
done
if [[ "$healthy" -ne 1 ]]; then
  echo 'Backend did not become healthy after backup.' >&2
  exit 1
fi
mv "$pending" "$final"
trap - EXIT
printf 'Backup ready: %s\n' "$final"
