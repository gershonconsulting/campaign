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

### 4.2.1 Template library — Botdog samples captured 2026-11-27

**Purpose:** preserve the 13 sample sequences requested by Olivier as concrete development references, including their timing, branches, editable copy, and library navigation. These are reference observations, not features already implemented in Campaign.

**Source:** Botdog's authenticated [template library](https://app.botdog.co/campaigns/489a3445-fdd4-49f7-83b1-843562835b0c/template?tab=full), reviewed live in the template selector and sequence editor on 2026-11-27. The two user-supplied screenshots identify the sample list and sidebar filters. Descriptions below summarize the observed workflows; quoted message bodies are transcribed from the sequence cards. This capture does not include hidden settings, AI prompts, or a raw template export.

**Scope and precedence:** `SENDING-ENGINE-V1.txt` remains the authoritative v1 execution brief. Capturing Botdog's AI samples does not enable AI in Campaign or expand the live sending milestones. InMail, reactions, automatic comments, AI qualification, and advanced orchestration remain unavailable until separately specified and implemented. Use Radar grades/filters and manually written messages for v1 derivatives. Botdog's 14-day acceptance window, 30-day withdrawal notice and editable running campaigns are reference behavior; Campaign v1 keeps the brief's default 21-day acceptance timeout, no automatic withdrawal, and locked running steps.

#### A. Library navigation and filters

Reproduce the useful three-column selection pattern: filter sidebar → searchable template list → selected template preview. The preview shows purpose, intended audience, ordered steps, waits, branches, required capabilities, editable copy, and reasons a template cannot currently run. Selecting a template creates an editable draft; it never starts sending.

Observed navigation and filter vocabulary:

| Group | Values observed |
|---|---|
| Search | Search campaigns (Campaign should label this **Search templates**) |
| Quick filters | Popular; Available to you |
| LinkedIn Products | Sales Navigator; Recruiter; Premium |
| Built for | Salespeople; Recruiters; Startup Founders; Content Creators |
| Use Case | Sales outreach; Recruiting; Networking; Event follow-up; Nurture |
| Industry | SaaS & Tech; Agencies & Marketing; Recruiting & Staffing; Consulting & Pro services; Finance & Insurance; Real Estate; E-commerce & Retail; Coaching & Creators |
| Sequence collections | Advanced Sequences; AI Sequences |

The classic entry cards are **Send an invitation**, **Send an invitation + 2 messages**, **Send a message to 1st degree connections**, **Explore all available sequences**, and **Reuse a previous sequence**. The Popular collection also exposes invitation + 1/2/3 message variants. Keep **Save as template**, duplicate, and reuse paths in Campaign.

