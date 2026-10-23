#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo 'Usage: scripts/verify-backup.sh BACKUP_DIRECTORY' >&2
  exit 2
fi

backup_dir="$(cd "$1" && pwd -P)"
rm -f "$backup_dir/VERIFIED"
(cd "$backup_dir" && cmp -s SHA256SUMS <(sha256sum database.dump uploads.tar.gz)) || {
  echo 'Backup checksum manifest is invalid or archives are damaged.' >&2
  exit 1
}
tar -tzf "$backup_dir/uploads.tar.gz" > /dev/null

container="oge-tutor-restore-$(date +%s)-$RANDOM"
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if ! docker rm -fv "$container" > /dev/null 2>&1; then
    echo "Restore-check container cleanup failed: $container" >&2
    rm -f "$backup_dir/VERIFIED"
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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

# Stream through stdin so Git Bash never rewrites host/container paths.
docker exec -i "$container" pg_restore -U postgres -d oge_tutor_restore \
  --exit-on-error --single-transaction --no-owner --no-privileges < "$backup_dir/database.dump"
MSYS_NO_PATHCONV=1 docker exec "$container" mkdir -p /tmp/restored-uploads
MSYS_NO_PATHCONV=1 docker exec -i "$container" tar -xzf - -C /tmp/restored-uploads < "$backup_dir/uploads.tar.gz"

tables="$(docker exec "$container" psql -U postgres -d oge_tutor_restore -Atc \
  "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ ! "$tables" =~ ^[1-9][0-9]*$ ]]; then
  echo 'Restore completed without application tables.' >&2
  exit 1
fi

sha256sum "$backup_dir/SHA256SUMS" | cut -d ' ' -f 1 > "$backup_dir/VERIFIED.tmp"
date -u +%Y-%m-%dT%H:%M:%SZ >> "$backup_dir/VERIFIED.tmp"
mv "$backup_dir/VERIFIED.tmp" "$backup_dir/VERIFIED"
printf 'Restore verified: %s application tables in an isolated container.\n' "$tables"
