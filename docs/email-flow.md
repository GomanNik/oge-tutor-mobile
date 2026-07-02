# Invite and Password Reset Email Flow

The backend creates access tokens as random one-time values. Only the SHA-256 token hash is stored in the database.

## Invite Flow

1. Teacher creates a student.
2. Backend creates an `invite` access token with expiry.
3. Backend builds a frontend link from `APP_FRONTEND_URL`.
4. `AuthMailerService` sends the link through SMTP when `MAILER_PROVIDER=smtp`.
5. In development/test, `MAILER_PROVIDER=noop` returns a preview token/link for local testing.
6. Student opens the link and sets a password.
7. Backend marks the token as used, hashes the new password and sets student access to `active`.
8. Student can log in normally.

Production API responses do not expose the raw token.

## Password Reset Flow

1. User requests password reset by email.
2. Backend returns `{ ok: true }` without revealing whether the account exists.
3. If the account exists and is not a disabled student, backend creates a `password_reset` token.
4. Mailer sends a reset link through SMTP.
5. Completing the token changes the password and marks the token as used.
6. Used and expired tokens are rejected.
7. Reset does not activate disabled students.

## Templates

Current templates are generated in `AuthMailerService` as text and HTML variants.

Required env for SMTP:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
APP_FRONTEND_URL
```
