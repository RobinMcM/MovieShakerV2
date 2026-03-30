# April 1 Pilot Runbook

This runbook operationalizes the April 1 launch for a controlled 10-user pilot.

## 1) Preflight (T-24h)

- Confirm production env values:
  - `APP_ENV=production`
  - `WEB_INTERNAL_URL`
  - `INTERNAL_API_KEY` (same in engine + web)
  - `RESEND_API_KEY`
  - `RESEND_FROM` (verified sender domain)
  - `RESEND_WEBHOOK_SECRET`
  - `GATEWAY_BASE_URL`, `GATEWAY_VERIFY_TLS=true`
  - `MEDIA_HANDLER_BASE_URL`, `MEDIA_HANDLER_VERIFY_TLS=true`
- Confirm only `80/443` are publicly exposed.
- Run smoke script:
  - `./scripts/go-live/auth-email-smoke.sh`
- Verify webhook path:
  - `https://api.movieshaker.com/webhooks/resend` is reachable
  - Resend dashboard webhook test returns success

## 2) Failure Drills (T-12h)

- Run and execute checklist:
  - `./scripts/go-live/failure-drills.sh`
- Verify expected statuses/logs for:
  - internal key mismatch
  - missing Resend API key
  - missing `RESEND_FROM` in production

## 3) Backup and Rollback Validation

- Create fresh backup:
  - `./scripts/go-live/backup-rollback.sh`
- Validate restore command syntax and operator readiness.
- Confirm rollback owner + decision authority.

## 4) Launch-Day Staged Rollout

### Stage 1 (2 users)
- Enable access for first 2 pilot users.
- Observe for 30 minutes:
  - auth success/failure
  - `/api/internal/send-email` failures
  - API 5xx
  - latency p95

### Stage 2 (5 users)
- Expand to 5 users if Stage 1 is stable.
- Observe another 30 minutes with same checks.

### Stage 3 (10 users)
- Expand to full pilot cohort.
- Continue 30-minute checks for first 3 hours.

## 5) Week 1-2 Operating Cadence

Daily:
- Review engine logs:
  - `send_email_via_web failed`
  - auth hook warnings
- Review web logs:
  - `401/500/503` for `/api/internal/send-email`
- Review webhook ingestion:
  - signature failures on `/webhooks/resend`
  - event throughput vs send throughput mismatch
- Check Resend dashboard:
  - delivery, bounces, complaints
- Check SuperTokens health and auth latency.

Escalation:
- If auth/email error rate spikes, pause onboarding and execute rollback checklist.

## 6) Go/No-Go Gate

Go only when:
- preflight checklist passed
- failure drills passed
- backup and rollback validated
- rollout owners assigned for week 1
