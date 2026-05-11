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

#### How to deploy worker changes from Replit:

**Step 1 — Download the current live frontend assets** (avoids the memory-intensive vite build):
```bash
mkdir -p dist/assets
curl -s https://app.alpen.digital/ -o dist/index.html
# Get JS/CSS filenames from index.html, then download them:
curl -s "https://app.alpen.digital/assets/<js-filename>.js" -o dist/assets/<js-filename>.js
curl -s "https://app.alpen.digital/assets/<css-filename>.css" -o dist/assets/<css-filename>.css
```

> **Tip:** Run `curl -s https://app.alpen.digital/ | grep -oP 'assets/[^"]*'` to find the current asset filenames.

**Step 2 — Deploy using the wrangler-specific tsconfig** (handles path aliases correctly):
```bash
npx wrangler deploy --tsconfig tsconfig.wrangler.json
```

> ⚠️ `wrangler.jsonc` must be temporarily patched before deploying from Replit:
> 1. In `durable_objects.bindings`, remove `"script_name": "vibesdk"` and `"remote": true` from the `UserAppSandboxService` entry
> 2. In `containers`, change `"image"` from `"./SandboxDockerfile"` to the currently-deployed registry image (visible in the deploy error output as the `-` line)
> 3. Run `npx wrangler deploy --tsconfig tsconfig.wrangler.json`
> 4. Restore both changes in `wrangler.jsonc` after a successful deploy

**Alternative — deploy from your local machine** (simpler, no patching needed):
```bash
npx vite build && npx wrangler deploy
```

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
