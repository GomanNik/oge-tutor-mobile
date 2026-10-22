#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/backup-common.sh
backup_root="${BACKUP_DIR:-$PWD/backups}"
max_age="${BACKUP_MAX_AGE_SECONDS:-93600}"
[[ "$max_age" =~ ^[1-9][0-9]{0,8}$ ]] || { echo 'Invalid BACKUP_MAX_AGE_SECONDS.' >&2; exit 2; }
latest_status=
finished_epoch=
backup=
[[ -f "$backup_root/latest.record" && -f "$backup_root/latest-success.record" ]] || {
  echo 'CRITICAL: no completed successful backup record.' >&2; exit 1;
}
while IFS='=' read -r key value; do
  [[ "$key" != status ]] || latest_status="$value"
done < "$backup_root/latest.record"
while IFS='=' read -r key value; do
  case "$key" in
    finished_epoch) finished_epoch="$value" ;;
    backup) backup="$value" ;;
  esac
done < "$backup_root/latest-success.record"
if [[ "$latest_status" != success || ! "$finished_epoch" =~ ^[0-9]+$ ||
      ! "$backup" =~ ^backup-[0-9]{8}T[0-9]{6}Z-[a-zA-Z0-9]+$ ]]; then
  echo 'CRITICAL: latest backup failed or records are invalid.' >&2
  exit 1
fi
age=$(( $(date +%s) - finished_epoch ))
if (( age < 0 || age > max_age )) || ! backup_is_verified "$backup_root/$backup"; then
  echo 'CRITICAL: last verified backup is missing or stale.' >&2
  exit 1
fi
printf 'OK: verified backup %s, age %s seconds.\n' "$backup" "$age"
