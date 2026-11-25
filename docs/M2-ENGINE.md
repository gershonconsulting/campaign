# M2 — Dry-run sending engine

The engine executes from normalized PostgreSQL records, independently of the browser's draft snapshot. It has no provider dispatch path. `CAMPAIGN_SENDING_ENABLED` defaults to false; setting it to `true` returns 503 before any work. Sender/counter/identity records are constrained to `dry_run`. Synthetic provider, chat and invite IDs start with `dry-run:` and must never be promoted into live records.

The M1 connection click-through is deferred to M4 with reconnect, as Olivier requested. M1 PR #3 has been merged; M2 targets the preview implementation branch. M2 does not deploy any functions or migrations.

## Database and execution

`202611240001_campaign_engine.sql` creates the private `campaign_engine` schema, avoiding unverified generic table names in Radar's public schema. It adds sender_accounts, campaigns, campaign_steps, campaign_contacts, campaign_actions, campaign_events, sender_daily_counters, inbox_messages, provider_owners and api_limiter. It does not alter existing Radar tables or rewrite Campaign snapshots.

Every workspace table has RLS and workspace-consistent composite foreign keys. Authenticated users have only SELECT access to their workspace; anonymous users have none. Only service_role can call the public execution RPCs. The global limiter row has no workspace owner or browser policy because it protects all workspaces together. Do not expose the private schema in Supabase's API settings: the Edge Functions use the public service-only RPCs. Future UI reads can use authenticated read RPCs under RLS.

- **Planner:** creates one durable action per contact/step/type. Waiting invitees and contacts with queued actions do not consume a planning batch. Invitations expire after 21 days by default; no withdrawal is issued. Finished campaigns become completed.
- **Worker:** claims with `FOR UPDATE SKIP LOCKED`, locks the sender, reserves pacing/limiter capacity, then applies a simulated result in a second transaction. A random claim token rejects stale completions; claims at least ten minutes old are reclaimed. A partial unique index allows one claimed action per sender and one outstanding action per contact.
- **Pacing:** exact rolling 60-second window of eight reservations, stored under a row lock. This single conservative bucket covers all engine accounts, so multiple keys cannot multiply throughput. Weekdays/hours and daily counter dates use the sender's timezone. Invite/message hard caps are 25/80, defaults 20/50. Lookup/visit do not consume send counters. A sender slot is reserved for a random 2–8 minutes, adjusted for completion latency. Cron ticks may add scheduling latency.
- **Transitions:** lookup simulates first/second/third-degree status. First-degree skips invitation. Other contacts invite and wait for acceptance. Messages wait their configured delays from acceptance or the preceding message. Replies cancel both pending and claimed work. Account pause pauses all running campaigns on that sender. Pause/resume/remove controls are service-only until the product integration milestone.
- **Retries:** 429 extracts the numeric Retry-After header, HTTP date or “Retry in N seconds” text, waits N plus 2–10 seconds jitter, and preserves the failure budget. Server errors allow three retries after 1, 5 and 15 minutes, then fail. A confirmed message access restriction switches to the invite path and reuses the same message action after acceptance. Permanent errors fail the contact; error logs never include message text.
- **Deduplication:** provider_owners reserves one enrollment for a provider identity within a workspace and execution mode, including completed campaigns. That enrollment can send its configured follow-ups; a different campaign cannot initiate another sequence for the same identity.
- **Templates:** validated in normalized step saves and again at start/execution. Unknown/malformed variables and missing values are rejected; fallbacks and line breaks are preserved. Invite notes reject links and lengths over 300 characters using the longest real value of each variable. Started steps, sender identity and campaign configuration cannot change.

The event reducer is service-only infrastructure for tests and M4. It does not expose a public webhook or invent live acceptance/reply events. Inbox storage is present but live synchronization/replies remain M4.

## Scheduler and review environment

The deployable `campaign-planner` and `campaign-worker` functions accept POST only and verify a separate scheduler secret. `CAMPAIGN_CRON_SECRET` must be at least 32 characters. They use the supplied service-role environment credential solely to call database RPCs. The worker imports no Unipile client and logs only action counts; queue results contain IDs/types/timestamps and the dry-run marker, never bodies.

`supabase/ops/install-campaign-cron.sql` is an opt-in scheduler installation script for the deployment operator, not an automatically applied migration. It schedules both endpoints once per minute using pg_cron and pg_net. It reads `campaign_engine_base_url` and `campaign_engine_cron_secret` from Vault at execution time, so credentials are not copied into cron job text. The latter must match `CAMPAIGN_CRON_SECRET`. No production schedule has been installed. Claude/Codex handles environment setup; Olivier has no commands or setup buttons to run.

## Validation evidence

`tests/engine-db.test.ts` applies the actual migration and calls its actual RPCs. Local tests use isolated in-memory PostgreSQL (PGlite); CI additionally runs against disposable PostgreSQL 16, including two-connection SKIP LOCKED and simultaneous limiter-reservation tests. The test harness only accepts the loopback `campaign_test` database. No production database connection or provider credential is used.

`supabase/functions/_tests/engine_test.ts` intercepts HTTP calls and verifies scheduler authentication, missing-secret rejection, the live-mode rejection, bounded database-only execution and redacted failures. Provider contract tests cover 429/403 behavior, pagination and users_ids arrays. No live checks run in CI.

The committed [simulation log](validation/M2-SIMULATION.json) is actual output from the database suite: 20 fake contacts; 20 lookups; 20 visits; 12 invitations; 51 messages; 16 finished; 3 replied and stopped; 1 invite expired. These are simulated actions, not LinkedIn sends. Tests assert sender caps, minimum spacing, action idempotency and final states. The clock jumps over idle periods and rounds execution to minute ticks; acceptance and reply events are explicitly injected test fixtures.

## Next milestones

M3 introduces actual provider lookup/dispatch and normalized draft promotion. Browser Start/Reply continue to reject live delivery in M2. Dry-run counters must stay separate from live usage. Before writes, M3 must add durable dispatch intent and handle ambiguous network/crash outcomes without blindly retrying non-idempotent provider writes; the dry-run claim token alone cannot guarantee external exactly-once delivery. The existing status/auth provider calls also need to share the database limiter before live dispatch is enabled.

M4 adds authenticated webhook ingress, reconciliation, inbox delivery and the connect/reconnect browser click-through. M5 inspects Radar's actual schema before mapping prospect IDs/import/write-back and adds accurate product metrics/reporting. M6 deploys through the existing Cloudflare workflow. Rotate the Unipile test key in Vault before go-live.
