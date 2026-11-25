# campaign.gershon.ai

Simple LinkedIn drip-campaign platform for Gershon Consulting. It takes prospects collected by **radar.gershon.ai** and contacts them through timed sequences (visit → invite → follow-up messages). Replaces Botdog. No AI features.

| Document | What it is |
|---|---|
| [docs/SENDING-ENGINE-V1.txt](docs/SENDING-ENGINE-V1.txt) | Current build brief and milestone acceptance criteria (November 24, 2026); takes precedence over the older specification |
| [docs/SPECIFICATION.md](docs/SPECIFICATION.md) | Full product and technical spec to build the platform |
| [research/botdog/FEATURE-INVENTORY.md](research/botdog/FEATURE-INVENTORY.md) | Every Botdog page and feature, reviewed live on 2026-11-23 |
| [research/botdog/HOW-IT-WORKS-WITHOUT-EXTENSION.md](research/botdog/HOW-IT-WORKS-WITHOUT-EXTENSION.md) | How Botdog runs LinkedIn actions from the cloud with no Chrome extension |
| [research/botdog/screenshots/](research/botdog/screenshots/) | 44 screenshots of Botdog (prospect data blurred) |

Status: see [STATUS.md](STATUS.md).

## Application

A working React/Vite operator preview is now included. Run `pnpm install`, then `pnpm dev` (Node 24). Without database configuration it opens a clearly marked, browser-local demo; it does not send LinkedIn actions.

See [implementation and setup](docs/IMPLEMENTATION.md) for what works, the Supabase migration, Cloudflare deployment configuration, and the remaining live-execution work. Build: `pnpm build`. Core checks: `pnpm test`.
