#!/usr/bin/env bash
set -euo pipefail
umask 077
project="$(cd "$(dirname "$0")/.." && pwd -P)"
backup_dir=/var/lib/oge-tutor/backups
service_user="${SUDO_USER:-$(id -un)}"
calendar='*-*-* 02:00:00 UTC'
keep=14
enable=0
dry_run=0
usage() {
  echo 'Usage: install-backup-timer.sh [--project ABS_PATH] [--backup-dir ABS_PATH] [--user USER] [--calendar CALENDAR] [--keep COUNT] [--enable] [--dry-run]'
}
while (( $# )); do
  case "$1" in
    --project|--backup-dir|--user|--calendar|--keep)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      case "$1" in
        --project) project="$2" ;;
        --backup-dir) backup_dir="$2" ;;
        --user) service_user="$2" ;;
        --calendar) calendar="$2" ;;
        --keep) keep="$2" ;;
      esac
      shift 2 ;;
    --enable) enable=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    *) usage >&2; exit 2 ;;
  esac
done
# Restrict generated systemd directives and shell paths, rejecting specifiers/injection.
for path in "$project" "$backup_dir"; do
  if [[ ! "$path" =~ ^/[a-zA-Z0-9_./-]+$ || "$path" == / || "$path" == *'/../'* || "$path" == */.. ]]; then
    echo 'Use absolute Linux paths without spaces, shell metacharacters, or .. segments.' >&2
    exit 2
  fi
done
[[ "$service_user" =~ ^[a-z_][a-z0-9_-]*[$]?$ && "$keep" =~ ^[1-9][0-9]{0,3}$ ]] || { echo 'Invalid user or retention.' >&2; exit 2; }
[[ -n "$calendar" && "$calendar" != *$'\n'* && "$calendar" != *$'\r'* && "$calendar" != *'%'* ]] || { echo 'Invalid calendar.' >&2; exit 2; }

render_service() {
  cat <<EOF
[Unit]
Description=OGE Tutor backup with isolated restore verification
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
User=$service_user
WorkingDirectory=$project
Environment=BACKUP_DIR=$backup_dir
Environment=BACKUP_KEEP_VERIFIED=$keep
Environment=BACKUP_RECORD_DAYS=90
EnvironmentFile=-/etc/oge-tutor-backup.env
ExecStart=/usr/bin/bash $project/scripts/backup.sh
UMask=0077
TimeoutStartSec=2h
TimeoutStopSec=120
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
StandardOutput=journal
StandardError=journal
SyslogIdentifier=oge-tutor-backup
EOF
}
render_timer() {
  cat <<EOF
[Unit]
Description=Daily OGE Tutor verified backup

[Timer]
OnCalendar=$calendar
RandomizedDelaySec=5m
Persistent=true
Unit=oge-tutor-backup.service

[Install]
WantedBy=timers.target
EOF
}
if [[ "$dry_run" == 1 ]]; then
  echo '# /etc/systemd/system/oge-tutor-backup.service'
  render_service
  echo '# /etc/systemd/system/oge-tutor-backup.timer'
  render_timer
  echo "# enable=$enable (dry run: no files written or services started)"
  exit 0
fi
[[ "$(uname -s)" == Linux && "$EUID" == 0 && -d /run/systemd/system ]] || {
  echo 'Installation requires root on a Linux host running systemd. Use --dry-run to preview.' >&2
  exit 1
}
for command in docker flock systemctl systemd-analyze runuser; do
  command -v "$command" > /dev/null || { echo "Required command missing: $command" >&2; exit 1; }
done
id "$service_user" > /dev/null
[[ -f "$project/docker-compose.yml" && -f "$project/scripts/backup.sh" ]] || { echo 'Project checkout is missing.' >&2; exit 1; }
for script in backup.sh backup-common.sh verify-backup.sh check-backups.sh; do
  bash -n "$project/scripts/$script"
done
systemd-analyze calendar "$calendar" > /dev/null
runuser -u "$service_user" -- docker info > /dev/null
runuser -u "$service_user" -- docker compose version > /dev/null
if systemctl is-active --quiet oge-tutor-backup.service; then
  echo 'A backup is running; wait for completion before reinstalling the timer.' >&2
  exit 1
fi
install -d -m 700 -o "$service_user" "$backup_dir" "$project/backups"
staging="$(mktemp -d)"
trap 'rm -f "$staging/oge-tutor-backup.service" "$staging/oge-tutor-backup.timer"; rmdir "$staging"' EXIT
render_service > "$staging/oge-tutor-backup.service"
render_timer > "$staging/oge-tutor-backup.timer"
systemd-analyze verify "$staging/oge-tutor-backup.service" "$staging/oge-tutor-backup.timer"
install -m 644 "$staging/oge-tutor-backup.service" /etc/systemd/system/oge-tutor-backup.service
install -m 644 "$staging/oge-tutor-backup.timer" /etc/systemd/system/oge-tutor-backup.timer
systemctl daemon-reload
if [[ "$enable" == 1 ]]; then
  systemctl enable oge-tutor-backup.timer
  systemctl restart oge-tutor-backup.timer
else
  echo 'Units installed; existing timer activation is unchanged. Use --enable to activate.'
fi
systemctl list-timers --all oge-tutor-backup.timer --no-pager
