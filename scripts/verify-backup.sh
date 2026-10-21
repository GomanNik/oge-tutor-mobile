#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo 'Usage: scripts/verify-backup.sh BACKUP_DIRECTORY' >&2
  exit 2
fi

backup_dir="$(cd "$1" && pwd -P)"
(cd "$backup_dir" && sha256sum -c SHA256SUMS)
tar -tzf "$backup_dir/uploads.tar.gz" > /dev/null

container="oge-tutor-restore-$(date +%s)-$RANDOM"
cleanup() {
  docker rm -f "$container" > /dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$container" --network none \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=restore-check-only \
  -e POSTGRES_DB=oge_tutor_restore \
  postgres:16-alpine > /dev/null

ready=0
for _ in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d oge_tutor_restore > /dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo 'Temporary PostgreSQL did not become ready.' >&2
  exit 1
fi

docker cp "$backup_dir/database.dump" "$container:/tmp/database.dump" > /dev/null
MSYS_NO_PATHCONV=1 docker exec "$container" pg_restore -U postgres -d oge_tutor_restore \
  --no-owner --no-privileges /tmp/database.dump

tables="$(docker exec "$container" psql -U postgres -d oge_tutor_restore -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ "$tables" -lt 1 ]]; then
  echo 'Restore completed without application tables.' >&2
  exit 1
fi

printf 'Restore verified: %s application tables in an isolated container.\n' "$tables"
