# campaign.gershon.ai

Simple LinkedIn drip-campaign platform for Gershon Consulting. It takes prospects collected by **radar.gershon.ai** and contacts them through timed sequences (visit → invite → follow-up messages). Replaces Botdog. No AI features.

| Document | What it is |
|---|---|
| [docs/SENDING-ENGINE-V1.txt](docs/SENDING-ENGINE-V1.txt) | Current build brief and milestone acceptance criteria (November 24, 2026); takes precedence over the older specification |
| [docs/M2-ENGINE.md](docs/M2-ENGINE.md) | Normalized dry-run engine, safety rules and actual simulation evidence |
| [docs/REAL-CAMPAIGN-LISTS.md](docs/REAL-CAMPAIGN-LISTS.md) | Empty startup, real prospect lists and red/green CSV mapping |
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | Full product and technical spec to build the platform |
| [research/botdog/FEATURE-INVENTORY.md](research/botdog/FEATURE-INVENTORY.md) | Every Botdog page and feature, reviewed live on 2026-11-23 |
| [research/botdog/HOW-IT-WORKS-WITHOUT-EXTENSION.md](research/botdog/HOW-IT-WORKS-WITHOUT-EXTENSION.md) | How Botdog runs LinkedIn actions from the cloud with no Chrome extension |
| [research/botdog/screenshots/](research/botdog/screenshots/) | 44 screenshots of Botdog (prospect data blurred) |

Status: see [STATUS.md](STATUS.md).

## Application

A React/Vite campaign workspace is included. New workspaces start empty. Without database configuration, it stores your own drafts locally and never simulates delivery. Authenticated list intake supports Radar and Sales Navigator sources that refresh hourly, plus fixed CSV uploads. Live sending remains gated behind the engine acceptance milestones.

See [implementation and setup](docs/IMPLEMENTATION.md) for what works, the Supabase migration, Cloudflare deployment configuration, and the remaining live-execution work. Build: `pnpm build`. Core checks: `pnpm test`.
