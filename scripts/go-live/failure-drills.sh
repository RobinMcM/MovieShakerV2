#!/usr/bin/env bash
set -euo pipefail

# Controlled failure drills for pilot readiness.
# This script prints exact drill steps and verification points.

cat <<'EOF'
Failure drill checklist
=======================

Drill A: Internal key mismatch (engine -> web send-email)
1) Temporarily set engine INTERNAL_API_KEY to a wrong value.
2) Trigger /profile/send-verification-email or admin bulk email preview/send.
3) Expected:
   - send fails closed (no unauthorized delivery)
   - web returns 401 on /api/internal/send-email
   - engine logs include send_email_via_web failed 401
4) Restore correct INTERNAL_API_KEY and retest success.

Drill B: RESEND_API_KEY unavailable on web
1) Temporarily remove/blank RESEND_API_KEY in web runtime.
2) Trigger verification or admin send.
3) Expected:
   - web responds 503 Email sending not configured
   - engine logs failed send with 503
   - user-facing flow degrades gracefully (no crash)
4) Restore RESEND_API_KEY and confirm recovery.

Drill C: RESEND_FROM missing in production
1) On production runtime only, remove RESEND_FROM.
2) Trigger email send.
3) Expected:
   - 503 from /api/internal/send-email due to missing RESEND_FROM
4) Restore RESEND_FROM and confirm success.

Exit criteria:
- Each drill has observable logs + expected status code.
- Recovery confirmed immediately after restoring config.
EOF
