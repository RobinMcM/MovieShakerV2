# Shared Authentication Deployment Rules

This document is the source of truth for reusing MovieShaker authentication across RapidMVP applications.

## 1) Canonical Identity Domain

- Identity provider domain: `https://auth.rapidmvp.io`
- SuperTokens Core and auth API are centralized behind this domain.
- All app logins must route through `auth.rapidmvp.io`.
- Do not build app-local credential stores for production apps listed below.

## 2) App Domain Map

- Primary app (highest traffic): `https://rapidmvp.io`
- Secondary app: `https://afilminabox.com`
- Secondary app: `https://reelinvesting.com`
- Secondary app: `https://ooocreatives.com`

Each app owns its own first-party session on its own domain. Cross-app access is provided by redirect-based SSO, not by sharing cookies across top-level domains.

## 2.1) Current Test System Service Domains

The current test environment uses the following fixed service split:

- Authentication (SuperTokens): `https://auth.rapidmvp.io`
- MovieShaker CRUD API: `https://api.movieshaker.com`
- Media operations (FFmpeg/media service): `https://media.rapidmvp.io`
- AI model query gateway: `https://models.rapidmvp.io`

No migration path is required for this test setup. New integrations should match this mapping directly unless explicitly changed.

For MovieShaker specifically, client auth requests are kept first-party via API-domain proxying:

- Public auth URL used by MovieShaker web client: `https://api.movieshaker.com/auth/*`
- Reverse proxy behavior: `api.movieshaker.com/auth/*` -> `https://auth.rapidmvp.io/auth/*`

This keeps MovieShaker session and CRUD behavior stable while centralizing the auth service.

## 3) User Identity and Profile Ownership

- Authentication identity is stored in SuperTokens (global `user_id`).
- Each application stores app-local profile and authorization data keyed by the same `user_id`.
- MovieShaker remains the reference schema for app-local profile ownership.
- Never duplicate password hashes or auth credentials in app-local databases.

## 4) Required SSO Contract

All client apps must implement this flow:

1. User is unauthenticated in app.
2. App redirects to `auth.rapidmvp.io` login with `return_to`.
3. Auth validates destination against an allowlist.
4. Auth redirects back to app callback with short-lived auth result.
5. App backend validates result with auth service and issues local first-party session.

Required guardrails:

- `return_to` must be exact-match allowlisted per environment.
- Callback endpoints must reject unknown origins/domains.
- Auth result tokens/codes must be short-lived and one-time use.
- Session cookies must be `Secure` and `HttpOnly`.
- Use `SameSite=None` only where cross-site auth redirects require it.

## 5) Environment Variable Standard

### Auth service (`auth.rapidmvp.io`)

- `AUTH_DOMAIN=https://auth.rapidmvp.io`
- `SUPERTOKENS_CONNECTION_URI=<core-uri>`
- `API_BASE_URL=https://auth.rapidmvp.io`
- `WEBSITE_DOMAIN=https://auth.rapidmvp.io`
- `ALLOWED_RETURN_TO_URLS=<comma-separated allowlist>`
- `RESEND_API_KEY=<resend-api-key>`
- `RESEND_FROM=<verified-from-address>`

Core compatibility requirement:

- `SUPERTOKENS_CONNECTION_URI` must resolve to a SuperTokens Core endpoint where `/apiversion` returns HTTP `200`.
- The returned CDI versions must satisfy the highest SDK requirement across apps (for example `supertokens-node@24.x` requires CDI `5.4` or newer).

### Each client app (RapidMVP, FilmInABox, ReelInvesting, OOOCreatives)

- `AUTH_BASE_URL=https://auth.rapidmvp.io`
- `NEXT_PUBLIC_AUTH_BASE_URL=https://auth.rapidmvp.io` (for web apps)
- `NEXT_PUBLIC_AUTH_API_URL` (optional; for MovieShaker Option 1 keep this unset or set to `https://api.movieshaker.com` so auth calls stay first-party)
- `APP_BASE_URL=<this app public origin>`
- `AUTH_CALLBACK_URL=<this app callback endpoint>`
- `INTERNAL_API_KEY=<shared secret between backend and internal email sender>`

## 6) Resend Email Rules (Required)

Resend is mandatory for authentication email delivery.

Required auth email events:

- Email verification
- Password reset
- Welcome email
- Account security notices (password change, suspicious login, lockout)

Operational rules:

- Use a verified sending domain and explicit `RESEND_FROM`.
- Never send auth emails from sandbox addresses in production.
- Log delivery failures with request IDs from provider responses.
- Retry transient failures and alert on repeated failures.
- Do not block sign-in completion on asynchronous notification-only emails.

## 7) Security Baseline

- Enforce HTTPS on every auth-related domain and callback.
- Restrict CORS to explicit production domains.
- Rotate API keys/secrets on a schedule and after incidents.
- Apply rate limits on sign-in, sign-up, reset, and verification endpoints.
- Record auth audit events (login success/failure, password reset requested/completed, logout).

## 8) Rollout and Cutover Checklist

For each new app integration:

1. Configure DNS + TLS for app and callback endpoints.
2. Add app callback and return URL to allowlist.
3. Configure app env vars to point at `auth.rapidmvp.io`.
4. Verify login redirect -> callback -> app session creation.
5. Verify logout behavior (app-local and global logout expectations).
6. Verify Resend delivery for all required auth email events.
7. Run staging soak test before production cutover.
8. Keep rollback path to prior auth flow until validation passes.

## 9) Production Validation Checks

Must pass before enabling real traffic:

- Sign in at `rapidmvp.io`, then open each other app and confirm SSO handoff works.
- Confirm same SuperTokens `user_id` is used across all apps.
- Confirm app-local profile rows are created/fetched by that same `user_id`.
- Confirm verification and reset emails are delivered and links resolve correctly.
- Confirm callbacks reject tampered or unallowlisted `return_to` destinations.
- Confirm session refresh and logout flows behave as documented.
