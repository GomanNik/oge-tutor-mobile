# Staging Acceptance Checklist

Use this checklist before staging or VPS deployment. Run it against a migrated database with no production seed.

## Local Docker Runtime

- `docker compose up -d`
- `docker compose ps`
- `GET http://localhost:3000/health`
- `GET http://localhost:3000/health/ready`
- `GET http://localhost:8080`

Expected: postgres, backend and frontend are healthy; health returns `ok`; readiness returns database `ok`; frontend returns `200`.

## First Teacher

- Run `pnpm --dir oge-tutor-backend run bootstrap:teacher` with `BOOTSTRAP_TEACHER_EMAIL`, `BOOTSTRAP_TEACHER_PASSWORD` and `BOOTSTRAP_TEACHER_NAME`.
- Repeat the command.
- Log in as the teacher through the frontend.

Expected: first run creates the teacher, repeat run exits without creating a duplicate, password is not printed, teacher login opens an empty cabinet.

## Teacher And Student Access

- Create a student.
- Confirm a dev invite preview is shown only when backend returns `invite`.
- Confirm the student appears in the list with `invite_sent`.
- Open the student card and check note, email and access status.
- Use resend invite and reset password actions.

Expected: each access action refreshes the backend token and shows a dev preview in local/dev; production SMTP sends the link without a preview payload.

## Student Activation

- Open the invite link.
- Verify the token.
- Set a student password.
- Try to reuse the same token.
- Log in as the student.

Expected: setup form opens, token verification masks email, password activates the student, token reuse is rejected, student bootstrap contains only that student's data.

## Lessons

- Try to create a lesson in the past.
- Create a future lesson for the student.
- Try to create an overlapping lesson.
- Complete the lesson with OGE task numbers.
- Try to complete the same lesson again.

Expected: past and overlapping lessons are rejected; completion updates lesson status, progress history and assessment notification once.

## Homework

- Create homework for the student.
- Confirm it appears in the student cabinet.
- Submit a solution file as the student.
- Review it as `reviewed` and as `needs_revision` in a separate run.
- Try to review unsent homework.
- Try to submit reviewed homework.

Expected: lifecycle transitions are enforced; review updates progress and notifications without duplicate lifecycle actions.

## Files And Materials

- Upload a teacher material file.
- Assign it through a lesson, homework or task material.
- Download it as the assigned student through the guarded frontend flow.
- Download a submitted solution as the teacher.
- Try to download another teacher's/student's private file.

Expected: allowed downloads include auth, forbidden downloads return `403`, and the frontend uses guarded fetch for protected file URLs.

## Password Reset

- Request reset for an existing active user.
- Open the dev preview link.
- Set a new password.
- Try to reuse the reset token.
- Request reset for disabled and unknown users.

Expected: active user receives a dev preview locally, reused token is rejected, disabled/unknown paths return a generic `{ ok: true }` without activation or account disclosure.

## Automated Coverage

- Backend e2e: `E2E_DATABASE_URL=postgresql://...test... pnpm --dir oge-tutor-backend run test:e2e`
- Frontend tests: `pnpm --dir oge-tutor-app test`
- Full gate: `pnpm run quality`

The backend e2e smoke covers teacher login, create student, invite complete, student login, lesson validation/completion, homework submit/review, allowed file download, forbidden foreign file, password reset and token reuse.
