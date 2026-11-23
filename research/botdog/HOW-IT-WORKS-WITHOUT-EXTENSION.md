# How Botdog runs LinkedIn actions without a Chrome extension

_Research date: 2026-11-23. Sources listed at the bottom._

## Short answer

Botdog does not drive *your* browser. It **logs into LinkedIn as you from its own cloud servers** and performs the actions there:

1. **Session capture.** When you connect LinkedIn, Botdog takes either
   - your LinkedIn **email + password** (it logs in for you, then handles the 2FA / PIN checkpoint), or
   - your **`li_at` session cookie** (plus `li_a` for Sales Navigator / Recruiter). The cookie route is mandatory for SSO-protected and Recruiter accounts.
   Either way, Botdog ends up holding a valid LinkedIn session token for your account.
2. **Cloud worker per account.** That session is used by a server-side worker (headless browser and/or LinkedIn's internal "Voyager" web API — the same private JSON endpoints linkedin.com itself calls). The worker visits profiles, sends invitations, messages, InMails, reacts to posts, reads the inbox, etc.
3. **Fixed IP per account.** Each account is pinned to one outbound IP (a proxy, ideally in the user's country) so LinkedIn sees a stable "device". Botdog does not publish which proxy provider or locations it uses.
4. **Human-like pacing.** Actions are spread inside working hours (9 AM–6 PM in the campaign timezone, selected days only), with random 30 s – 5 min gaps, per-action daily caps (Safe / Moderate / Risky zones), a 2-hour+ delay after acceptance before the first message, and auto-withdrawal of invitations after 30 days.
5. **Session upkeep.** Cookies expire or get invalidated; Botdog detects it ("Credentials Valid" in the Account Health score), emails the user and can post to a Slack webhook ("Disconnection Slack alerts" in Settings → Account) so the user reconnects.

That is why the app tells you _"Your campaign runs in the cloud, so you don't need to keep your computer on"_ (Start campaign screen).

## Very likely built on Unipile

Botdog's Product Hunt page lists **Unipile** among the tools it is built with. Unipile is a hosted API that does exactly the above as a service: you POST the user's LinkedIn credentials or `li_at` cookie (+ user agent, optional proxy), it manages the session, checkpoints and proxies, and exposes REST endpoints for invitations, messages, InMails, profile data, post reactions/comments, plus webhooks for new messages and accepted invitations. Botdog's own feature list (invitation, message, InMail, voice note, profile visit, react, comment, follow-company invite, event invite, Sales Navigator / Recruiter imports, unified inbox) maps one-to-one onto Unipile's LinkedIn endpoints.

So the realistic architecture is:

```
Botdog UI ─► Botdog backend (campaigns, sequence engine, scheduler, limits)
                     │
                     ▼
        Unipile (or equivalent) — holds the LinkedIn session per account,
        dedicated proxy per account, Voyager/headless execution
                     │
                     ▼
                LinkedIn.com
```

## What this means for campaign.gershon.ai

Two ways to do the same thing:

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Use a LinkedIn execution API (Unipile or similar)** — recommended | Our backend stores only the provider `account_id`; the provider stores the session and proxy. We call `send invitation`, `send message`, etc. and receive webhooks. | Weeks instead of months; session/checkpoint/proxy handling is their problem; same approach Botdog appears to use. | Per-account monthly fee; dependency on a vendor. |
| **B. Build our own cloud workers** | Headless Chromium (Playwright) per account on a server, residential/ISP proxy per account, `li_at` cookie injected, actions via UI or Voyager calls. | No vendor fee. | Hard and fragile: 2FA/checkpoints, LinkedIn UI changes, proxy management, detection risk. |

Either way, **no Chrome extension is needed** and the user's computer can be off. Important caveat: all such tools act outside LinkedIn's User Agreement (third-party automation is not permitted), so accounts can be restricted; conservative limits and warm-up are the only mitigation.

## Sources

- SyncGTM, "Botdog Review 2026" — cloud-based, email/password or `li_at` (+`li_a`) connection, cookies expire and Botdog emails you, IP/proxy locations not disclosed, pacing 30 s–5 min, 8 AM–7 PM: https://syncgtm.com/blog/botdog-review-2026
- Botdog help: "Connect your LinkedIn account using Cookies" (Credentials vs Cookies, `li_at` / `li_a`): https://www.botdog.co/blog-posts/connect-linkedin-cookies and https://help.botdog.co/en/articles/11964637-connect-your-linkedin-account-using-cookies
- Botdog: "Safe LinkedIn automation" — cloud based, works when computer is off, human-like spacing: https://botdog.co/features/safe-linkedin-automation
- Botdog on Product Hunt (Unipile listed among its stack): https://www.producthunt.com/products/botdog-a-dripify-phantombuster-killer?page=11
- Unipile LinkedIn guide (connect via `li_at` cookie + user agent, optional proxy): https://developer.unipile.com/docs/linkedin
- Observed in the Botdog app (Settings → Account, Start campaign screen, Account Health widget) — see `screenshots/`.
