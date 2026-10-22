# HTTP API

This page describes the **currently implemented API**. The proposed multi-subject/group-learning API v2 is documented separately in [platform/api-target.md](platform/api-target.md); those routes are not yet implemented.

The NestJS API listens on port `3000` by default. Swagger UI is at `/api/docs` when the backend runs. All paths below are relative to the API origin; there is no `/api` prefix on application routes. Protected calls use `Authorization: Bearer <JWT>`; only health, login, password-reset, and access-token verification/completion are public. Rate limits apply to the public authentication routes.

## Response Contract

- `POST /auth/login` and `GET /bootstrap` return `{ session, data, pagination }`. `data` contains the first page (25 items) of `students`, `lessons`, `homeworks`, `materials`, and `notifications`, plus the teacher profile where applicable.
- List endpoints return `{ items, total, page, pageSize }`. Use `page` (1-based) and `pageSize` (1-100); defaults are 1 and 25. Optional filters: `q`, `studentId`, `status`, `from`, `to`, `taskNumber`, and `source` where relevant. The backend rejects invalid values.
- Detail endpoints return `{ item }`. Mutations return `{ changes: { ... }, invalidated?: string[] }`, with only changed resources. A client should refresh listed `invalidated` collections. Password changes and token completion return `{ ok: true }`.
- Errors return `{ code, message, fieldErrors, requestId }`. Typical statuses: `400` DTO validation, `401` missing/expired/revoked session, `403` forbidden, `404` missing resource, `409` state conflict, `422` domain validation, `429` auth rate limit.

## Routes

| Scope | Endpoints | Purpose |
|---|---|---|
| Public | `GET /health`, `GET /health/ready` | Liveness and database readiness. |
| Public | `POST /auth/login`, `POST /auth/password-reset`, `POST /auth/access-token/verify`, `POST /auth/access-token/complete` | Login, reset, invite verification, password setup. |
| Authenticated | `POST /auth/logout`, `GET /bootstrap` | Revoke the current session; load the first page of the cabinet. |
| Teacher | `PATCH /teacher/profile`, `PATCH /teacher/account`, `POST /teacher/security/password`, `PATCH /teacher/notifications` | Teacher profile, email, password, settings. |
| Authenticated | `GET /students`, `GET /students/:studentId` | Paginated student list and scoped detail. A student sees only their own profile. |
| Teacher | `POST /students`, `POST /students/:studentId/access` | Invite a student; resend invite, reset password, disable or enable access. |
| Owner or teacher | `PATCH /students/:studentId/profile`, `PATCH /students/:studentId/account`, `POST /students/:studentId/security/password`, `PATCH /students/:studentId/notifications` | Student profile, account and settings. Only teachers can edit teacher-private notes. |
| Authenticated | `GET /lessons`, `GET /lessons/:lessonId` | Paginated schedule and scoped lesson detail. |
| Teacher | `POST /lessons`, `PATCH /lessons/:lessonId`, `POST /lessons/:lessonId/complete` | Create, reschedule/cancel, and complete a lesson. Active lessons cannot overlap for the teacher; a future lesson cannot be completed. |
| Authenticated | `GET /homeworks`, `GET /homeworks/:homeworkId` | Paginated homework and scoped detail. |
| Teacher | `POST /homeworks`, `PATCH /homeworks/:homeworkId`, `POST /homeworks/:homeworkId/review` | Assign, edit, and review homework. |
| Student | `POST /homeworks/:homeworkId/submissions` | Submit a solution as multipart form data (`file`, optional `fileTitle`). |
| Authenticated | `POST /files`, `GET /files/:fileId/download` | Upload a private file as multipart form data (`file`) and download it after an ownership/assignment check. |
| Authenticated | `GET /materials`, `GET /materials/:topicId` | Paginated task materials and scoped detail. |
| Teacher | `POST /materials`, `PATCH /materials/:topicId/files/:fileId`, `DELETE /materials/:topicId/files/:fileId` | Add, edit/move, and remove a file, link, or library item. |
| Teacher | `PATCH /students/:studentId/progress`, `PATCH /students/:studentId/progress/tasks/:taskNumber`, `POST /students/:studentId/progress/tasks/:taskNumber/assessment` | Batch update, edit one task, or record assessment and resolve its notifications. |
| Authenticated | `GET /students/:studentId/progress/history` | Paginated progress history, optionally filtered by task, date, or source. |
| Authenticated | `GET /notifications` | Paginated notifications; students are scoped to their own records. |
| Teacher | `PATCH /notifications/:notificationId`, `POST /notifications/read-all` | Change notification status or mark all unread teacher notices as read. |

Password changes and reset invalidate existing sessions. Logout revokes the presented JWT. Uploaded files are streamed to disk with a size limit and content-based type detection; client-supplied MIME types are not trusted. The API never exposes the uploads directory as static files.