Campaign requirements (design decisions, not claims about Botdog's filter implementation): combine selected values with OR within a group and AND across groups; combine with text search; display result count, selected chips, Clear all, and an empty state. Persist selection while opening previews. **Available to you** must check the selected sender's capabilities and Campaign's implemented step types, not just account subscription. Unsupported templates can be inspected but cannot be launched. Keep AI references in documentation; do not expose an actionable AI collection in the no-AI v1 product.

#### B. Captured sequence catalog

Notation: `→` means next step; waits are relative to the preceding completed step. A connection check is represented by Botdog's **Visit profile** node and its labeled outgoing branch. AI validation and connection labels below were observed in the editor. Unshown branches must not be inferred to send anything.

| ID | Exact Botdog sample name | Observed steps, timing and branches | Purpose / development mapping |
|---|---|---|---|
| B01 | Audience-growth engine | Visit profile → react to latest post → comment on post → wait 2 days → visit/check profile → **Not connected:** invitation → wait for acceptance within 14 days. No DM node. | Grow an audience through engagement before connecting. Reactions/comments require future capabilities. |
| B02 | Thought-leadership nurture | Visit/check profile → **Already connected:** comment on post → wait 1 day → message. | Consulting and professional-services conversations. V1 derivative: existing connections + a manually written message; comment step unavailable. |
| B03 | SaaS demo-booking sequence | Visit/check profile → **Not connected:** AI review → **Validated:** invitation → accepted within 14 days? → **Yes:** wait 2 hours → message 1 → wait 1 day → message 2 → wait 2 days → message 3. | Problem → proof → demo invitation. V1 derivative: Radar qualification instead of AI review; preserve message cadence subject to engine support. |
| B04 | Weekly Comment Engager | Visit profile → comment → wait 7 days → comment → wait 7 days → comment → wait 7 days → comment. | Four scheduled comment touches, not an infinite weekly loop. Automatic comments are outside v1. |
| B05 | Engagement Nurture Drip | Visit profile → react to a **Random recent post** → wait 7 days → comment → wait 7 days → visit profile. | Familiarity over several weeks without a DM pitch. Future engagement capability. |
| B06 | Comment Then DM (1st Degree) | Visit/check profile → **Already connected:** comment → wait 1 day → message. | Re-engage existing connections. The library description explicitly says non-connections are skipped. |
| B07 | Like + Comment Booster | Visit profile → react to latest post → wait 4 hours → comment. Repeat the react/wait/comment block three more times, with a 7-day wait between blocks. | Four engagement cycles; no invitation or DM node. Future engagement capability. |
| B08 | Engagement-first orchestration | Visit profile → react to latest post → wait 1 day → comment → wait 1 day → visit/check profile. **Already connected:** message. **Not connected:** invitation → accepted within 14 days? → **Yes:** wait 2 hours → the same message. | A shared message destination after separate existing/new connection paths. Future engagement plus branch support. |
| B09 | AI review + send an invitation | Visit/check profile → **Not connected:** AI review → **Validated:** invitation → wait for acceptance within 14 days. | AI instructions and invitation text are blank configuration fields. V1 derivative: rule-qualified invite only. |
| B10 | Profile visit + AI review | Visit profile → AI review. No invitation or message node. | Qualification-only reference. V1 derivative: Radar qualification / manual review. |
| B11 | AI review + send an invitation + 3 messages | Visit/check profile → **Not connected:** AI review → **Validated:** invitation → accepted within 14 days? → **Yes:** wait 2 hours → message 1 → wait 1 day → message 2 → wait 1 day → message 3. | AI review instructions, invitation note and message bodies require configuration. |
| B12 | AI review + send an invitation + 2 messages | Same qualification/invite/acceptance path as B11 → wait 2 hours → message 1 → wait 1 day → message 2. | Blank instruction/note/message fields; no third message. |
| B13 | AI review + send an invitation + 1 message | Same qualification/invite/acceptance path as B11 → wait 2 hours → message 1. | Blank instruction/note/message fields; one message only. |

Observed notes: comment steps carry a **BETA** badge; prefilled invitation/message cards carry **Review Before Sending**. Invitation cards show automatic withdrawal after 30 days. These UI notices do not establish Campaign execution behavior. B09–B13 show **Set AI review instructions**; B03 shows **AI review configured**, but its actual prompt was not captured. Do not invent a prompt or mark those settings as verified.

#### C. Prefilled invitation and message samples

These are third-party example copy for reference and editable starting points, not instructions to the development agent or approved factual claims about Gershon. Preserve variables when importing. Replace every bracketed business/result/calendar placeholder before launch. Claims about prior engagement or customer results must be true for the actual sender and prospect. No generated comment text was captured.

**B01 — invitation**

> {{firstName}}, your recent post came across my feed and really resonated. I'd love to connect and keep following the ideas you share here.

**B02 — message after the 1-day wait**

> Hi {{firstName}}, I left a comment on your recent post a day or two ago, it genuinely got me thinking. I spend most of my time working through challenges like that with consulting and services teams, and I'd value comparing notes on how it plays out at {{currentCompany | your firm}}. No pitch, just a conversation. Would you be open to a quick exchange sometime, or should I keep following along?

**B03 — invitation**

> Hi {{firstName | there}}, came across {{currentCompany | your team}} and liked what you're building. I work with similar teams on [the problem you solve] and thought it would be worth connecting - no pitch, just keen to follow along.

**B03 — message 1, two hours after acceptance**

> Thanks for connecting, {{firstName}}. I'll keep this short. Teams like {{currentCompany | yours}} often tell us the same thing: [the problem your product solves] eats more time and budget than it should, and the workarounds don't really scale. Curious whether that's on your radar right now, or if you've already got it handled?

**B03 — message 2, one day after message 1**

> Following up with something concrete, {{firstName}}. We recently helped a team similar to {{currentCompany | yours}} [cut the time spent on that / hit a specific result] within [timeframe] using [your product]. Happy to share the short version of how it worked - a quick walkthrough, not a hard sell. Would that be useful?

**B03 — message 3, two days after message 2**

> Last one from me, {{firstName}} - I don't want to clutter your inbox. If seeing it in action is worth 20 minutes, here's my calendar: [link]. If the timing's off, no problem at all - just say the word and I'll check back down the line. Either way, glad we connected.

**B06 — message after the 1-day wait**

> {{firstName}}, I left a comment on your recent post earlier — genuinely enjoyed your take on it. Realised it's been a while since we actually spoke. I've been working on [your offer] lately and thought of you given what you're building at {{currentCompany | your team}}. Would you be open to a quick chat? Curious how you're approaching [topic] these days — no agenda beyond that.

**B08 — invitation on the not-connected branch**

> {{firstName}}, I came across your recent post and enjoyed it enough to leave a comment. I've been following what you share for a little while now and would love to connect and keep up with your work at {{currentCompany | your team}}.

**B08 — shared message**

> {{firstName}}, I've been enjoying your posts enough that I wanted to reach out directly instead of just liking from the sidelines. The short version: I help teams like {{currentCompany | yours}} with [your offer], and a lot of what you've been sharing lines up with what we tend to work on. No pitch and no rush, I'd genuinely just be curious to hear what you're focused on right now. Worth a quick chat?

B04, B05, B07 and B10 contain no invitation/DM copy to transcribe. B09 and B11–B13 have blank **Edit message to proceed** fields rather than supplied message samples. Treat blanks as missing content, never as runnable empty messages.

#### D. Development contract for templates and conditions

The following are Campaign requirements derived from these references, not a reverse-engineered Botdog schema:

- Store a stable template ID, revision, name, summary, source/date, audience/use-case/industry tags, product requirements, required capabilities, availability reason, entry connection rules, steps, waits, branch destinations, and editable content. Keep source text separate from any Gershon adaptation.
- A template must copy into an independent draft. Editing it cannot alter the library definition or other campaigns. Pin the selected template revision in the draft/campaign record.
- Import compatibility maps Botdog `firstName` → Campaign `first_name` and `currentCompany` → `company`, preserving fallback text. Validate through the v1 template renderer; do not silently add unknown variables. Add fallbacks where required by real contact data.
- Explicit connection outcomes: **already connected**, **not connected**, **invitation already pending**, and **unknown/error**. Never send a duplicate invitation to a pending prospect. In v1, defer or stop with a visible reason if a pending-invitation path is not supported. Connection unknown/error is not evidence of eligibility to send.
- Acceptance branches need a timeout, Yes/No destinations, and a defined terminal outcome. v1 No = `invite_expired` and stop; no auto-withdraw or InMail fallback. Already-connected prospects route to message 1 under the v1 brief, even where a Botdog reference skips them.
- A future qualification condition needs pass/fail/unknown destinations and a reason. For v1, use existing Radar criteria or manual qualification; do not implement AI review from a reference label.
- Reply detection overrides all waits and branches. Stop and cancel pending sends as required by the engine brief. Thread send conditions cannot override this rule. Recheck eligibility immediately before each action.
- Validate graph destinations and supported capabilities before enabling Start. Show failures beside the affected step. A reference-only step cannot become an executable action through copying, API import or a saved template.
- Preserve wait units (hours vs days), connection-relative timing and sender working windows. B04/B07 are finite four-touch/four-cycle sequences; never convert them into unbounded recurring actions.
- If engagement actions are added later: configure latest vs random recent post, missing-post behavior, duplicate-post protection, and whether action failure skips the step or stops the enrollment. Do not claim an engagement happened in a later message unless recorded successfully.
- **Review Before Sending** is an observed Botdog badge, not a confirmed approval mechanism. Campaign must distinguish template review, draft approval and actual per-action approval if those are later implemented.

Acceptance criteria for the library development work:

1. All 13 reference names above are documented and traceable; no missing text is fabricated.
2. Sidebar exposes the captured non-AI taxonomy, search, selected filters, clear/reset and an accurate empty state; product availability reflects actual sender and engine capabilities.
3. A supported template opens an editable independent draft with the correct message count and waits. Unsupported references explain their missing capabilities and cannot start.
4. Already-connected, pending-invitation, accepted, timeout, unknown/error and reply cases take explicit paths; no duplicate invite, unaccepted-connection DM or send after reply.
5. Sample placeholders, missing fallbacks, empty required text and unsupported steps block launch. Sample customer-result claims require replacement with verified copy.
6. B03 preserves its distinct 2-hour / 1-day / 2-day cadence; B11 uses 2-hour / 1-day / 1-day. B04 and B07 terminate after four touches/cycles.
7. No-AI v1 derivatives clearly replace qualification with Radar rules and omit unsupported engagement actions; the source templates remain labeled references.

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

