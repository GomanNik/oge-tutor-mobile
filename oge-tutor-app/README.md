# OGE Tutor App

Backend-ready frontend for a mobile-style tutor cabinet. Runtime data access goes through `src/api/*`; demo data is isolated inside the explicit development mock backend.

## Run

```powershell
npm install
npm run dev
```

## Backend mode

Production path requires a real backend URL:

```env
VITE_API_BASE_URL=https://your-api.example.com
```

The local mock backend is disabled by default and can be enabled only explicitly for development:

```env
VITE_USE_MOCK=true
```

Adapters:

```text
src/api/httpClient.js           — real backend adapter
src/api/mockBackend.js          — public mock entry, enabled only with VITE_USE_MOCK=true
src/api/mock/createMockBackend.js — development mock implementation
```

## Mock credentials

The mock backend seeds demo accounts from `src/mock/seed.js` and uses one demo password for seeded users:

```text
teacher@mail.ru / 123456
ivan@mail.ru / 123456
maria@mail.ru / 123456
artem@mail.ru / 123456
```

These credentials exist only in the mock adapter. The UI itself has no hardcoded login values.

## Quality gate

```powershell
npm run build
npm run lint
npm run typecheck
npm test
```

`npm run lint` runs real ESLint and repository architecture checks. `npm test` runs Vitest domain/API contract tests and smoke tests.

## Backend-ready architecture work

```text
src/api/contracts.js       — stable roles, routes, statuses, material/upload enums
src/api/dto.js             — runtime DTO guards and mappers for users, lessons, homework, submissions, materials, files
src/api/httpClient.js      — HTTP transport with auth token handling, 401 cleanup and upload-first attachment flow
src/api/mockBackend.js     — explicit development mock entry
src/api/mock/*             — mock backend implementation details
src/mock/seed.js           — isolated demo seed, not runtime state
src/shared/dateTime.js     — ISO/RFC3339 date helpers and UI formatters
src/shared/formatters.js   — pure helpers using backend contract codes
src/app/useBackendStore.js — async backend actions; supports resource patches and singular mutation responses
src/profile/*              — visual profile, account, security and notifications are separated
src/teacher/*              — lesson/homework/material actions use backend-ready payloads
src/student/*              — homework submission sends real File objects through the API layer
```
