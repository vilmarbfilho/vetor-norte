# vetornorte

Automation and monitoring for the **Broker One** portal (Rede Lojacorr), which has no public API.

The project is a monorepo with two applications that share one PostgreSQL database:

- **API** (`api/`): an HTTP API that logs in to the portal with a real browser (Playwright), keeps the
  session open, and lets integrations (n8n, WhatsApp gateways, internal tools) **list insurance protocols
  by CPF**, **download the "PDF da Proposta"** and **push that PDF to configured webhooks**.
- **Dashboard** (`dashboard/`): a web app with login where the team monitors the API (error logs, protocol
  query history, PDF download history) and manages the **API keys** used to call it.

> ⚠️ The solution handles personal data (CPF, names) protected by Brazil's **LGPD**. CPFs are masked in
> logs and in the database, history is purged automatically, and everything is served only over HTTPS in
> production. Never put real personal data in commits, tests or docs (use synthetic CPFs such as
> `529.982.247-25`).

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Features](#features)
- [Requirements](#requirements)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Database](#database)
- [API overview](#api-overview)
- [Dashboard overview](#dashboard-overview)
- [Production deployment (VPS)](#production-deployment-vps)
- [Security and LGPD](#security-and-lgpd)
- [Testing](#testing)
- [Limitations](#limitations)
- [Further documentation](#further-documentation)

---

## Architecture

```
                         internet
                            │  HTTPS (Let's Encrypt)
                            ▼
                    ┌───────────────┐
                    │     Caddy     │  :80 / :443   (only public container)
                    └───────┬───────┘
          /broker/* (prefix │ stripped)        /*
             ┌──────────────┴──────────────┐
             ▼                             ▼
     ┌──────────────┐               ┌──────────────┐
     │  api :3000   │               │dashboard:3100│  React SPA + JSON API (/api)
     │ Fastify +    │               │   Fastify    │
     │ Playwright ──┼──► Broker One │              │
     │ (Chromium)   │     portal    │              │
     └──────┬───────┘               └──────┬───────┘
            │  API keys (read), logs,      │  users, sessions, API keys (write),
            │  history (write)             │  logs and history (read)
            └──────────────┬───────────────┘
                           ▼
                  ┌─────────────────┐     ┌──────────────┐   ┌────────────────────┐
                  │ PostgreSQL 17   │◄────│ migrations   │   │ backup (pg_dump,   │
                  │ (internal only) │     │ (dbmate,     │   │ daily, keep 7)     │
                  └─────────────────┘     │  one-shot)   │   └────────────────────┘
                                          └──────────────┘
```

Public URLs (production): one domain, `vn.vlabs.com.br`.

| URL | Goes to |
|---|---|
| `https://vn.vlabs.com.br/` | Dashboard (UI + its `/api`) |
| `https://vn.vlabs.com.br/broker/...` | API (`/broker/protocolos` → `/protocolos`) |

## Repository layout

```
vetornorte/
├── api/                 Broker One automation API (Playwright + Fastify)      → api/README.md, api/AGENTS.md
├── dashboard/           Monitoring/admin dashboard (Fastify + React/Vite)     → dashboard/README.md, dashboard/AGENTS.md
├── db/migrations/       SQL migrations shared by API and dashboard (dbmate)
├── deploy/              Caddyfile, backup.sh and the VPS guide                → deploy/README.md
├── docker-compose.yml   dev: PostgreSQL + migrations; profile `producao`: + api, dashboard, caddy, backup
├── .env.example         root env for docker-compose (database, domain, CPF HMAC key, backup)
├── AGENTS.md            monorepo-wide rules, decisions and stages (for AI agents and humans)
└── CLAUDE.md            points to AGENTS.md
```

Each package is an **independent npm project**: run `npm` commands inside `api/` or `dashboard/`.

## Tech stack

| Area | Choice |
|---|---|
| Runtime | Node.js ≥ 22, ESM, TypeScript executed by `tsx` (no build step for servers) |
| HTTP | Fastify 5 (both packages) |
| Browser automation | Playwright + Chromium (API) |
| Frontend | React 19 + Vite 8, plain CSS with light/dark tokens, no UI or router library |
| Database | PostgreSQL 17, accessed with postgres.js (plain SQL, no ORM) |
| Migrations | dbmate, plain SQL files in `db/migrations/` |
| Tests | `node:test` + `node:assert` via `tsx --test` (no database, no portal needed) |
| Infra | Docker Compose, Caddy 2 (automatic HTTPS), daily `pg_dump` backup |
| Target server | Oracle Cloud VPS, **ARM64** (images are multi-arch); Colima on the macOS dev machine |

## Features

### API (`api/`)

- **Protocol listing** by CPF, fetching all result pages, with optional filters (protocol number, date
  ranges, insured person, insurer, statuses).
- **PDF download** of a protocol's "PDF da Proposta", as binary or as base64 JSON.
- **PDF delivery** to named webhook destinations configured on the server (`DESTINO_<NOME>_URL`), e.g. an
  n8n flow that forwards it to WhatsApp. Callers can only choose a name, never a URL.
- **Persistent portal session**: one login at startup (~8 s), requests queued over one browser tab,
  automatic retry with a fresh login.
- **Session keep-alive**: light navigation after an idle interval so the portal session does not expire.
- **API keys** with per-key permissions (`protocolos:listar`, `pdf:baixar`, `pdf:enviar`) and an optional
  per-key **rate limit** (global toggle).
- **Audit**: error log (5xx), PDF download history and protocol query history written to PostgreSQL
  asynchronously (a database failure never fails a request), with automatic retention.
- **CLIs**: a scraper CLI for debugging (`npm run cli`) and an API key CLI (`npm run chaves`).

### Dashboard (`dashboard/`)

- **Login** with users created from the command line (no sign-up page), all users are administrators.
- **Error logs** (API and dashboard), with filters and full details (masked).
- **Protocol queries**: every `GET /protocolos` call, searchable by **full CPF** (only its HMAC is used).
- **PDF downloads**: which protocol, when, result, size, and which API key (and who created it).
- **API keys**: create (secret shown once), edit name/permissions/limit, revoke.
- **My account**: interface language (English or Portuguese, per user, default English) and password change.

## Requirements

- **Node.js 22+**
- **Docker** with the compose plugin (on macOS: Colima or Docker Desktop)
- A **Broker One portal account** (e-mail + password) with access to the "Protocolo" screen
- ~500 MB of free RAM for the headless Chromium

## Local development

On the dev machine only PostgreSQL and the migrations run in Docker; API and dashboard run with `npm`.

```bash
# 1. Database
cp .env.example .env                 # set a URL-safe POSTGRES_PASSWORD and CPF_HMAC_CHAVE; chmod 600 .env
docker compose up -d postgres
docker compose run --rm migrations   # applies pending migrations (idempotent)

# 2. API
cd api
npm ci
npx playwright install chromium
cp .env.example .env                 # portal credentials, DATABASE_URL, CPF_HMAC_CHAVE
npm run chaves -- criar --nome "dev" --permissoes protocolos:listar,pdf:baixar
npm run dev                          # http://127.0.0.1:3000

# 3. Dashboard (another terminal)
cd dashboard
npm ci
cp .env.example .env                 # DATABASE_URL, same CPF_HMAC_CHAVE as the API
npm run usuarios -- criar --nome "Name" --email someone@example.com   # password asked at a hidden prompt
npm run build && npm start           # http://localhost:3100
# or, with hot reload: `npm run dev` (backend :3100) + `npm run dev:web` (Vite :5173, proxies /api)
```

Tips:

- Use `http://localhost` (not `127.0.0.1`) for the dashboard: browsers accept the `Secure` cookie there.
  Safari does not; set `COOKIE_SECURE=false` locally in that case.
- `HEADLESS=false` in `api/.env` opens a visible browser window, useful to watch the portal automation.
- Generate secrets with `openssl rand -hex 32` (CPF HMAC key) and `openssl rand -hex 24` (DB password).

Quick check:

```bash
curl http://127.0.0.1:3000/health
curl -H "Authorization: Bearer $CHAVE" "http://127.0.0.1:3000/protocolos?cpf=529.982.247-25"
```

## Configuration

There are three `.env` files. All are git-ignored, must never be committed, and should be `chmod 600`.
Each has a documented `.env.example` next to it.

### Root `.env` (docker-compose)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | — | Database credentials (password must be URL-safe) |
| `POSTGRES_PORT` | `5432` | Host port, bound to `127.0.0.1` only |
| `COMPOSE_PROFILES` | — | `producao` on the VPS (starts api, dashboard, caddy, backup); unset on dev |
| `DOMINIO` | `vn.vlabs.com.br` | Public domain used by Caddy |
| `CPF_HMAC_CHAVE` | — | Secret (≥ 32 chars) for CPF hashes; passed to API and dashboard. **Never change after go-live** |
| `BACKUP_HABILITADO` | `false` | Daily database backup |
| `BACKUP_HORA` / `BACKUP_MANTER` / `TZ` | `03:00` / `7` / `America/Sao_Paulo` | Backup time, files kept, timezone |

### `api/.env` (main options)

| Variable | Default | Description |
|---|---|---|
| `PORTAL_URL`, `PORTAL_EMAIL`, `PORTAL_SENHA` | — | Portal login (required) |
| `DATABASE_URL` | — | PostgreSQL URL (required) |
| `CPF_HMAC_CHAVE` | — | Same value as in the dashboard (required) |
| `HEADLESS` | `true` | `false` = visible browser |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Bind address and port |
| `PREFIXO_PUBLICO` | — | Path prefix added by the proxy (`/broker` in Docker), used in returned links |
| `RATE_LIMIT_HABILITADO` / `RATE_LIMIT_POR_MINUTO` | `true` / `60` | Per-key rate limit |
| `KEEPALIVE_HABILITADO` / `KEEPALIVE_INTERVALO_MINUTOS` | `true` / `10` | Portal session keep-alive |
| `RETENCAO_LOGS_DIAS` / `RETENCAO_DOWNLOADS_DIAS` / `RETENCAO_CONSULTAS_DIAS` | `90` / `365` / `90` | Retention (days) |
| `DESTINO_<NOME>_URL` / `_TOKEN` / `_TIMEOUT_MS` | — | PDF delivery webhook destinations |

### `dashboard/.env`

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | Same database as the API (required) |
| `CPF_HMAC_CHAVE` | — | Same value as in the API (required) |
| `HOST` / `PORT` | `127.0.0.1` / `3100` | Bind address and port |
| `COOKIE_SECURE` | `true` | Session cookie only over HTTPS |
| `SESSAO_INATIVIDADE_HORAS` / `SESSAO_DURACAO_MAXIMA_DIAS` | `8` / `7` | Session idle timeout and maximum lifetime |
| `LOGIN_MAX_TENTATIVAS` / `LOGIN_BLOQUEIO_MINUTOS` | `5` / `15` | Login brute-force protection |

In Docker, `DATABASE_URL`, `HOST`, `PORT`, `HEADLESS`, `PREFIXO_PUBLICO`, `COOKIE_SECURE` and
`CPF_HMAC_CHAVE` are set by `docker-compose.yml`, overriding the package `.env` files.

## Database

PostgreSQL 17, data in the `pgdata` Docker volume. Table and column names are in Portuguese, like the code.

| Table | Written by | Content |
|---|---|---|
| `usuarios` | dashboard (CLI) | Dashboard users: name, e-mail, scrypt password hash, active flag, language |
| `sessoes` | dashboard | Login sessions (only the SHA-256 hash of the cookie token) |
| `api_keys` | dashboard / API CLI | Keys: visible `prefixo`, SHA-256 `hash`, `permissoes`, `limite_por_minuto`, revocation |
| `logs_erro` | API, dashboard | 5xx errors (origin, route, status, masked message/details, key, request id) |
| `downloads_pdf` | API | PDF requests: protocol, kind (`binario`/`base64`/`envio`), result, size, duration, key |
| `consultas_protocolos` | API | `GET /protocolos` calls: masked CPF + HMAC, filters, result, returned protocols, key |

Common commands (repo root):

```bash
docker compose up -d postgres                          # start the database
docker compose run --rm migrations                     # apply pending migrations
docker compose run --rm migrations --wait rollback     # undo the last migration
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'   # SQL shell
```

New migration: add `db/migrations/<YYYYMMDDHHMMSS>_<name>.sql` with `-- migrate:up` and `-- migrate:down`
sections. Never edit a migration that was already applied; add a new one. Adding an API key permission
requires a migration that changes the `api_keys_permissoes_validas` constraint.

History rows survive deleted keys and users (`ON DELETE SET NULL`); prefer revoking keys over deleting them.

## API overview

Base URL: `http://127.0.0.1:3000` locally, `https://vn.vlabs.com.br/broker` in production. Every endpoint
except `/health` needs an API key in `Authorization: Bearer vn_...` or `X-API-Key: vn_...`.

| Method & path | Permission | Description |
|---|---|---|
| `GET /health` | public | Portal session status |
| `GET /protocolos?cpf=...` | `protocolos:listar` | Lists a CPF's protocols, with optional filters |
| `GET /protocolos/{protocolo}/pdf` | `pdf:baixar` | Downloads the PDF (`?formato=base64` for JSON) |
| `GET /destinos` | `pdf:enviar` | Lists configured delivery destinations (names only) |
| `POST /protocolos/{protocolo}/pdf/envios` | `pdf:enviar` | Sends the PDF to a destination (`{destino, destinatario?, mensagem?, referencia?}`) |

Typical timings against the real portal: listing ~1–2.5 s, PDF ~3 s. Requests are processed one at a time
(single browser tab), roughly 20–60 operations per minute. Full reference with filters, payloads and error
codes: [`api/README.md`](api/README.md).

## Dashboard overview

Pages: **Error logs**, **Protocol queries**, **PDF downloads**, **API keys**, **My account**.

User management (CLI only; passwords at a hidden prompt, min. 10 characters):

```bash
cd dashboard
npm run usuarios -- criar --nome "Name" --email someone@example.com
npm run usuarios -- listar
npm run usuarios -- redefinir-senha someone@example.com   # also ends that user's sessions
npm run usuarios -- desativar someone@example.com
npm run usuarios -- ativar someone@example.com
```

On the VPS: `docker compose exec dashboard npm run usuarios -- ...`. The dashboard's JSON API (`/api/...`)
is documented in [`dashboard/README.md`](dashboard/README.md).

## Production deployment (VPS)

Full guide: [`deploy/README.md`](deploy/README.md). In short:

1. DNS `A` record for the domain → VPS public IP (before starting Caddy).
2. Open ports 80/443 (Oracle Cloud security list **and** the VM's iptables).
3. Configure the three `.env` files (`chmod 600`), with `COMPOSE_PROFILES=producao` in the root one.
4. Start and create the first user:

```bash
docker compose up -d --build
docker compose ps                     # api/dashboard "healthy"
docker compose logs -f caddy          # certificate issuance
docker compose exec dashboard npm run usuarios -- criar --nome "Name" --email someone@example.com
```

Updating: `git pull && docker compose up -d --build` (rebuilds images and applies new migrations). When the
`playwright` version in `api/package-lock.json` changes, update the `FROM` tag in `api/Dockerfile`.

Backup: with `BACKUP_HABILITADO=true`, `pg_dump` runs daily into `./backups` (keeps the newest 7, mode 600).
Backups stay **only on the VPS** (no off-site copy). Manual backup: `docker compose exec backup sh /backup.sh agora`.
Restore instructions are in `deploy/README.md`.

Run a **single API instance** per portal account (one portal session).

## Security and LGPD

- **Secrets** only in `.env` files (git-ignored, `chmod 600`). Credentials are never printed or stored.
- **API keys**: `vn_` + 32 random bytes; only the SHA-256 hash is stored; the full key is shown once.
  Revocation reaches the API within ~10 s (key cache).
- **Dashboard sessions**: scrypt passwords, 256-bit token in an `httpOnly; Secure; SameSite=Strict` cookie
  (only its hash stored), idle timeout + absolute maximum, CSRF header required on state-changing requests,
  login blocked per e-mail after repeated wrong passwords, strict Content-Security-Policy.
- **CPF**: masked (`529.***.***-25`) in console logs and in every database row. The query history also
  stores an HMAC-SHA256 of the CPF (`CPF_HMAC_CHAVE`), so the dashboard can search by full CPF without the
  database or its backups revealing it. The download history stores no CPF.
- **Retention**: error logs 90 days, protocol query history 90 days, PDF download history 1 year
  (configurable), purged at startup and daily.
- **Network**: only Caddy is exposed (HTTPS, HSTS). PostgreSQL is bound to `127.0.0.1`. Caddy access logs are
  disabled on purpose because API URLs contain CPFs.
- Personal data must never appear in committed files, tests or docs. Use synthetic CPFs.

## Testing

No database, browser or portal access is needed: tests use in-memory fakes.

```bash
cd api && npm test && npm run typecheck
cd dashboard && npm test && npm run typecheck
```

End-to-end checks against the real portal and database are described in each package README. When testing
against the local database, delete only the rows you created.

## Limitations

- One logged-in browser tab per API instance: requests are serialized (queue).
- Rate limit and login brute-force counters are in memory (reset on restart; single instance).
- The scraper depends on the portal markup; a portal update may require changes in
  `api/src/scraper/portal.ts` (see "Portal knowledge" in `api/AGENTS.md`).
- Backups are not copied off the VPS.

## Further documentation

| Document | Content |
|---|---|
| [`api/README.md`](api/README.md) | API install, configuration, full endpoint reference, troubleshooting, systemd alternative |
| [`api/AGENTS.md`](api/AGENTS.md) | API architecture, portal internals, pitfalls, conventions |
| [`dashboard/README.md`](dashboard/README.md) | Dashboard install, users CLI, JSON API, security |
| [`dashboard/AGENTS.md`](dashboard/AGENTS.md) | Dashboard architecture, frontend rules, shared contracts with the API |
| [`deploy/README.md`](deploy/README.md) | VPS deployment, updating, backup and restore |
| [`AGENTS.md`](AGENTS.md) | Monorepo rules, decisions taken and project stages |
