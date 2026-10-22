#!/usr/bin/env bash
backup_init() {
  backup_root="${BACKUP_DIR:-$PWD/backups}"
  mkdir -p "$backup_root"
  backup_root="$(cd "$backup_root" && pwd -P)"
  chmod 700 "$backup_root"
}

backup_lock() {
  command -v flock > /dev/null || { echo 'flock (util-linux) is required.' >&2; return 1; }
  # Fixed per checkout, even when BACKUP_DIR changes. Deploy uses this path too.
  mkdir -p "$PWD/backups"
  exec 9> "$PWD/backups/.operations.lock"
  flock -n 9 || { echo 'Another backup or deployment holds the operations lock.' >&2; return 75; }
}

backup_validate_retention() {
  keep="${BACKUP_KEEP_VERIFIED:-14}"
  record_days="${BACKUP_RECORD_DAYS:-90}"
  if [[ ! "$keep" =~ ^[1-9][0-9]{0,3}$ || ! "$record_days" =~ ^[1-9][0-9]{0,3}$ ]]; then
    echo 'Retention counts must be positive integers (1-9999).' >&2
    return 2
  fi
}

backup_is_verified() (
  cd "$1" || exit 1
  [[ -f VERIFIED && ! -L VERIFIED && -f SHA256SUMS && ! -L SHA256SUMS ]] || exit 1
  local digest
  read -r digest < VERIFIED
  [[ "$digest" == "$(sha256sum SHA256SUMS | cut -d ' ' -f 1)" ]] || exit 1
  # A previously good restore with damaged files must not count toward retention.
  [[ ! -L database.dump && ! -L uploads.tar.gz ]] || exit 1
  cmp -s SHA256SUMS <(sha256sum database.dump uploads.tar.gz)
)

backup_prune() {
  local dir count=0
  local -a verified=()
  shopt -s nullglob
  for dir in "$backup_root"/backup-*; do
    [[ -d "$dir" && ! -L "$dir" ]] || continue
    if backup_is_verified "$dir"; then
      [[ "${dir##*/}" == "$backup_name" ]] || verified+=("$dir")
    else
      echo "Preserving unverified or damaged backup: ${dir##*/}"
    fi
  done
  # The current run always survives, including runs with the same UTC second.
  backup_is_verified "$backup_root/$backup_name" || return 1
  verified+=("$backup_root/$backup_name")
  # UTC names sort oldest first; retain at least the newest successful restore.
  for dir in "${verified[@]}"; do
    count=$((count + 1))
    if (( count <= ${#verified[@]} - keep )); then
      rm -f -- "$dir/database.dump" "$dir/uploads.tar.gz" "$dir/SHA256SUMS" "$dir/VERIFIED"
      rmdir -- "$dir"
      echo "Pruned verified backup: ${dir##*/}"
    fi
  done
  find "$backup_root/runs" -maxdepth 1 -type f \
    \( -name 'run-*.record' -o -name 'run-*.log' \) -mtime "+$record_days" -delete
}
