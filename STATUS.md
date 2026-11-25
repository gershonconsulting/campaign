# STATUS — campaign.gershon.ai
Last updated: 2026-11-24 (America/La_Paz)

## Done ✅
- ✅ Operator preview: campaign drafts, imports, sequence editor, contacts, demo inbox, reports.
- ✅ M1: PR #2 merged into `codex/campaign-operator-preview`.
- ✅ M1: shared Unipile v2 client; legacy provider adapter removed.
- ✅ M1: hosted auth uses `/v2/auth/link`; GET callback verifies the fetched account.
- ✅ M1: Vault credential fallback retained; provider errors redact response text.
- ✅ M1: 21 tests pass; production build and all three Edge Function checks pass.
- ✅ M1: source scan finds no legacy Unipile calls in server functions.
- ✅ Deployed `linkedin-status` returned connected:true on November 24 local time.

## Open ❌
- ❌ M1 review: Claude to validate hosted auth callback in a review environment.
- ❌ M2: normalized tables/RLS, queue, database limiter, dry-run engine and simulations.
- ❌ M3: live sending behind kill switch and Claude's five-prospect pilot.
- ❌ M4: webhooks, reconcile, live inbox, reconnect UI and account health controls.
- ❌ M5: Radar schema inspection/import/write-back, accurate metrics and Resend report.
- ❌ M6: production deployment through the existing workflow and health checks.
- ❌ Rotate the Unipile test key in Vault before go-live (Claude).
- ❌ Verify production login, workspace membership and database policies before rollout.

## Known issues
- Live start/reply remain blocked until the engine milestones are accepted.
- Hosted auth callback is type-checked; no live account authentication was performed in M1.
- Existing preview bundle exceeds Vite's 500 kB warning threshold.
- Historical research/specifications predate the November 24 brief; the brief governs v1.

## Deploy route
Existing Cloudflare Pages project: `gershon-campaign`, domain: campaign.gershon.ai.
Use `.github/workflows/deploy.yml` at M6 only. No deployment or migration performed in M1.
Historical November 23 direct upload is recorded in git history; do not repeat that route.
