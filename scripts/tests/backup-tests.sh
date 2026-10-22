#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd -P)"
scratch_root="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
scratch="$(mktemp -d "$scratch_root/oge-tutor-backup-test-XXXXXX")"
cleanup() {
  [[ "$scratch" == "$scratch_root"/oge-tutor-backup-test-* ]] || return 1
  [[ "$(cd "$scratch" && pwd -P)" == "$scratch_root"/oge-tutor-backup-test-* ]] || return 1
  rm -rf -- "$scratch"
}
trap cleanup EXIT
mkdir -p "$scratch/project/scripts" "$scratch/bin" "$scratch/uploads"
cp "$repo"/scripts/*backup*.sh "$scratch/project/scripts/"
cp "$repo/scripts/tests/fake-docker.sh" "$scratch/bin/docker"
chmod +x "$scratch/bin/docker"
export MOCK_DOCKER_LOG="$scratch/docker.log" MOCK_UPLOADS="$scratch/uploads"
export PATH="$scratch/bin:$PATH" BACKUP_DIR="$scratch/data" BACKUP_KEEP_VERIFIED=2
printf 'upload fixture\n' > "$scratch/uploads/example.txt"
cd "$scratch/project"
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
expect_failure() {
  if "$@" > "$scratch/output" 2>&1; then fail "Unexpected success: $*"; fi
}
if ! command -v flock > /dev/null; then
  # Git Bash has no util-linux. CI additionally exercises the real kernel lock.
  printf '#!/usr/bin/env bash\nexit "${MOCK_LOCK_EXIT:-0}"\n' > "$scratch/bin/flock"
  chmod +x "$scratch/bin/flock"
  real_flock=0
  echo 'NOTE: flock is mocked on this platform; kernel contention test runs on Linux.'
else
  real_flock=1
fi

expect_failure bash scripts/check-backups.sh
pass 'missing backup is unhealthy'
if [[ "$real_flock" == 0 ]]; then
  MOCK_LOCK_EXIT=1 expect_failure bash scripts/backup.sh
else
  mkdir -p backups
  exec 7> backups/.operations.lock
  flock -n 7
  expect_failure bash scripts/backup.sh
  flock -u 7
  exec 7>&-
fi
grep -q '^exit_code=75$' "$BACKUP_DIR/latest.record"
[[ ! -s "$MOCK_DOCKER_LOG" ]] || fail 'Docker called while lock held'
pass 'lock contention fails before Docker with a run record'

for failure in missing external-db; do
  : > "$MOCK_DOCKER_LOG"
  MOCK_FAIL="$failure" expect_failure bash scripts/backup.sh
  ! grep -q '^compose stop' "$MOCK_DOCKER_LOG" || fail 'backend stopped during preflight failure'
done
pass 'missing services and external database fail before downtime'

BACKUP_KEEP_VERIFIED=0 expect_failure bash scripts/backup.sh
pass 'retention cannot remove all verified backups'

MOCK_FAIL=dump expect_failure bash scripts/backup.sh
grep -q '^start backend$' "$MOCK_DOCKER_LOG"
grep -q '^stage=snapshot$' "$BACKUP_DIR/latest.record"
[[ ! -f "$BACKUP_DIR/latest-success.record" ]] || fail 'failed dump marked successful'
pass 'dump failure restarts backend and records failure'

bash scripts/backup.sh > "$scratch/output" 2>&1
bash scripts/check-backups.sh
cp "$BACKUP_DIR/latest-success.record" "$scratch/success.record"
first="$(sed -n 's/^backup=//p' "$scratch/success.record")"
[[ -f "$BACKUP_DIR/$first/VERIFIED" ]]
pass 'successful backup restores database and uploads, and publishes verified status'

for failure in restore uploads empty cleanup; do
  MOCK_FAIL="$failure" expect_failure bash scripts/backup.sh
  cmp "$scratch/success.record" "$BACKUP_DIR/latest-success.record"
  grep -q '^stage=restore-check$' "$BACKUP_DIR/latest.record"
  expect_failure bash scripts/check-backups.sh
  [[ -d "$BACKUP_DIR/$first" ]] || fail 'failed restore pruned last good backup'
  bad="$(sed -n 's/^backup=//p' "$BACKUP_DIR/latest.record")"
  [[ ! -f "$BACKUP_DIR/$bad/VERIFIED" ]] || fail 'failed verification retained marker'
done
grep -q '^rm -fv oge-tutor-restore-' "$MOCK_DOCKER_LOG"
pass 'restore, uploads, empty database and cleanup failures preserve last success'

# Damage a formerly verified archive. It must not count as a retained good copy.
damaged="$BACKUP_DIR/backup-20000101T000000Z-damaged"
cp -R "$BACKUP_DIR/$first" "$damaged"
printf corruption >> "$damaged/database.dump"
unverified_count="$(find "$BACKUP_DIR" -maxdepth 1 -name 'backup-*' -type d | wc -l)"
for _ in 1 2 3; do bash scripts/backup.sh > "$scratch/output" 2>&1; done
source scripts/backup-common.sh
verified_count=0
for dir in "$BACKUP_DIR"/backup-*; do
  if backup_is_verified "$dir"; then verified_count=$((verified_count + 1)); fi
done
[[ "$verified_count" == 2 && -d "$damaged" ]] || fail 'retention did not preserve exactly two good backups and damaged evidence'
[[ "$(find "$BACKUP_DIR" -maxdepth 1 -name 'backup-*' -type d | wc -l)" -ge "$unverified_count" ]] || fail 'unverified backups were pruned'
bash scripts/check-backups.sh
pass 'retention keeps newest good backups and current run, preserving failed/damaged evidence'

current="$(sed -n 's/^backup=//p' "$BACKUP_DIR/latest-success.record")"
printf corruption >> "$BACKUP_DIR/$current/database.dump"
: > "$MOCK_DOCKER_LOG"
expect_failure bash scripts/verify-backup.sh "$BACKUP_DIR/$current"
[[ ! -s "$MOCK_DOCKER_LOG" && ! -f "$BACKUP_DIR/$current/VERIFIED" ]] || fail 'corrupt archive reached Docker or retained marker'
pass 'checksum corruption fails before restore and invalidates marker'

sed 's/^finished_epoch=.*/finished_epoch=1/' "$scratch/success.record" > "$BACKUP_DIR/latest-success.record"
expect_failure bash scripts/check-backups.sh
pass 'stale last success fails monitoring'

bash scripts/install-backup-timer.sh --project /opt/oge-tutor --user deploy --dry-run > "$scratch/units"
grep -q '^Persistent=true$' "$scratch/units"
grep -q '^User=deploy$' "$scratch/units"
expect_failure bash scripts/install-backup-timer.sh --project '/opt/oge%tutor' --dry-run
expect_failure bash scripts/install-backup-timer.sh --project /opt/oge-tutor --calendar $'daily\nUser=root' --dry-run
pass 'installer renders safe units and rejects directive injection'
echo 'All backup shell tests passed.'
