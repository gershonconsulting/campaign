# Campaign implementation — 2026-11-23

This branch adds a working React application to the research-only repository.
It is an operator preview and integration foundation, **not yet a production replacement for Botdog**.
No existing Botdog campaigns or live Gershon services were modified.

## Implemented and usable

- Radar’s actual unified theme informed the interface: white 240px sidebar, Gershon red `#FE1B04`, system typography, light gray canvas, bordered cards and tables.
- Dashboard, campaign filters and actions, create-draft flow, campaign detail tabs.
- Radar import dialog with preview filters; CSV parser and column mapping; pasted profile URLs; invalid URL rejection; dedupe within a batch and active client campaigns; blacklist checks.
- Sequence list with insert, reorder, delete, acceptance/no branches, waits, invitation/message/InMail editors, variables with fallbacks, per-prospect previews, up to three message variants, and send conditions.
- Started sequences lock step structure. Save as template, snippets, duplicate, priority, archive, draft deletion, scheduling preferences.
- Contacts with filters, bulk stop/blacklist and CSV export.
- Inbox with sample threads, local demo replies, read/unread, stars and manual tags.
- Sender limits with conservative defaults and maximum bounds.
- Campaign/client reports, CSV export and browser print-to-PDF.
- Browser-local demo persistence; separate Supabase persistence path and sign-in screen when environment variables are provided. Sample data is never seeded into Supabase.
- SQL migration with workspace membership isolation, operator/viewer roles, revision checks, audit records and server-owned execution facts.
- Server endpoints for Unipile hosted connection and a configurable Radar prospect adapter.
- Pure scheduling planner: timezone-aware working hours, disabled days, date windows, randomized first action, sender quotas, seven-day invite cap, reply/blacklist/kill-switch/disconnect stops, send conditions, and acceptance timeout handling. This planner is **not connected to an executing worker**.

## Explicit remaining work

M1/M2 are substantially implemented as an internal operator preview. M3–M5 are not complete.

1. Provision the selected Supabase project; run and validate the migration against Postgres, set up Google/email authentication, and provision owner membership.
2. Commission Unipile using a test sender. Hosted auth code follows its v1 API; actual account response mapping and callback behavior need integration testing.
3. Implement durable execution claims/outbox, provider action dispatch, verified event ingest, acceptance/reply reconciliation, retry classification, throttling/warm-up, and automatic withdrawal. Wire the tested planner to these components. The live start and reply endpoints currently return an explicit 503; they never silently simulate success.
4. Map Radar’s actual data and write-back contract. `RADAR_IMPORT_URL` currently expects the frontend `Person` field names, not arbitrary Radar DB rows.
5. Implement attachments, live inbox sync, reminders, outbound HMAC webhooks/API keys, scheduled daily/weekly email reports, and team/client membership administration.
6. Add client-specific member/viewer isolation before granting access to clients. Initial roles are workspace-wide owner/admin/viewer only. The repository specification’s normalized SQL model is not yet implemented; the first migration stores a revisioned workspace JSON document for the operator preview. Migrate execution entities into relational tables for scale and per-client access before production rollout.
7. Run the specification’s eight live acceptance tests. Only then enable live sending and pilot alongside Botdog.

The current preview deliberately exposes the product controls while keeping live delivery unavailable. Do not cancel Botdog based on this branch.

## Local development

Requires Node 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

Without `.env.local`, the app uses fictional, clearly marked sample data in browser storage. Real profile data should only be imported into a configured private workspace.

To configure persistence, copy `.env.example` to `.env.local`, set the public Supabase URL and anon/publishable key, and restart Vite. Never put service-role or Unipile credentials in a `VITE_` variable.

## Supabase setup

Apply `supabase/migrations/202611230001_campaign_workspace.sql` to the chosen project. This has not been executed against a live database during this build.

After creating the intended owner in Supabase Auth, provision the workspace in the SQL editor with the real user UUID:

```sql
with w as (
  insert into public.campaign_workspaces(name)
  values ('Gershon Consulting') returning id
)
insert into public.campaign_members(user_id, workspace_id, role)
select '<AUTH_USER_UUID>'::uuid, id, 'owner' from w;
```

Enable Google and/or email sign-in. Allow the exact app origin as a redirect URL. Other signed-in users have no access until explicitly provisioned in `campaign_members`.

Server secrets:

| Key | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact frontend origin, e.g. `https://campaign.gershon.ai` |
| `UNIPILE_DSN` | HTTPS API origin supplied by Unipile |
| `UNIPILE_API_KEY` | Server-only provider API credential |
| `RADAR_IMPORT_URL` | Trusted HTTPS adapter returning up to 5,000 prospects |
| `RADAR_IMPORT_SECRET` | Bearer credential for that adapter |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions. Deploy `campaign-api` and `linkedin-connect` using the included `config.toml`. The former verifies the user token itself; the latter validates a one-use expiring connection request and fetches account details from Unipile. Never expose service-role credentials in the browser.

## Deployment

The existing plan targets Cloudflare Pages, so this implementation preserves that route. `validate.yml` checks pull requests and uploads `dist` as an artifact. `deploy.yml` is manually invoked and requires a GitHub `production` environment with:

- Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- An existing Cloudflare Pages project named `gershon-campaign`.

Attach `campaign.gershon.ai` only through the intended Cloudflare account. The custom domain was not changed in this build. No alternate hosted Site was created.

## Verification

TypeScript checking and the Vite production build pass. Ten automated core tests pass. Browser checks cover creating a campaign, importing one valid profile while skipping a duplicate and an invalid URL, starting a demo campaign and locking its structure, saving a demo reply, and retaining the reply after reload. No real message or invitation was sent.

Live database policies, provider endpoints, authentication, CI and production deployment still require environment-backed validation.

