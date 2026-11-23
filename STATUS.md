# STATUS — campaign.gershon.ai
Last updated: 2026-11-23

## State
Research + specification phase. No code yet.

## Done ✅
- ✅ Botdog reviewed page by page (dashboard, campaigns, 5-step wizard, sequence builder, contacts, inbox, all settings, team dashboard, integrations)
- ✅ 44 screenshots stored, prospect names/messages blurred (repo is public)
- ✅ "How Botdog works without an extension" research (cloud session via li_at cookie or credentials, proxy per account, most likely built on Unipile)
- ✅ Full specification v1.0 (docs/SPECIFICATION.md)

## Open ❌
- ❌ Decide LinkedIn execution provider (Unipile recommended) and open account
- ❌ Decide Supabase project (reuse Radar's or new)
- ❌ M1–M5 build (see spec §13)
- ❌ Make this repo private (it contains Gershon campaign data in screenshots, even if blurred)

## Known issues
- A test draft "New campaign" (0 contacts, not started) was created in Botdog during the review — can be deleted.

## Deploy route (planned)
GitHub Actions → Cloudflare Pages (campaign.gershon.ai) + Supabase migrations.
