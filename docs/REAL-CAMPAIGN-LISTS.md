# Real campaign preparation — November 26, 2026

Olivier requested removal of fake application data and three prospect-list sources. He confirmed that dynamic lists should refresh hourly and add new matching prospects, and that Radar should use his own account. CSV mapping controls should be red when unmapped and green when mapped.

## Delivered

- New workspaces start empty. Fictional people, campaigns, sender cards, inbox threads and activity are no longer seeded. The old dataset lives only under test fixtures and is not imported by the application.
- Former browser-preview data is cleaned into a new draft store: known demo people/senders/history are removed, real imported contacts and user-created drafts/snippets/templates are retained, and inherited simulated progress is reset. A seeded campaign containing real imported prospects becomes a recovered draft. The original browser entry stays untouched as a recovery copy; no cloud data is deleted.
- Local Start and Reply no longer pretend to execute successfully. Connection health scores are no longer invented or displayed. The CSV template is blank.
- First-campaign creation also works when the workspace has no existing client: the user can enter the actual client name in the creation form.
- **From Radar:** a dynamic source with grade/country filters. Reads only selected prospects from the authenticated user's Radar account. Source ownership cannot be supplied by the browser.
- **CSV upload:** a fixed snapshot, up to 5,000 rows and 5 MB, with explicit column mapping. Unmapped controls/cards have a red background and “Not mapped” text; mapped controls/cards have a green background and “Mapped” text. The LinkedIn URL mapping is required. Invalid, duplicate and blacklisted profiles are counted separately. Failed file selection/parsing clears stale import rows.
- **Sales Navigator URL:** a dynamic people-search or saved lead-list source using the assigned workspace sender. URLs are restricted to LinkedIn HTTPS and recognized people paths. Company/account-list URLs are rejected. Responses do not invent missing names, titles or companies.
- A Prospect lists tab shows source type, number added, last refresh and refresh errors, with Sync now for dynamic sources. Previously enrolled profiles are deduplicated across all workspace campaigns, including completed campaigns and other clients.

## Verified contracts and security

Radar's [hub reader](https://github.com/gershonconsulting/radar/blob/main/supabase/functions/hub/index.ts) uses `targets`, `owner_key`, `lead_id`, `linkedin_url`, `selected`, `grade` and the displayed profile fields. This differs from an assumed generic prospects table. The implementation maps a confirmed Supabase user email to exactly one `public.users.email` record and its owner_key; no default owner is guessed. Missing/ambiguous mappings fail closed. The Radar tables are read only.

Unipile documents [Sales Navigator searches](https://developer.unipile.com/v2.0/docs/linkedin-search-users) and [saved lead lists](https://developer.unipile.com/v2.0/docs/sales-navigator-lists). The implementation uses POST `/v2/{account}/linkedin/sales-navigator/search` with `{url}` or POST `/v2/{account}/linkedin/sales-navigator/lead-lists/{id}` with `{}`. Both are read operations, not invitations or messages. Search scans respect the 2,500-result provider cap; saved lead lists continue paging independently. Each request reserves a token from the shared database limiter first.

`202611250001_campaign_lists.sql` adds source records, RLS and service-only RPCs for claims, fenced application, retry release and provider reservations. Existing Radar and Campaign data are not rewritten by the migration. A refresh applies people/enrollments using a workspace revision check and retries stale snapshots without repeating provider reads. A completed CSV cannot be reclaimed. Dynamic pages continue on minute ticks; finished scans reset their cursor and schedule the next scan an hour later. The scheduler rechecks that the source creator still has workspace operator access.

## Deployment and current limits

These changes prepare **real-data drafts**. The M2 engine remains dry-run-only; live Start/Reply stay blocked pending M3/M4. Intake deliberately accepts drafts only, so real prospects are never inserted into the simulation engine or given simulated delivery facts. Normalized live intake must be connected in M3 before running campaigns can continue hourly enrollment.

The two new functions are `campaign-lists` (JWT + workspace operator checks) and `campaign-list-sync` (dedicated cron secret). The existing opt-in cron installer adds minute polling for sources, whose own due times enforce hourly refresh. Claude/Codex applies the additive migration and deploys/configures the functions in the review/deployment workflow. Olivier does not run setup commands. Production deployment remains gated to M6 through the existing workflow. No production database change, provider request, invitation or message was made for this change.

The existing public connection badge does not configure authenticated workspace persistence by itself. Standard Supabase URL/anon-key configuration, login and membership must be verified in the deployment environment. Existing local drafts are not silently replaced by a different cloud workspace.

## Review checks

Automated tests cover empty startup, legacy draft recovery, safe CSV fields, URL validation, Radar ownership, absence of invented profile fields, cross-campaign deduplication, source leases/revisions, immutable CSV snapshots and hourly scheduling. Database checks run against actual migration/RPC code; CI includes PostgreSQL 16. Provider requests are mocked, with no live calls in CI.

The local browser showed the three source choices and CSV upload controls. The subsequent browser file-chooser check could not finish because the browser session expired; visual mapping verification remains a review click-through. It does not require LinkedIn authentication. The connection/reconnect click-through remains M4 as agreed.

Questions for Olivier/Claude: confirm that Olivier's verified Campaign login email matches his Radar users.email record; otherwise a verified account mapping is needed before Radar refresh can run. A real Sales Navigator read should also be checked with the chosen sender after review. Rotate the Unipile test key before go-live.
