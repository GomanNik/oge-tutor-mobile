# Environment Variables

Do not commit real `.env` files. Use `.env.example` files as templates.

## Backend

Required in production:

```text
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=long-random-secret
PUBLIC_BACKEND_URL=https://api.example.com
APP_FRONTEND_URL=https://app.example.com
FRONTEND_ORIGIN=https://app.example.com
MAILER_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=OGE Tutor <no-reply@example.com>
```

Optional:

```text
JWT_EXPIRES_IN=7d
PORT=3000
UPLOAD_DIR=uploads
MAX_UPLOAD_BYTES=15728640
```

Production validation rejects missing `DATABASE_URL`, weak/default `JWT_SECRET`, missing public URLs and incomplete SMTP configuration.

Development and tests may use:

```text
MAILER_PROVIDER=noop
JWT_SECRET=dev-secret-change-me
```

`noop` mailer is not accepted for production startup.

## Frontend

Production build requires:

```text
VITE_API_BASE_URL=https://api.example.com
VITE_USE_MOCK=false
```

`VITE_USE_MOCK=true` is rejected for production builds.

## Docker Compose

Copy the root template locally:

```powershell
Copy-Item .env.example .env
```

For a production-like Compose run, replace all placeholder secrets and use SMTP settings before setting:

```text
NODE_ENV=production
MAILER_PROVIDER=smtp
```
