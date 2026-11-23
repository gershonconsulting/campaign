# campaign.gershon.ai — Product & Technical Specification

Version 1.0 · 2026-11-23 · Owner: Olivier Attia (CTO) · Status: ❌ ready for development

> A simple, reliable **LinkedIn drip-campaign engine** for Gershon Consulting that takes prospects collected by **radar.gershon.ai** and contacts them through timed sequences (visit → invite → messages), replacing Botdog. **No AI features.** Reference research: `research/botdog/`.

---

## 1. Goals and non-goals

**Goals**
1. Push graded prospects from Radar into a campaign in one click (or automatically by rule), without CSV handling.
2. Run drip sequences from one or more LinkedIn accounts (Olivier, team, client "managed identities") in the cloud — no Chrome extension, computer can be off.
3. Keep accounts safe: per-action daily limits, working hours, random pacing, warm-up, auto-withdraw.
4. One inbox for replies; replies stop the sequence and are reported back to Radar and the client report.
5. Clear numbers per campaign and per client (acceptance rate, reply rate, funnel).

**Non-goals (v1)**
- Any AI: no AI variables, rewrite, AI review, AI comments, sentiment, suggested actions, profile review.
- Scraping LinkedIn searches / Sales Navigator / post engagers (Radar already collects prospects).
- Email steps, voice notes, event invites, team "spread" campaigns (see §12 roadmap).

## 2. Users and roles
| Role | Can |
|---|---|
| Owner (Olivier) | Everything, billing-free (internal tool), all clients |
| Admin (e.g. Nicolette) | Manage campaigns/senders for all clients, act as a managed identity |
| Member (Aina, Juliana…) | Campaigns of the clients assigned to them |
| Client viewer | Read-only dashboard of their own client's campaigns |

Auth: Supabase Auth (Google sign-in for @gershonconsulting.com, magic link for client viewers).

