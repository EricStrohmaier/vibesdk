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

## ⚠️ Important: worker code changes need a deploy

**If you edit anything under `worker/`** — the API, agents, Durable Objects, sandbox logic, etc. — **those changes will NOT take effect in this Replit environment until you deploy to Cloudflare:**

```bash
npx wrangler deploy
```

Only files under `src/` (the React frontend) hot-reload instantly without a deploy.

| Path | Hot-reload in Replit? | Needs `wrangler deploy`? |
|---|---|---|
| `src/**` | ✅ Yes | No |
| `worker/**` | ❌ No | ✅ Yes |
| `wrangler.jsonc` | ❌ No | ✅ Yes |
| `shared/**` | Partial (types only) | ✅ Yes for logic |

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
