# HTTP API

This page describes the **implemented API in this branch**. Blocks 1–6 are accepted in main; Block 7 adds recurring lesson series, account recovery, reconciliation and controlled v1 retirement. Planned integrations in [platform/api-target.md](platform/api-target.md) are not implied by this implementation.

## Recurring lessons and cutover v2 (Block 7)

The [full Block 7 contract](platform/block-7-series-cutover.md) lists all eight `/api/v2/workspaces/:workspaceId/lesson-series` routes, rule limits, DST handling, preview tokens, idempotency and future-only changes. Series are managed by administrators and assigned teachers; students see only their concrete lessons. Single-instance edits require a reason and preserve a series exception. Apply requires a fresh signed preview, an idempotency key and, for an existing series, `If-Match`.

`GET /api/v2/runtime` is public and reports `legacyApiMode`. `GET /api/v2/workspaces/:workspaceId/release-status` is admin-only and reports data invariants, not a completed backup/file verification. Public `POST /api/v2/auth/{password-reset,access-token/verify,access-token/complete}` and authenticated `POST /api/v2/me/password` remove the dependency on v1 for account security. Password change revokes all sessions and outstanding tokens; an incorrect current password returns 422.

Legacy behavior below applies only while enabled/read_only. With `LEGACY_API_MODE=read_only`, educational v1 writes are forbidden. With `disabled`, all v1 routes return 410, imported v2 resources report `legacyReadOnly=false` and can be managed through v2. The `legacy` provenance flag remains true. v1 compatibility statements in historical block sections describe enabled/read_only behavior, not the post-cutover authority. Disabling persists a startup barrier; see the [operator runbook](platform/block-7-operations.md) before changing modes.

The NestJS API listens on port `3000` by default. Swagger UI is at `/api/docs` when the backend runs. The legacy routes below have no `/api` prefix; new workspace routes use `/api/v2`. Protected calls use `Authorization: Bearer <JWT>`; health, login, password-reset, access-token verification/completion and v2 invitation acceptance for a new account are public. Rate limits apply to public authentication routes.

## Workspace API v2 (Block 1)

`POST /api/v2/auth/login` returns `{session,user,contexts}` without a cabinet snapshot. `POST /api/v2/auth/logout` revokes the current session and returns 204. `GET/PATCH /api/v2/me` and `GET /api/v2/me/workspaces` manage the account and available contexts. A context reports `legacyRole` only when that account has a matching accessible v1 profile in the historical workspace.

`GET /api/v2/workspaces/:workspaceId` reads the selected active workspace. Its `members`, `invitations` and `audit-events` routes provide scoped cursor pages; only an active workspace administrator can use the management routes. `POST /api/v2/invitations/accept-new` creates an account from a valid email invitation, while `accept-existing` adds a matching logged-in account. There is no public workspace creation or self-registration. See [the block 1 contract and operations](platform/block-1-operations.md) and the exact DTOs/errors in Swagger.

Every workspace request requires `X-Active-Role`; the server rechecks membership and grant on each request. State transitions require `If-Match` revision (428 missing, 412 stale), while new invitations and grants require `Idempotency-Key`. Mutations return `{item,changed,requestId}`, not a full cabinet. A new `student`/`teacher` role does not create legacy educational records; course membership is assigned explicitly.

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

## Courses and roster v2 (Block 3)

`GET/POST /api/v2/workspaces/:workspaceId/courses`, `GET/PATCH /courses/:id` and `POST /courses/:id/{activate,pause,complete,archive}` manage one course per published program version. `GET/POST /courses/:id/teachers`, `PATCH /courses/:id/teachers/:linkId`, `GET/POST /courses/:id/enrollments` and `GET/PATCH /courses/:id/enrollments/:enrollmentId` manage named teachers and individual participation. `POST /api/v2/workspaces/:workspaceId/enrollment-batches/preview` checks 1–50 students without writing, and `POST /enrollment-batches` applies all or none. These paths all use Bearer and `X-Active-Role`.

Administrators manage the roster; assigned teachers read their own course; students read only their own active/paused/completed participation and never a classmate's row. New and batch creates require `Idempotency-Key`; PATCH and course state transitions require `If-Match`. List pages are `{items,total,page,pageSize}`. Legacy pairs appear as read-only individual courses while their lessons are now visible in the v2 calendar; legacy lesson edits, homework and progress remain on v1. See the [block 3 contract and migration notes](platform/block-3-courses.md).

## Course lessons and calendar v2 (Block 4)

All routes below start with `/api/v2/workspaces/:workspaceId/lessons` and require Bearer auth and `X-Active-Role`. Administrators schedule within their workspace; assigned teachers schedule in their courses; students read only lessons where their active/paused/completed enrollment is an explicit participant. A student's response contains only their own participant row and excludes team notes.

