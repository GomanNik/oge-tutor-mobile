# HTTP API

This page describes the **currently implemented API**. Workspace identity, administration, and the versioned exam catalog are implemented under `/api/v2`; courses and groups in [platform/api-target.md](platform/api-target.md) remain future design.

The NestJS API listens on port `3000` by default. Swagger UI is at `/api/docs` when the backend runs. The legacy routes below have no `/api` prefix; new workspace routes use `/api/v2`. Protected calls use `Authorization: Bearer <JWT>`; health, login, password-reset, access-token verification/completion and v2 invitation acceptance for a new account are public. Rate limits apply to public authentication routes.

## Workspace API v2 (Block 1)

`POST /api/v2/auth/login` returns `{session,user,contexts}` without a cabinet snapshot. `POST /api/v2/auth/logout` revokes the current session and returns 204. `GET/PATCH /api/v2/me` and `GET /api/v2/me/workspaces` manage the account and available contexts. A context reports `legacyRole` only when that account has a matching accessible v1 profile in the historical workspace.

`GET /api/v2/workspaces/:workspaceId` reads the selected active workspace. Its `members`, `invitations` and `audit-events` routes provide scoped cursor pages; only an active workspace administrator can use the management routes. `POST /api/v2/invitations/accept-new` creates an account from a valid email invitation, while `accept-existing` adds a matching logged-in account. There is no public workspace creation or self-registration. See [the block 1 contract and operations](platform/block-1-operations.md) and the exact DTOs/errors in Swagger.

Every workspace request requires `X-Active-Role`; the server rechecks membership and grant on each request. State transitions require `If-Match` revision (428 missing, 412 stale), while new invitations and grants require `Idempotency-Key`. Mutations return `{item,changed,requestId}`, not a full cabinet. A new `student`/`teacher` role does not create legacy educational records; courses and groups are not yet implemented.

## Exam catalog v2 (Block 2)

The catalog routes require a Bearer session. Global subjects and published/archived program versions are readable by authenticated users; a local catalog additionally requires active workspace membership, `workspaceId` on list requests, and a valid `X-Active-Role` on every request. Local administrators manage only their own workspace's catalog. A separate operator-managed `CatalogGrant` controls global writes; it is not implied by the workspace admin role. Draft versions are visible only to their catalog managers.

| Routes after `/api/v2` | Purpose |
|---|---|
| `GET/POST /subjects`, `GET/PATCH /subjects/:id`, `POST /subjects/:id/archive` | Filter, create, read, rename and archive subjects. |
| `GET/POST /programs`, `GET/PATCH /programs/:id`, `POST /programs/:id/archive` | Programs distinguished by exam type, subject and variant. |
| `GET/POST /programs/:id/versions`, `GET/PATCH /program-versions/:id`, `POST /program-versions/:id/publish`, `POST /program-versions/:id/archive` | Draft, publish and archive immutable exam versions. |
| `GET/POST /program-versions/:id/tasks`, `PATCH/DELETE /program-versions/:id/tasks/:taskId` | Version-local task definitions; writes require a draft. |
| `POST /program-versions/:id/scoring-rule` | Scoring rule metadata for a draft. This does not execute a forecast. |
| `GET/POST /task-mappings`, `POST /task-mappings/:id/revoke` | Explicit task equivalence between versions of one program, with auditable revocation. |

Catalog lists return `{items,total,page,pageSize}` with bounded pagination. Creates require `Idempotency-Key`; state changes require `If-Match` (the version's revision for task/rule writes). Missing/stale revision yields 428/412; invalid transitions yield 409. Mutations return `{item,changed,requestId}`, task/rule mutations also return `versionRevision`. Full DTOs, filters and error schemas appear in Swagger. See [Block 2 operations and acceptance](platform/block-2-catalog.md).

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
