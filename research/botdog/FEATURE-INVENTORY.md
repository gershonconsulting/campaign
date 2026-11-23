# Botdog — complete feature inventory (app.botdog.co)

_Reviewed live on Olivier's account (Professional + AI plan) on 2026-11-23. Screenshots in `screenshots/` — prospect names and messages are blurred because this repository is public._

Legend: **[AI]** = AI feature (out of scope for campaign.gershon.ai) · **[KEEP]** = must have in our version · **[LATER]** = nice to have

## 0. Global layout
- Left icon sidebar: Home, Campaigns, Contacts, Unified Inbox, Team (settings/team), Team dashboard (analytics), Settings, "What's new" (sparkle), Book a call, Chat support, Profile.
- Top bar: page title, **Create campaign** button, **LinkedIn "Connected"** status pill, notifications bell (unread count).
- Banners: plan announcements, "New in Botdog: Team Campaigns and the MCP Server".

## 1. Home / Overview dashboard — `/dashboard` (01–04)
- Timezone + clock, New/Classic toggle, period selector (Last 7 days…), **Manage widgets**, **Customize** layout.
- KPI cards [KEEP]: invitation acceptance rate (accepted/sent), active campaigns + contacts in pipeline, response rate (responses/messages), network growth.
- **Account Health** [KEEP]: score /100 with breakdown — LinkedIn connection, credentials valid, not throttled, active subscription, invite acceptance rate, reply rate, activity consistency; restriction-risk badge; 7-day forecast; **Safe sending** gauge (e.g. "safe up to 18 inv/day, caution to 25").
- **Next best actions** (rule-based tips, e.g. "LinkedIn throttled you this week — keep volume low", link to Adjust limits) [KEEP, rule-based].
- Campaign performance bar chart per day: invitations, messages, replies, throttled [KEEP].
- Top campaigns by reply rate [KEEP]. Weekly goal ring + streak [LATER].
- Best time your audience is active (acceptance heatmap day×hour) [LATER].
- Who you're reaching: breakdown by seniority, company, location, industry, company size [LATER].
- Conversion funnel invites → accepted → replied [KEEP].
- Recent activity feed (invitation sent/accepted, message sent) [KEEP].
- Unread messages preview + Open inbox [KEEP].
- Warm leads (replies tagged "Interested") [AI tagging — replace with manual tag].

## 2. Campaigns list — `/campaigns` (10, 17, 18)
- Search, filter by status (Draft / Paused / Active / Completed), **Edit columns**.
- Columns: Name, LinkedIn Searches (source), Progress bar, Logs, Insights, Contacts, Already connected, Pending invite, Status, # Invitations sent, # Messages sent, Connection rate, Reply rate, Creation date, Start date.
- Inline rename; hover actions: pause, open.
- Row menu: Rename, Pause campaign, Pause activities, Set as priority campaign, Edit sequence, Add contacts, Duplicate, Edit start/end dates, Insights, Export campaign leads, Archive, Delete [KEEP all].
- **Logs** side panel: per-campaign activity & health [KEEP].
- **Insights** page: bottom-line summary + health grade (A–F), contacts, connection rate vs benchmark, reply rate vs benchmark, positive replies %, counts (invites, messages, InMails, profile visits, company invites, post reactions), conversion funnel, activity over time (daily/weekly), Download report (PDF) [KEEP numbers; AI sentiment = out].

## 3. Create campaign wizard (5 steps) (20–31)
1. **Import contacts** — sources: LinkedIn Search URL, LinkedIn Event attendees, Sales Navigator list/search, Recruiter, Post comments, Post reactions, **CSV upload** (max 2,000 rows, sample template, column mapping), **Import later (API / Zapier / MCP)**, LinkedIn profile URLs. Option "Skip contacts who already exist in other campaigns" (dedupe) [KEEP: Radar, CSV, profile URLs, API; LATER: SalesNav/search/post/event scrapers].
2. **Select template** — Classic: Send an invitation / Invitation + 2 messages / Message to 1st-degree connections / Explore all / Reuse a previous sequence. Library filters: Popular, Available to you, LinkedIn product, Built for, Use case, Industry, Advanced sequences (20+ e.g. Cold lead reviver, Warm-up then connect, InMail + invite fallback, Invite to follow company page), AI sequences [KEEP templates; AI = out].
3. **Edit sequence** — visual flow builder, simplified vs advanced view, zoom/fit/lock.
   - Default: Visit profile → (Not connected) Send invitation → "Is invitation accepted within 14 days" → Yes: wait 2 hours → Send message → wait 1 day → Send message…; branches for "Already connected" and "Invitation already pending".
   - **Add step** types: Profile visit, Send message, Send InMail, Send invitation, Wait, AI review [AI], Invite to follow a company page, Invite to event, React to posts, Comment on post [AI].
   - Message editor: 4,000 chars (invitation note 300 chars), emoji, attachment, **Variables** (firstName, lastName, fullName, title, currentCompany, senderFirstName/LastName/FullName) with default value syntax `{{firstName | there}}`, Show preview, **Add variation** (A/B up to 4), Create AI variable / Rewrite with AI [AI].
   - **Advanced settings → send condition**: Always send · If new conversation only · If you never received a message from the other person · If new conversation or last message is from you (default) · If new conversation or last message from other person · If last message is from other person · If last message is the previous message you sent in this campaign.
   - Pending invitations auto-withdrawn after 30 days. Save as template.
