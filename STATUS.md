# STATUS — campaign.gershon.ai
Last updated: 2026-11-23

## State
Working operator preview and integration foundation on the implementation branch. Not commissioned for live LinkedIn execution. See `docs/IMPLEMENTATION.md` for delivered features, validation, and remaining work.

## Done ✅
- ✅ Botdog reviewed page by page (dashboard, campaigns, 5-step wizard, sequence builder, contacts, inbox, all settings, team dashboard, integrations)
- ✅ 44 screenshots stored, prospect names/messages blurred (repo is public)
- ✅ "How Botdog works without an extension" research (cloud session via li_at cookie or credentials, proxy per account, most likely built on Unipile)
- ✅ Full specification v1.0 (docs/SPECIFICATION.md)

## Open ❌
- ✅ Unipile chosen; v2 client in `supabase/functions/_shared/unipile-v2.ts` (tested endpoints: chats, user lookup, invitation, first message)
- ✅ `linkedin-status` Edge Function deployed to Supabase project `radar` (pkzeeqehwmtnqxdpdesl)
- ❌ Set secrets `UNIPILE_API_KEY` and `UNIPILE_ACCOUNT_ID` on the radar project (Edge Functions → Secrets); then status check goes green
- ❌ `linkedin-connect` / `campaign-api` still use Unipile v1 (DSN + hosted auth) — move to v2 once hosted-auth v2 path is confirmed
- 🟡 Supabase: using Radar's project for functions; campaign migration not yet applied (DB change, needs Olivier's OK)
- 🟡 M1–M2: frontend workflows, persistence migration and connection endpoints implemented; live database/provider validation pending.
- ❌ M3: durable executing worker, event ingest and reconciler (pure planner implemented and tested).
- 🟡 M4: local inbox, dashboard, contacts and exports implemented; live sync, delivery and recurring emails pending.
- ❌ M5: live acceptance tests and pilot.
- ❌ Make this repo private (it contains Gershon campaign data in screenshots, even if blurred)

## Known issues
- A test draft "New campaign" (0 contacts, not started) was created in Botdog during the review — can be deleted.

## Deploy route (planned)
GitHub Actions → Cloudflare Pages (campaign.gershon.ai) + Supabase migrations.
