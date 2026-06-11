# Deployment

The Qi Men Superpowers backend is **not** static or serverless — it is a
long-lived Node.js process that spawns `bash` to run the vendored qmenpowers
engine (`engine/tools/bin/*.sh`) and writes per-request temp files. It therefore
needs a **container or VM host** that provides:

- Node.js ≥ 18
- a `bash` shell (the Debian-based `node:20-slim` image already has it)
- a writable temp directory and the ability to spawn subprocesses
- a UTF-8 locale (`LANG=C.UTF-8`) for the engine's Chinese text parsing

> ❌ It cannot run on static hosts (here.now static, GitHub Pages, Netlify/Vercel
> static) or on pure edge/serverless function runtimes (Cloudflare Workers,
> Deno Deploy, or BaaS platforms like InsForge) — none of those can spawn `bash`.
>
> ✅ It runs anywhere that runs the Docker image: Render, Railway, Fly.io,
> Google Cloud Run, AWS App Runner / ECS, a Droplet/EC2 VPS, etc.

A single container serves **everything** — the JSON API *and* the `web/`
frontend — on one origin, so no CORS or separate frontend deploy is required.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Port to listen on. Most hosts inject their own `PORT`; the server honours it. |
| `CORS_ALLOW_ORIGIN` | `*` | Only needed if the `web/` frontend is hosted on a **different** origin (e.g. published to here.now). Set to that exact origin. Leave default for single-container deploys. |
| `ASTROLOGY_API_KEY` | _(unset)_ | Optional Astrology-API.io precision mode. App works fully without it. |
| `ASTROLOGY_API_URL` | _(see .env.example)_ | Override the Astrology-API.io endpoint path. |

## Local / VPS (Docker)

```bash
docker build -t qi-men-superpowers .
docker run -d -p 8787:8787 --restart unless-stopped qi-men-superpowers
# → http://<host>:8787
```

Or with compose:

```bash
docker compose up --build -d
```

## Render (Docker)

1. New → **Web Service** → connect this repo.
2. Runtime: **Docker** (Render auto-detects the `Dockerfile`).
3. Render sets `PORT` automatically; the server binds to it. No start command needed.
4. (Optional) add `ASTROLOGY_API_KEY` under Environment.
5. Deploy. Your app is at `https://<service>.onrender.com`.

## Railway (Docker)

1. New Project → **Deploy from GitHub repo** → select this repo.
2. Railway detects the `Dockerfile` and builds it.
3. Add a public domain under **Settings → Networking**; Railway injects `PORT`.
4. Deploy. App is at the generated `*.up.railway.app` URL.

## Fly.io (Docker)

```bash
fly launch --no-deploy        # detects the Dockerfile; creates fly.toml
# ensure fly.toml has:  [http_service] internal_port = 8787
fly deploy
```

## Hostinger KVM VPS (Docker + HTTPS)

A Hostinger **VPS** (root SSH, Docker, bash) runs the whole app — API, frontend,
and the OpenAI/InsForge calls. (Hostinger's *shared*/PHP plans cannot: they
can't keep a Node process alive or spawn `bash`.)

**1 · Point your domain at the VPS.** In Hostinger → Domains → DNS, add an `A`
record for `@` (and `www`) to the VPS IP.

**2 · SSH in and install Docker.**
```bash
ssh root@<vps-ip>
curl -fsSL https://get.docker.com | sh
```
(Hostinger also offers a one-click Docker VPS template; either is fine.)

**3 · Get the code and create an env file.**
```bash
git clone <your-repo-url> qms && cd qms
cp .env.example .env          # then edit .env — see the chat/RAG block below
```
Minimum `.env` for the chat + knowledge base:
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=<rotated OpenAI key>
OPENAI_MODEL=gpt-4o-mini
EMBEDDINGS_PROVIDER=openai
VECTOR_STORE=insforge
INSFORGE_BASE_URL=https://<project>.us-east.insforge.app
INSFORGE_API_KEY=<rotated InsForge key>
INSFORGE_BUCKET=qms-knowledge
```

**4 · Run it.** Compose reads `.env` automatically:
```bash
docker compose up --build -d
docker compose logs -f        # look for: Knowledge base: N chunks loaded from insforge
```
The app is now on `http://<vps-ip>:8787`.

**5 · HTTPS on your domain (Caddy auto-TLS).** Simplest reverse proxy — one file,
automatic Let's Encrypt certs:
```bash
# /root/qms/Caddyfile
yourdomain.com {
    reverse_proxy localhost:8787
}
```
```bash
docker run -d --name caddy --restart unless-stopped --network host \
  -v /root/qms/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data caddy:2
```
Your app is live at `https://yourdomain.com`. (Open ports 80/443 in Hostinger's
firewall; you can stop exposing 8787 publicly once Caddy is in front.)

**6 · Load the knowledge base.** Run ingest **on your own machine**, where your
Obsidian vault lives — it embeds the notes and uploads the index to InsForge,
which the VPS then reads. No need to copy the vault to the server:
```bash
cd server
LLM_PROVIDER=openai OPENAI_API_KEY=… EMBEDDINGS_PROVIDER=openai \
VECTOR_STORE=insforge INSFORGE_BASE_URL=https://<project>.us-east.insforge.app \
INSFORGE_API_KEY=… INSFORGE_BUCKET=qms-knowledge \
npm run insforge:check && npm run ingest -- /path/to/your/vault
```
Restart the VPS container afterward (`docker compose restart`) so it reloads the
updated index, or just redeploy.

**Updating later:** `git pull && docker compose up --build -d`.

## Without Docker (any Node VM)

```bash
LANG=C.UTF-8 NODE_ENV=production node server/src/index.js
```

No `npm install` is required — the server has zero runtime dependencies.

## Pairing with a separate static frontend (e.g. here.now)

If you instead want the `web/` files served by a static host and only the API
on a container host:

1. Deploy this backend to a container host (above) and note its URL, e.g.
   `https://qms.onrender.com`.
2. Run the backend with `CORS_ALLOW_ORIGIN=https://<your-static-origin>`.
3. In `web/config.js`, set `const API_BASE = 'https://qms.onrender.com';`
   (or append `?api=https://qms.onrender.com` to the page URL for testing).
4. Publish `web/` to the static host.

The single-container deploy is simpler and is recommended unless you have a
specific reason to split them.
