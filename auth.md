# auth.rapidmvp.io Agent Instruction Set

Use this as the execution playbook for configuring authentication in the `rapidmvp` repository with a single public auth entrypoint.

## Objective

Configure auth for `rapidmvp.io` so:

- public auth entrypoint is `https://auth.rapidmvp.io`
- SuperTokens Core is reachable at `https://auth.rapidmvp.io/core`
- app auth route (`/api/auth/signin`) succeeds without Core connectivity/CDI errors

## Architecture Contract (must not be violated)

1. `auth.rapidmvp.io/auth/*` serves auth API routes.
2. `auth.rapidmvp.io/core/*` proxies to SuperTokens Core.
3. `SUPERTOKENS_CONNECTION_URI` points to the Core endpoint, not app API routes.
4. Core health check must pass at:
   - `GET https://auth.rapidmvp.io/core/apiversion` -> `200`.

## Required Environment Variables (rapidmvp app)

For local development:

```env
APP_DOMAIN=http://localhost:3000
API_DOMAIN=http://localhost:3000
NEXT_PUBLIC_APP_DOMAIN=http://localhost:3000
NEXT_PUBLIC_API_DOMAIN=http://localhost:3000
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
SUPERTOKENS_CONNECTION_URI=https://auth.rapidmvp.io/core
```

For production:

```env
APP_DOMAIN=https://rapidmvp.io
API_DOMAIN=https://rapidmvp.io
NEXT_PUBLIC_APP_DOMAIN=https://rapidmvp.io
NEXT_PUBLIC_API_DOMAIN=https://rapidmvp.io
CORS_ALLOWED_ORIGINS=https://rapidmvp.io,https://www.rapidmvp.io
SUPERTOKENS_CONNECTION_URI=https://auth.rapidmvp.io/core
```

## Reverse Proxy Requirement (auth host)

Ensure `auth.rapidmvp.io` has all three routes:

```caddy
auth.rapidmvp.io {
    handle_path /core/* {
        reverse_proxy 127.0.0.1:3567
    }

    handle /auth/* {
        reverse_proxy 127.0.0.1:8000
    }

    handle /health {
        reverse_proxy 127.0.0.1:8000
    }

    respond 404
}
```

If Docker networking is used, upstream can be `supertokens:3567` instead of `127.0.0.1:3567`.

## Version Compatibility Rule

Before debugging app code, verify Core/CDI compatibility:

1. Identify `supertokens-node` version in app.
2. Confirm Core supports required CDI version.
3. If app requires CDI newer than Core supports, upgrade Core first.

Do not proceed with app-level auth debugging until Core compatibility is confirmed.

## Validation Commands (required)

Run in this order:

```bash
curl -i https://auth.rapidmvp.io/core/apiversion
curl -i https://auth.rapidmvp.io/health
curl -i -X OPTIONS "https://auth.rapidmvp.io/auth/session/refresh" -H "Origin: https://rapidmvp.io" -H "Access-Control-Request-Method: POST"
curl -i -X POST "http://localhost:3000/api/auth/signin"
```

Expected outcomes:

- `/core/apiversion` returns `200`
- `/health` returns `200`
- OPTIONS refresh returns `200` with CORS headers
- `/api/auth/signin` does not return `AUTH_BACKEND_ERROR` about unavailable Core

## Failure Map

- `404` on `/core/apiversion`: proxy route missing for `/core/*`
- `503` / `No SuperTokens core available to query`: `SUPERTOKENS_CONNECTION_URI` wrong or Core unreachable
- `500` on `/api/auth/signin` with compatibility text: Core/CDI version mismatch
- `401` on refresh POST without cookies: expected during raw curl checks

## Agent Execution Rules

1. Do not change auth architecture away from `auth.rapidmvp.io` single entrypoint.
2. Do not point `SUPERTOKENS_CONNECTION_URI` at `/auth/*` endpoints.
3. Make the smallest safe change, then re-run all validation commands.
4. Report exact command outputs for each validation command.
5. If blocked, report which contract item failed (routing, env, connectivity, version).

## Definition of Done

- `https://auth.rapidmvp.io/core/apiversion` returns `200`
- rapidmvp app uses `SUPERTOKENS_CONNECTION_URI=https://auth.rapidmvp.io/core`
- `/api/auth/signin` succeeds in local/prod target environment
- no unresolved Core connectivity or CDI compatibility errors remain
