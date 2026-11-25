# STATUS — campaign.gershon.ai
Last updated: 2026-11-24 (America/La_Paz)

## Done ✅
- ✅ M1: Unipile v2 foundation, Vault fallback and legacy adapter removal (PR #3).
- ✅ M1: deployed LinkedIn health returned connected:true on November 24.
- ✅ M2: normalized execution tables, workspace RLS and service-only execution RPCs.
- ✅ M2: planner, fenced queue claims, dry-run worker and optional minute cron script.
- ✅ M2: database rolling limiter, shared daily caps, sender windows and jitter.
- ✅ M2: state machine, retries, provider dedupe, reply cancellation and pause controls.
- ✅ M2: 20-contact simulation: 16 finished, 3 replied, 1 invite expired.
- ✅ Local: 43 passing Node tests; 2 multi-connection tests reserved for PostgreSQL CI.
- ✅ Scheduler authentication/kill-switch test, build and five function type checks pass.

## Open ❌
- ❌ M2 review and PostgreSQL CI concurrency acceptance.
- ❌ M3: actual provider dispatch, durable send intent and five-prospect pilot.
- ❌ M4: webhooks, reconcile, inbox, reconnect and connection browser click-through.
- ❌ M5: inspect Radar schema; import/write-back, metrics and Resend daily report.
- ❌ M6: production deployment via existing workflow, login and health verification.
- ❌ Claude must rotate the Unipile test key in Vault before go-live.

## Known issues / decisions
- Olivier deferred M1's connection click-through to M4 with reconnect.
- M2 is dry-run only; enabling live mode returns 503. No provider requests occur.
- Browser Start/Reply stay gated until normalized live integration is commissioned.
- No production migration, function deployment or cron installation performed in M2.
- Simulated records/counters must not be promoted into live records.
- The existing preview bundle still triggers Vite's 500 kB size warning.
- Full M2 design/evidence: docs/M2-ENGINE.md and docs/validation/M2-SIMULATION.json.

## Deploy route
Existing Cloudflare Pages project: gershon-campaign, domain: campaign.gershon.ai.
Use .github/workflows/deploy.yml at M6 only. No direct uploads.
