# Cloudflare VibeSDK

An open-source full-stack AI webapp generator built on Cloudflare's developer platform. Users describe what they want to build in natural language, and the AI agent creates and deploys the application.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite (rolldown-vite), TailwindCSS, React Router v7
- **Backend**: Cloudflare Workers + Durable Objects (via @cloudflare/vite-plugin in dev)
- **AI**: Google Gemini (via AI Studio), OpenAI, Anthropic — routed through Cloudflare AI Gateway
- **Database**: Cloudflare D1 (SQLite) with Drizzle ORM
- **Storage**: R2 buckets (templates), KV (sessions)
- **Containers**: Cloudflare Containers for sandboxed app previews
- **Real-time**: PartySocket WebSockets

## Project Structure

- `/src` — React frontend (components, hooks, routes, contexts)
- `/worker` — Cloudflare Worker backend (agents, API routes, DB services)
- `/shared` — Shared types between frontend and backend
- `/migrations` — D1 SQL migration files (Drizzle ORM)
- `/sdk` — TypeScript SDK for programmatic access
- `/container` — Sandbox container tooling
- `/scripts` — Setup and deploy scripts
- `/docs` — Setup and deployment guides

## Local Development Setup

### Prerequisites
- Node.js 20+
- A Google AI Studio API key (free at https://aistudio.google.com/)

### Configuration Files

- `.dev.vars` — Local environment variables read by the Cloudflare Vite plugin
- `wrangler.jsonc` — Cloudflare Workers configuration (D1, KV, R2, Durable Objects)
- `vite.config.ts` — Vite config with `@cloudflare/vite-plugin` (remoteBindings: false for local dev)

### Key `.dev.vars` Variables

| Variable | Purpose |
|---|---|
| `CUSTOM_DOMAIN` | Set to `localhost:5000` for local dev |
| `JWT_SECRET` | Session signing key (32-byte hex) |
| `WEBHOOK_SECRET` | Webhook authentication |
| `SECRETS_ENCRYPTION_KEY` | Encrypts stored user API keys |
| `GOOGLE_AI_STUDIO_API_KEY` | Required for Gemini AI models |

### Running Locally

```bash
npm install --legacy-peer-deps
node_modules/.bin/wrangler d1 migrations apply vibesdk-db --local
node_modules/.bin/vite --port 5000 --host 0.0.0.0
```

The workflow command is: `DEV_MODE=true node_modules/.bin/vite --port 5000 --host 0.0.0.0`

### Important Notes

- `remoteBindings: false` is set in `vite.config.ts` to avoid needing Cloudflare auth in dev
- `dev.enable_containers: false` is set in `wrangler.jsonc` because Docker is not available in Replit
- The `npm override` for vite was removed to fix a peer dependency conflict (`rolldown-vite` is in devDependencies)
- The package manager is npm (bun is not available in this environment)
- Local D1 database is stored in `.wrangler/state/v3/d1/`

### Authentication

The app uses email-based auth by default. On first run, register a new account via the Sign In button. OAuth (Google/GitHub) is optional and requires additional setup.

### Production Deployment

Requires a Cloudflare account with Workers Paid Plan, Workers for Platforms, and a custom domain. See `docs/setup.md` for the full guide. Deploy with:

```bash
bun run deploy  # reads from .prod.vars
```