4. **Campaign type** — Regular (your account, shares your daily limits) or **Team campaign** (spread across selected teammates' accounts; each lead owned by one sender) [KEEP Regular; Team LATER].
5. **Start campaign** — name, schedule future start / end date, timezone for working hours (9 AM–6 PM), **Set as priority campaign**, profile review prompt [AI], explainer (slow randomized start, runs in cloud, weekly report). Steps cannot be added/removed after start; text and timing can be edited. Unstarted = Draft.

## 4. Contacts — `/contacts` (40)
- Table: Name, Headline, Current company, Engagement, Skip reason (e.g. Skipped), Campaign, Campaign status; search; filter by status and campaign; export; edit columns; row menu [KEEP].

## 5. Unified Inbox — `/unified-inbox` (41–43)
- Conversation list (All / Unread), search (Ctrl+K), "unread since you last checked" [AI prioritised].
- Thread view, reply box (attachments, emoji, voice, schedule send), star, mute, snooze/reminder.
- Right panel: profile, **Add to campaign**, **Blacklist**, insights (response rate, reply time, total messages), auto-tags [AI], suggested actions [AI], campaigns the lead is in.
- Filters: needs your reply, waiting on them, has scheduled message, has reminder, contains attachment, tags include/exclude, campaign, starred/muted/sponsored/archived, active date range [KEEP non-AI].
- "+ New" message. Botdog summary / Draft reply with AI [AI].

## 6. Settings (50–62)
- **Account**: email, timezone, active days (Mon–Sun), weekly digest email, daily unread digest, LinkedIn account (connected / disconnect / Sales Nav badge), disconnection Slack webhooks (×2), inbox visibility (only imported contacts vs all), share inbox with admins / team members (none / lead contacts only), **daily limits** sliders with Safe/Moderate/Risky zones — connection requests, profile visits, InMails, messages, company-page invites, post reactions — "Reset to safe limits", 2FA.
- **Profile Review** [AI]. **Notifications**: push/email per event (new message, lead replied, reminder due, scheduled message sent, account health alert).
- **Team**: seats, invite user, roles Owner / Admin (can impersonate) / Member, pending invitations.
- **My Clients**: Organizations + **Managed identities** (run campaigns for clients without them having a login; each counts as a seat) — key for an agency like Gershon.
- **Team campaigns** opt-in. **Snippets** (reusable message templates). **Blacklist** (name, company, job, location, profile, list). **Billing**. Refer users.
- **Integrations**: REST API keys, **Webhooks** (lead events: profile visited, invitation sent, invitation accepted, message sent, reply received; optional "message sent from LinkedIn"; inbox events), AI apps / MCP, Slack, Zapier.
- **Withdraw invitations**: auto-withdraw after 14 / 30 / 60 days or off; list of sent invitations with manual withdraw.

## 7. Team performance dashboard — `/team-dashboard` (70)
- Filters: organization, teammate, campaign, period; Export. KPIs with sparklines and % vs previous period: leads reached, invites sent, messages sent (incl. InMails/voice), replies, active campaigns, leads in sequence. Alert cards (stalled campaigns, top campaign, leads showing interest, trend up/down). Outreach volume stacked bars, teammate trend, conversion funnel, results.

## 8. Notifications panel (71)
- Unread / Read tabs, Mark all read, per-item lead replies.

## Test notes
- A test draft named "New campaign" (id 993b7322…) was created to walk the wizard to the Start step; it was **not started** and has 0 contacts. Nothing was sent, no live campaign was changed.
- Existing running campaigns were only viewed (no saves).
