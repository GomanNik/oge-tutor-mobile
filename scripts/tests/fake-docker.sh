#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$MOCK_DOCKER_LOG"
case "$*" in
  'compose ps -q postgres') echo database ;;
  'compose ps -q backend') [[ "${MOCK_FAIL:-}" == missing ]] || echo backend ;;
  'compose stop backend') exit 0 ;;
  'start backend') [[ "${MOCK_FAIL:-}" != restart ]] ;;
  'exec database sh -c printf %s "$POSTGRES_DB"') echo oge_tutor ;;
  'exec backend node -e '*) [[ "${MOCK_FAIL:-}" != external-db ]] ;;
  'exec database sh -c exec pg_dump'*)
    [[ "${MOCK_FAIL:-}" != dump ]] || exit 1
    printf 'test database archive' ;;
  'inspect backend --format '*'.State.Health.Status'*) echo healthy ;;
  'inspect backend --format '*) echo uploads-volume ;;
  'image inspect postgres:16-alpine') exit 0 ;;
  'run --rm --network none '*) tar -czf - -C "$MOCK_UPLOADS" . ;;
  'run -d --name '*) echo restore-container ;;
  'exec '*pg_isready*) exit 0 ;;
  'exec -i '*pg_restore*)
    cat > /dev/null
    [[ "$*" == *'--exit-on-error --single-transaction'* ]]
    [[ "${MOCK_FAIL:-}" != restore ]] ;;
  'exec '*mkdir*) exit 0 ;;
  'exec -i '*tar*)
    cat > /dev/null
    [[ "${MOCK_FAIL:-}" != uploads ]] ;;
  'exec '*psql*)
    if [[ "${MOCK_FAIL:-}" == empty ]]; then echo 0; else echo 12; fi ;;
  'rm -fv '*) [[ "${MOCK_FAIL:-}" != cleanup ]] ;;
  *) echo "Unexpected mock Docker command: $*" >&2; exit 2 ;;
esac