| Method and path | Purpose |
|---|---|
| `GET /lessons?from=&to=&courseId=&page=&pageSize=` | Calendar range (inclusive start, exclusive end, at most 90 days), scoped before pagination. Admins may also filter `teacherUserId` and `studentUserId`. |
| `GET /lessons/:id` | Scoped lesson detail. |
| `POST /lessons/preview` | Validate a proposed lesson and report conflicting teacher/student IDs; does not reserve time. |
| `POST /lessons` | Atomically schedule a one-off group or individual lesson. Requires `Idempotency-Key`. |
| `PATCH /lessons/:id` | Edit topic, time, timezone, format, team note or explicit teachers/participants; requires `If-Match`. |
| `POST /lessons/:id/cancel` | Cancel a planned lesson with a reason and audit event; requires `If-Match`. |
| `POST /lessons/:id/complete` | Mark a started lesson complete, with one attendance status (`present`, `absent`, `excused`) for every participant; requires `If-Match`. |
| `POST /lessons/:id/attendance-corrections` | Change one completed lesson's attendance with a reason and before/after audit; requires `If-Match`. |

Creates and updates validate active teacher assignments, active enrollments, course and assignment dates, IANA timezone, a 15–480 minute interval and all selected people's calendars across courses and workspaces. Adjacent half-open intervals do not conflict. A group course can host a one-student consultation; an individual course cannot host a group. Preview is advisory; the mutation rechecks conflicts under a serializable transaction and person locks. A conflicting or concurrent request returns `409`. Legacy lesson IDs/times are preserved and their v2 snapshots are read-only; v1 writes keep both models in sync. The full contract, migration and acceptance criteria are in [block 4](platform/block-4-lessons.md).

## Assignments, reviews, materials and files v2 (Block 5)

The routes start with `/api/v2/workspaces/:workspaceId`, require Bearer auth and `X-Active-Role`, and do not return the full cabinet snapshot. Lists have bounded `page`/`pageSize`, `total`, and course/status/search filters. The role and resource relation are checked on every read, mutation and download. See the [full Block 5 contract](platform/block-5-works-and-files.md) for state transitions, permission matrix and legacy migration behavior.

| Routes | Purpose |
|---|---|
| `GET/POST /assignments`, `GET/PATCH /assignments/:id`, `POST /assignments/:id/{publish,recipients,close,archive}` | Draft and publish an assignment to an explicit roster; close/archive without erasing history. |
| `GET /assignments/:id/recipients`, `PATCH /assignments/:id/recipients/:recipientId` | Personal due dates and recipient status. |
| `GET/POST /assignment-recipients/:id/submissions` | Private, immutable submission attempts. |
| `POST /submissions/:id/reviews`, `PATCH /reviews/:id`, `POST /reviews/:id/publish` | Draft, revise and publish a review; published corrections are new versions. |
| `GET/POST /materials`, `GET/PATCH /materials/:id`, `POST /materials/:id/publish`, `POST /materials/:id/publications/:publicationId/revoke`, `POST /materials/:id/archive` | Versioned library and recipient-scoped publications. |
| `POST /files`, `GET /files/:id/download`, `DELETE /files/:id` | Streaming upload, authorized download and removal of unlinked files. |

Writes use `If-Match` where a revision is required; create/publish/submit operations use `Idempotency-Key`. Invalid revision gives 412 or 428; a duplicate key with a different body gives 409. Historic v1 homework and materials are imported as read-only v2 records and remain editable through v1 during the compatibility period.

## Progress and notifications v2 (Block 6)

The workspace prefix is `/api/v2/workspaces/:workspaceId`; Bearer auth and `X-Active-Role` select the active context. See the [Block 6 contract](platform/block-6-progress-notifications.md).

| Routes | Purpose |
|---|---|
| `GET /enrollments/:id/progress`, `GET /enrollments/:id/progress/events` | Published projection and cursor-paginated evidence history; private assessments are visible only to their author. |
| `POST /enrollments/:id/progress/assessments` | Teacher assessment/diagnostic, correction or retraction with `Idempotency-Key`; history is immutable. |
| `GET /students/:userId/program-progress?programVersionId=` | Separate results for each authorized course of exactly one program version. |
| `GET /notifications`, `PATCH /notifications/:id`, `POST /notifications/read-all` | Recipient-only list/count, revision-checked read state and read-all up to an explicit timestamp. |
| `GET /notifications/:id/target` | Recheck access before opening a resource. |
| `GET/PATCH /notification-preferences` | Explicit email opt-in; disabled by default. |
| `GET /notification-deliveries`, `POST /notification-deliveries/:id/retry` | Administrator delivery states and revision-checked retry with a reason. |

The notification list/read/target routes are also available under `/api/v2/me/notifications` with a required `workspaceId` query. Cursor pages return `{ items, pageInfo: { nextCursor, hasMore } }`. Notification lists also include `unreadCount` and `asOf`; use `asOf` as the read-all `before` value. Mutations return `{ item, changed, requestId }`. Notification preferences do not require `If-Match`. SMTP runs after commit through a leased outbox; local `noop` returns `dev_preview`.

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