## 3. Core concepts
- **Client** — a Gershon client, identified by its canonical Gershon client key number (same as other Gershon platforms).
- **Sender** — a connected LinkedIn account (Olivier's own, or a managed identity for a client). Has limits, timezone, working days, health.
- **Prospect** — one person (LinkedIn URL / public id). Comes from Radar (default), CSV, pasted URLs or API.
- **Campaign** — sender + list of prospects + sequence + schedule. Status: Draft → Running ⇄ Paused → Completed / Archived.
- **Sequence** — ordered steps with simple branches. Frozen structure after start (only texts and delays editable), like Botdog.
- **Enrollment** — one prospect inside one campaign, with current step, next run time, state.
- **Action** — one LinkedIn operation queued/executed for an enrollment (visit, invite, message, InMail, withdraw, follow-company invite, react).

## 4. Functional requirements

### 4.1 Radar → Campaign (the main entry point)
- Radar prospect fields used: `first_name, last_name, title, company, city, country, language, linkedin_url, grade, score, owner, connection, collected_date`.
- In campaign.gershon.ai: **"Add from Radar"** dialog with filters — owner, grade (A/B/C/D), min score, country, language, collected date range, free text, connection degree; preview count; skip rows without `linkedin_url`.
- **Auto-feed rule** (per campaign, optional): "every day at 07:00 add new Radar prospects with grade ≥ B and owner = X, max N/day".
- Dedupe: never enroll the same LinkedIn profile twice in active campaigns of the same client; skip blacklisted; skip existing 1st-degree connections if the sequence starts with an invite (route them to "already connected" branch instead).
- Write-back to Radar: set `campaign_pushed_at`, `campaign_id`, and later `campaign_status` (invited / accepted / replied / done) so Radar's "pushed to Botdog" counter becomes "pushed to Campaign".
- Other imports: CSV (up to 5,000 rows, column mapping, sample template), paste LinkedIn URLs, REST API `POST /api/campaigns/{id}/prospects`.

### 4.2 Sequence builder (no AI)
Vertical step list (not a free canvas) — simpler than Botdog, same power for drips.

Step types v1:
| Step | Notes |
|---|---|
| Visit profile | Always first by default |
| Send invitation | Optional note ≤ 300 chars; skipped if already connected |
| Wait for acceptance | "Accepted within N days?" → Yes branch / No branch (No: withdraw, or InMail, or end) |
| Wait | N hours / days (business days option) |
| Send message | ≤ 4,000 chars, 1st-degree only |
| Send InMail | Subject + body, only if sender has Premium/Sales Nav credits |
| Invite to follow company page | Requires sender is admin of page |
| React to latest post | Like |
| End | |

- Variables: `{{firstName}}`, `{{lastName}}`, `{{fullName}}`, `{{title}}`, `{{company}}`, `{{city}}`, `{{country}}`, `{{senderFirstName}}`, `{{senderFullName}}`, plus any CSV custom column; fallback syntax `{{firstName | there}}`. Preview per prospect; block start if a variable has no value and no fallback.
- A/B: up to 3 variants per message/invite note, round-robin, stats per variant.
- **Send condition** per message (from Botdog): default "only if the last message in the thread is from me or no messages yet"; options: always, only new conversation, only if they never wrote to me.
- **Stop rules** (global, always on): stop when prospect replies, when they are blacklisted, when invitation withdrawn/ignored past timeout, when sender disconnected (pause).
- Templates: "Invite only", "Invite + 2 follow-ups", "Message 1st-degree connections", "Invite + 3 follow-ups", "Cold lead reviver", plus **Save as template** / **Duplicate campaign**. Snippets library for reusable texts.
- After start: steps locked; texts and delays editable.

### 4.3 Campaign settings & lifecycle
- Name (convention `NN - Client - Topic`), client, sender, timezone, working hours (default 9:00–18:00), active days, start date/time, optional end date, priority flag, daily cap for this campaign (optional, within sender limits).
- Actions: start, pause, resume, pause new enrollments only, add prospects, duplicate, export CSV, archive, delete (draft only; running → archive).
- Progress: total / in progress / completed / skipped (with reason).

### 4.4 Sender (LinkedIn account) management
- Connect via the execution provider's hosted connect screen (credentials + 2FA, or `li_at` cookie for SSO/Recruiter). Show account type (Free / Premium / Sales Nav).
- Per-sender daily limits with Safe / Moderate / Risky bands and "Reset to safe":
  | Action | Safe default | Max allowed |
  |---|---|---|
  | Invitations | 20/day (new acct 10) | 40 |
  | Profile visits | 60 | 150 |
  | Messages | 50 | 120 |
  | InMails | 15 | 30 |
  | Company-page invites | 30 | 100 |
  | Post reactions | 20 | 40 |
  Weekly invitation ceiling 100 (configurable to 200 for Premium).
- Warm-up: new sender starts at 50 % of safe, +10 %/week until safe value.
- Health score (rule-based, no AI) 0–100: connected, not throttled in 7 days, acceptance rate ≥ 25 %, reply rate, consistency. Throttle detection → auto-reduce limits 30 % for 7 days + alert.
- Auto-withdraw pending invitations after 14/30/60 days (default 30) — only those sent by the platform.
- Disconnection → pause sender's campaigns, email + voice/Slack alert, banner.

### 4.5 Unified inbox
- All LinkedIn conversations with prospects enrolled in any campaign (not personal chats), across senders the user may see.
- Filters: unread, needs my reply, waiting on them, campaign, client, sender, tag, date.
- Thread view + reply (text, attachment), mark read/unread, star, manual tags (Interested, Not now, Not interested, Meeting booked, Wrong person), **Add to campaign**, **Blacklist**, "Stop sequence".
- Tagging "Interested" / "Meeting booked" pushes to Radar and to the CRM webhook.

### 4.6 Contacts
- Table of all enrolled prospects: name, title, company, client, campaign, current step, state (queued, invited, connected, messaged, replied, skipped + reason, finished), last action, next action time. Search, filter, export, bulk actions (remove, blacklist, move to campaign).

### 4.7 Reporting
- Dashboard: invitations sent, acceptance rate, messages sent, reply rate, new connections, replies to answer, funnel invites → accepted → replied → interested, daily activity chart, top campaigns, recent activity feed, sender health.
- Per campaign: same numbers + A/B variant comparison + activity over time + export CSV/PDF.
- Per client: roll-up used by the client report (Campaign Review report).
- **Built-in recurring reports (platform feature, not a Claude task):** daily email digest to report@gershonconsulting.com with subject `campaign.gershon.ai — Daily report — YYYY-MM-DD`; weekly per-client summary.

### 4.8 Settings
Team & roles, clients & managed identities, senders, limits, blacklist (profile URL, company, keyword in title), snippets, notifications (email / Slack webhook per event), API keys, outgoing webhooks, timezone.

### 4.9 Integrations
- **Inbound REST API** (API key): create campaign, add prospects, pause/resume, get stats.
- **Outgoing webhooks** (HMAC-signed): `profile.visited`, `invitation.sent`, `invitation.accepted`, `message.sent`, `reply.received`, `enrollment.finished`, `sender.disconnected`.
- Radar (direct DB/API), Gershon CRM, Slack webhook.

## 5. LinkedIn execution layer (how we act without an extension)
See `research/botdog/HOW-IT-WORKS-WITHOUT-EXTENSION.md`.

- **Decision: v1 uses a hosted LinkedIn execution API (Unipile — same approach Botdog appears to use)** behind an internal interface so it can be replaced by self-hosted workers later.
- Interface `LinkedInProvider`:
  ```ts
  connectAccount(): HostedAuthUrl
  getAccount(id): {status, type, limitsHint}
  getProfile(accountId, linkedinUrl): {providerId, firstName, ..., connectionDegree}
  visitProfile(accountId, providerId)
  sendInvitation(accountId, providerId, note?)
  withdrawInvitation(accountId, invitationId)
  listSentInvitations(accountId)
  sendMessage(accountId, providerId | chatId, text, attachments?)
  sendInMail(accountId, providerId, subject, text)
  inviteToFollowCompany(accountId, companyId, providerId)
  reactToLatestPost(accountId, providerId, reaction='like')
  listChats / listMessages(accountId, since)
  // webhooks: new_message, new_relation (accepted), account_status
  ```
- Each sender is pinned to one proxy IP in its home country (provider-managed).
- Provider credentials live in Supabase secrets / Cloudflare env — never in the repo.

## 6. Scheduling engine
1. **Planner** (cron every 5 min): for each running campaign inside the sender's working window, pick enrollments whose `next_run_at ≤ now`, respecting campaign priority and remaining sender quota for that action type; create `actions` rows with a randomized `execute_at` spread over the rest of the hour (gaps 45 s – 6 min, never two actions on one sender within 30 s).
2. **Executor** (cron every 1 min, or queue consumer): lock due actions (`FOR UPDATE SKIP LOCKED`), call provider, record result, advance enrollment to next step and compute `next_run_at` (wait steps, business days, working hours).
3. **Event ingest** (webhook endpoint): acceptance → move "wait for acceptance" enrollments to Yes branch (first message not before +2 h random); reply → stop enrollment, mark replied, notify; disconnection → pause sender.
4. **Reconciler** (hourly): poll sent invitations & chats for events missed by webhooks; auto-withdraw old invitations; daily quota reset at sender-local midnight.
5. Idempotency key per action; retries with backoff (max 3); permanent errors → skip with reason (profile not found, can't invite, out of InMail credits…).
6. Global kill switch per sender and per workspace.

## 7. Data model (Supabase / Postgres)
```
clients(id, client_key, name, …)
users(id, email, role)                          -- Supabase auth
user_clients(user_id, client_id)
senders(id, client_id, display_name, provider_account_id, account_type, timezone,
        work_start, work_end, work_days int[], status, health_score, warmup_started_at)
sender_limits(sender_id, action_type, daily_limit, weekly_limit)
sender_usage(sender_id, day, action_type, count)
prospects(id, linkedin_url unique, provider_id, first_name, last_name, title, company,
          city, country, language, radar_prospect_id, radar_owner, grade, score, custom jsonb)
blacklist(id, client_id null, kind[profile|company|keyword], value)
campaigns(id, number, name, client_id, sender_id, status, timezone, start_at, end_at,
          priority bool, daily_cap, auto_feed jsonb, created_by, started_at)
sequence_steps(id, campaign_id, position, type, config jsonb, parent_step_id, branch)
message_variants(id, step_id, label, subject, body)
enrollments(id, campaign_id, prospect_id, state, current_step_id, next_run_at,
            skip_reason, invitation_id, chat_id, variant_map jsonb, replied_at, finished_at)
actions(id, enrollment_id, sender_id, type, execute_at, status, attempt, provider_ref,
        error, executed_at, idempotency_key)
conversations(id, sender_id, prospect_id, provider_chat_id, last_message_at, unread, tags text[])
messages(id, conversation_id, direction, body, sent_at, provider_message_id, campaign_id)
events(id, type, payload jsonb, created_at)        -- audit + outgoing webhooks
webhooks(id, url, secret, events text[]), api_keys(id, hash, scopes)
templates(id, name, steps jsonb), snippets(id, title, body)
```
Row-level security by client membership. Prospect PII stays in Supabase (EU/US region as decided), never in logs.

## 8. UI / pages
| Route | Content |
|---|---|
| `/` Dashboard | KPIs, health per sender, activity chart, funnel, replies to answer, recent activity |
| `/campaigns` | Table + filters + row menu (§4.3) |
| `/campaigns/new` | Wizard: 1 Prospects (Radar / CSV / URLs / later) → 2 Template → 3 Sequence → 4 Settings & start |
| `/campaigns/:id` | Tabs: Overview (stats), Prospects, Sequence, Activity log, Settings |
| `/inbox` | 3-pane inbox |
| `/contacts` | All prospects table |
| `/senders` | LinkedIn accounts, connect, limits, health |
| `/reports` | Per client / period, export |
| `/settings/*` | Team, clients, blacklist, snippets, notifications, API & webhooks |

Design: Gershon unified design — Linalysis design as master, Gershon.ai red as primary colour; responsive; same login as other Gershon apps.

## 9. Tech stack & deployment
- Front end: React + Vite + Tailwind (Gershon standard) on **Cloudflare Pages**, custom domain `campaign.gershon.ai`.
- Back end: **Supabase** (Postgres, Auth, RLS, Edge Functions, pg_cron) — same project family as Radar so the Radar link is a DB join/RPC.
- Workers: Supabase Edge Functions triggered by pg_cron (planner, executor, reconciler) + webhook endpoint `/functions/v1/linkedin-events`.
- LinkedIn provider: Unipile (v1).
- CI/CD: GitHub Actions → Cloudflare Pages on push to `main`; Supabase migrations in `supabase/migrations`; preview deploys on PRs.
- Monitoring: error log table + daily health email; Slack/voice alert on sender disconnection.

## 10. Safety & compliance
- Conservative defaults (§4.4); hard maxima not overridable by members.
- Only act inside working hours of the sender's timezone; never on disabled days.
- Respect replies and blacklist immediately; one-click "stop all" per prospect.
- LinkedIn's User Agreement does not permit third-party automation — risk of restriction is accepted by Gershon; document to clients using managed identities.
- GDPR: prospect data minimised, deletion on request (remove prospect → purge messages), DPA with provider.

## 11. Acceptance tests (must pass before go-live)
1. Radar → add 20 grade-A prospects → campaign draft shows 20, skips those without URL and duplicates.
2. Start "Invite + 2 messages" on a test sender: profile visits and invites appear only inside working hours, spaced ≥ 45 s, never above daily limit.
3. Accept invitation from a test account → first message sent ≥ 2 h later with variables filled.
4. Reply from test account → sequence stops, inbox shows thread, Radar status = replied, webhook `reply.received` fired.
5. Invitation not accepted in N days → withdraw + No-branch executed.
6. Disconnect sender → campaigns paused, alert sent; reconnect → resumes.
7. Pause/resume, duplicate, export CSV, blacklist mid-campaign.
8. Daily report email received at report@gershonconsulting.com.

## 12. Roadmap after v1
- v1.1: team campaigns (spread prospects across several senders), A/B auto-winner, business-day waits UI, client viewer portal.
- v1.2: email step (via Gershon mail stack), event invites, LinkedIn search import.
- v2: replace provider with self-hosted workers if volume justifies cost.

## 13. Delivery plan (estimate)
| Milestone | Scope | Est. |
|---|---|---|
| M1 | Repo, Supabase schema, auth, senders connect via provider | 1 wk |
| M2 | Campaign wizard, sequence builder, Radar import | 2 wk |
| M3 | Planner/executor/webhooks, limits, withdraw | 2 wk |
| M4 | Inbox, contacts, dashboard, reports, daily email | 2 wk |
| M5 | Acceptance tests on test account, then pilot on one live campaign alongside Botdog | 1 wk |

## 14. Open decisions (❌)
1. Confirm provider (Unipile account + pricing per connected account).
2. Supabase project: reuse Radar's project or a new one linked by API.
3. Which senders in pilot (Olivier only, or also managed identities for clients).
4. When to cancel Botdog (after M5 pilot shows equal or better acceptance/reply rates).
