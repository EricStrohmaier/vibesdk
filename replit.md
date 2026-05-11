# VibeSDK — Replit Dev Environment

## How this dev setup works

The Replit environment runs **only the frontend** (Vite + React with hot-reload). All backend/API calls are proxied to the live deployed Cloudflare Worker at `https://app.alpen.digital`.

```
Browser (Replit preview)
  └── Vite dev server :5000
        └── /api/* proxy ──► https://app.alpen.digital  (live CF Worker)
                                    ├── D1 database
                                    ├── KV / R2
                                    ├── CodeGeneratorAgent DO
                                    └── UserAppSandboxService DO (Containers)
```

This is intentional — Cloudflare Containers (the sandbox preview feature) cannot run locally; they require real Cloudflare infrastructure.

---

## ⚠️ Two types of changes — know which deploy you need

### 1. Frontend changes (`src/**`)
Changes to React components, pages, styles, or any file under `src/` hot-reload **instantly** in the Replit preview. No deploy needed.

### 2. Agent / Worker changes (`worker/**`) — MUST be deployed to go live

**Any edit to files under `worker/`** — including agent prompts, API routes, Durable Objects, or worker logic — **will NOT take effect anywhere until you deploy to Cloudflare.** The live site at `app.alpen.digital` continues running the old code until you deploy.

#### How to deploy worker changes:

**Step 1 — Build the frontend** (required because the worker serves the frontend as static assets):
```bash
npx vite build
```

**Step 2 — Deploy the worker + built assets to Cloudflare:**
```bash
npx wrangler deploy
```

> ⚠️ **Note for Replit:** The `npx vite build` step is memory-intensive and may time out in Replit's environment. If it fails, run the deploy from your **local machine** in the project directory instead:
> ```bash
> npx vite build && npx wrangler deploy
> ```

#### Common agent/worker files that need a deploy after editing:

| File | What it affects |
|---|---|
| `worker/agents/prompts.ts` | Core agent prompt utilities |
| `worker/agents/operations/prompts/agenticBuilderPrompts.ts` | Coding agent system prompt |
| `worker/agents/operations/prompts/deepDebuggerPrompts.ts` | Debugger agent system prompt |
| `worker/agents/core/codingAgent.ts` | Agent orchestration logic |
| `worker/api/**` | API routes |
| `worker/index.ts` | Worker entry point |
| `wrangler.jsonc` | Cloudflare infrastructure config |

#### Full path reference:

| Path | Hot-reload in Replit? | Needs deploy? |
|---|---|---|
| `src/**` | ✅ Yes | No |
| `worker/**` | ❌ No | ✅ Yes — `npx vite build && npx wrangler deploy` |
| `wrangler.jsonc` | ❌ No | ✅ Yes |
| `shared/**` | Partial (types only) | ✅ Yes for logic |

---

## Starting the dev server

The workflow `Start application` runs `dev-start.sh` which:
1. Starts a TCP proxy on port 9229 → 5000 (Replit's port mapping)
2. Starts Vite on port 5000 with `/api/*` proxied to `app.alpen.digital`

## Proxy configuration

`vite.config.ts` — the proxy target is `const LIVE_BACKEND = 'https://app.alpen.digital'`. Change this constant if the production domain changes.

The proxy also:
- Rewrites `Set-Cookie` domain so auth cookies work on the Replit dev domain
- Overrides the `Origin` header so the CF worker's CORS check passes

## Auth & database

The dev environment shares the **live production database and user accounts** with `app.alpen.digital`. Log in with the same credentials you use on the live site.

## User preferences

- `npm install` must use `--ignore-scripts` (husky fails in Replit's environment)
