# Docker demo credentials

## How to run demo seed
1. Start Docker:
   `docker compose up -d`
2. Run the dev-only seed from the host:
   `$env:DEMO_SEED_CONFIRM="docker-demo"; $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/oge_tutor?schema=public"; $env:PUBLIC_BACKEND_URL="http://localhost:3000"; pnpm run backend:demo-seed`

The script is idempotent and does not delete existing data. It refuses to run with `NODE_ENV=production` and requires the `docker-demo` confirmation value.

## Teacher
- Email: `demo.teacher@example.com`
- Password: `DemoTeacher123`

## Active students
- Email: `demo.ivan@example.com`
- Password: `DemoStudent123`
- Email: `demo.maria@example.com`
- Password: `DemoStudent123`

## Invite student
- Email: `demo.artem@example.com`
- Status: `invite_sent`
- Setup URL: `http://localhost:8080/setup-password?token=demo-invite-artem-2026`
- Raw token: `demo-invite-artem-2026`

## Manual check pages
- Teacher login: `http://localhost:8080`
- Teacher dashboard: `http://localhost:8080` after login as `demo.teacher@example.com`
- Students: bottom navigation `Ученики`, then open Иван / Мария / Артём.
- Schedule: bottom navigation `Расписание`.
- Homework: bottom navigation `ДЗ`.
- Materials: bottom navigation `Материалы`.
- Notifications: top notification button.
- Profile/account: bottom navigation `Профиль`.
- Student cabinet: login as `demo.ivan@example.com` or `demo.maria@example.com`.
