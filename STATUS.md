# STATUS — campaign.gershon.ai
Last updated: 2026-11-26 (America/La_Paz)

## Done ✅
- ✅ M1 and M2 merged: v2 connection foundation and normalized dry-run engine.
- ✅ App no longer seeds fictional campaigns, contacts, sender cards, inbox or activity.
- ✅ Real local imports/drafts survive cleanup; simulated delivery history is removed.
- ✅ No simulated local Start/Reply success or invented sender health scores.
- ✅ Three list types: own Radar (dynamic), CSV (static), Sales Navigator URL (dynamic).
- ✅ Dynamic draft lists refresh hourly and append new matches without duplicates.
- ✅ CSV mapping controls/cards: red when unmapped, green when mapped; text labels too.
- ✅ Intake: ownership checks, shared provider limiter, source leases and revision checks.
- ✅ Local: 54 Node tests passed; 2 multi-connection tests run separately in PostgreSQL CI.
- ✅ Two mocked server tests pass; production build passes.

## Open ❌
- ❌ Review and deploy real-list preparation changes; confirm Radar email ownership mapping.
- ❌ Browser verification of mapping colours (file chooser session expired).
- ❌ M3: real provider dispatch, normalized live intake, send intent and five-prospect pilot.
- ❌ M4: webhooks, reconcile, inbox, reconnect and connection click-through.
- ❌ M5: running-campaign source integration/write-back, metrics and daily report.
- ❌ M6: production deployment via workflow, login/membership and health verification.
- ❌ Rotate the Unipile test key in Vault before go-live (Claude).

## Decisions / limits
- Confirmed by Olivier: own Radar account; hourly refresh adds new matching prospects.
- List intake currently accepts drafts only; real data never enters the simulation engine.
- No production migration, deployment, provider request, invitation or message in this change.
- Browser Start/Reply stay gated pending live-engine acceptance.
- Details: docs/REAL-CAMPAIGN-LISTS.md. Existing bundle size warning remains.

## Deploy route
Cloudflare Pages project: gershon-campaign; domain: campaign.gershon.ai.
Use .github/workflows/deploy.yml at M6 only. No direct uploads or setup commands for Olivier.
