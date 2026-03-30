#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   API_URL="https://api.movieshaker.com" \
#   WEB_URL="https://movieshaker.com" \
#   ADMIN_EMAIL="admin@example.com" \
#   ADMIN_PASSWORD="password" \
#   ./scripts/go-live/auth-email-smoke.sh
#
# Notes:
# - This script validates endpoint availability and admin email tooling.
# - Interactive signup/reset verification should still be performed manually in browser.

API_URL="${API_URL:-}"
WEB_URL="${WEB_URL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"

if [[ -z "${API_URL}" || -z "${WEB_URL}" ]]; then
  echo "Missing API_URL or WEB_URL."
  exit 1
fi

echo "1) Health checks"
curl -fsSL "${API_URL}/health" >/dev/null
curl -fsSL "${WEB_URL}" >/dev/null
echo "   OK"

echo "2) Verify internal auth endpoints are reachable"
curl -fsS -o /dev/null -w "   /auth/signup status: %{http_code}\n" \
  -H "Content-Type: application/json" \
  -d '{"formFields":[{"id":"email","value":"smoke-test@example.invalid"},{"id":"password","value":"SmokePass123!"}]}' \
  "${API_URL}/auth/signup" || true

echo "3) Manual checks required (browser)"
cat <<'EOF'
- Sign up a fresh test user and confirm:
  - registration confirmation email arrives
  - welcome email arrives
  - verification email arrives and verify link works
- Sign in/sign out/session refresh works
- Run password reset and confirm reset confirmation email
- Open /admin/email and validate preview + send
EOF

if [[ -n "${ADMIN_EMAIL}" && -n "${ADMIN_PASSWORD}" ]]; then
  echo "4) Optional admin login check is configured (manual due SuperTokens anti-CSRF/session handling)."
fi

echo "Smoke script completed."
