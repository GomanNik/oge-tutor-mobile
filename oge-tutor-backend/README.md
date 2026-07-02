# OGE Tutor Backend

Production-oriented backend for the current OGE Tutor frontend. The frontend contract is treated as the source of truth.

## Stack

- NestJS + TypeScript
- PostgreSQL + Prisma
- JWT auth
- Local file storage in dev (`uploads/`)
- Role-scoped bootstrap for `teacher` and `student`
- DTO classes + global `ValidationPipe`
- Unified error contract
- SMTP-backed invite/reset flow in production
- Health and readiness endpoints

## Quick start

```powershell
cd "C:\Users\Goman Nikita\Downloads\oge-tutor-app-v2\oge-tutor-backend"
pnpm install
Copy-Item .env.example .env

docker compose down -v
docker compose up -d

pnpm run prisma:generate
pnpm exec prisma migrate dev --name init
pnpm run prisma:seed
pnpm run dev
```

When working from the repository root, use the workspace install:

```powershell
pnpm install --frozen-lockfile
pnpm run quality
```

The default Docker PostgreSQL port is `5433` to avoid conflicts with local PostgreSQL/Supabase.

Frontend `.env.local`:

```env
VITE_API_BASE_URL=http://localhost:3000
VITE_USE_MOCK=false
```

Health:

```text
GET /health
GET /health/ready
```

Production requires `DATABASE_URL`, `JWT_SECRET`, `PUBLIC_BACKEND_URL`, `APP_FRONTEND_URL` and SMTP env when `NODE_ENV=production`. See `docs/env.md`.

## Demo users

```text
teacher@mail.ru / 123456
ivan@mail.ru / 123456
maria@mail.ru / 123456
```

## API contract

### Auth

- `POST /auth/login`
- `POST /auth/logout`
- `POST /auth/password-reset`
- `POST /auth/access-token/verify`
- `POST /auth/access-token/complete`
- `GET /bootstrap`

`/bootstrap` returns `session + data` and all API responses are `no-store` to avoid `304` payload loss.

### Teacher

- `PATCH /teacher/profile`
- `PATCH /teacher/account`
- `POST /teacher/security/password`
- `PATCH /teacher/notifications`

Teacher password change validates `currentPassword`.

### Students

- `POST /students`
- `PATCH /students/:studentId/profile`
- `PATCH /students/:studentId/account`
- `POST /students/:studentId/security/password`
- `PATCH /students/:studentId/notifications`
- `POST /students/:studentId/access`

Teacher can manage his students. Student can update only his own profile/account/password/notifications.

### Lessons

- `POST /lessons`
- `PATCH /lessons/:lessonId`
- `POST /lessons/:lessonId/complete`

Completing a lesson uses `payload.focusTaskNumbers` when provided, marks tasks as `assessment_needed`, creates progress history, and creates teacher notifications.

### Homeworks

- `POST /homeworks`
- `PATCH /homeworks/:homeworkId`
- `POST /homeworks/:homeworkId/submissions`
- `POST /homeworks/:homeworkId/review`

Homework has `description`. Review accepts frontend `status: reviewed | needs_revision`. Review also creates progress history/assessment notifications with `source=homework_result`.

### Files / materials

- `POST /files` multipart form-data: `file`, optional `title`, `context`
- `POST /materials`
- `DELETE /materials/:topicId/files/:fileId`

File URLs are absolute using `PUBLIC_BACKEND_URL`. Embedded lesson/homework/review materials are normalized and file attachments are checked by ownership/scope.

### Health

- `GET /health`
- `GET /health/ready`

### Progress

- `PATCH /students/:studentId/progress`
- `PATCH /students/:studentId/progress/tasks/:taskNumber`
- `POST /students/:studentId/progress/tasks/:taskNumber/assessment`

## Response shape

Most mutations return scoped data:

```json
{
  "data": {
    "teacher": null,
    "students": [],
    "lessons": [],
    "homeworks": [],
    "materials": [],
    "notifications": []
  }
}
```

## Error shape

```json
{
  "code": "validation_error",
  "message": "Проверьте заполненные поля.",
  "fieldErrors": {
    "email": "exists"
  },
  "requestId": "..."
}
```

Prisma errors are mapped: `P2002 -> 409`, `P2025 -> 404`.

## Important security rules

- Student bootstrap never returns other students or teacher-wide data.
- Teacher can access only his students and their entities.
- File attachments must reference accessible files.
- Backend creates ids/timestamps and re-validates frontend actions.
