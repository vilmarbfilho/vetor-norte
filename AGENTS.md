# AGENTS.md (monorepo root)

Context for AI coding agents (and humans) working on the `vetornorte` monorepo.
Each package has its own, more detailed `AGENTS.md`. Read this file first, then the one of the package you touch.

---

## 1. Layout

```
vetornorte/
├── api/          Broker One automation API (Playwright + Fastify). See api/AGENTS.md and api/README.md
├── dashboard/    Monitoring/admin dashboard: login, error logs, PDF download history, API keys. See dashboard/AGENTS.md
├── db/migrations/  SQL migrations shared by API and dashboard (dbmate)
├── deploy/      Caddyfile, backup.sh and the VPS guide (deploy/README.md)
├── docker-compose.yml   dev: PostgreSQL + migrations; profile `producao`: + api, dashboard, caddy, backup
├── .env.example  root env for docker-compose (database credentials)
├── README.md     project overview for humans (architecture, setup, config, deploy, security)
├── AGENTS.md     this file: monorepo-wide rules and roadmap
└── CLAUDE.md     points to this file
```

Ownership rule: code related to the API lives in `api/`, code related to the dashboard lives in
`dashboard/`. Only files that describe the whole project (compose file, root docs, root `.gitignore`)
live at the root. Each package is an independent npm project (run `npm` commands inside the package folder).

## 2. Working agreement with the project owner

- **Language**: talk to the user in **Brazilian Portuguese**. Code identifiers, log and API error messages
  are in Portuguese. Code comments, `README.md` and `AGENTS.md` files are in **English**. File and folder
  names are in English.
- **Sequential stages ("Etapas")**: explain the plan, deliver modular code, say exactly how to test it, and
  **do not start the next stage until the user confirms** the current one works on their machine.
- **Never infer unclear requirements**: ask the user. Suggested improvements must be explained and approved
  before being implemented.
- **Do not commit** unless asked. The user commits themselves.
- Expected usage: **2 people** use the whole solution for now. Prefer simple designs over scale.

## 3. Stages

Completed (see `api/AGENTS.md` for details): 1. site reconnaissance, 2. scraper CLI, 3. HTTP API,
4. PDF delivery, 5. move the existing project into `api/` + root docs, 6. PostgreSQL + migrations, 7. API keys (permissions, rate limit),
8. error log + PDF download history + CPF masking + retention, 9. portal session keep-alive,
10. dashboard backend, 11. dashboard frontend, 12. Docker + Caddy (HTTPS) + DB backup.

All planned stages are complete. New work starts as a new stage, agreed with the user first.

## 4. Decisions taken

- **Database**: PostgreSQL, shared by API and dashboard.
- **Dashboard stack**: React + Vite SPA + its own Node/TypeScript backend with Fastify, in `dashboard/`.
- **Dashboard login**: users created by CLI (`npm run usuarios`, hidden password prompt); scrypt; httpOnly cookie
  sessions stored hashed in `sessoes` (8 h idle, 7 days max); 5 wrong passwords → 15 min block; all users are admins.
- **Dashboard language**: en and pt, chosen per user in the UI (`usuarios.idioma`, default **en**).
- **Own password change** in the dashboard (requires current password, ends other sessions); min. 10 characters.
- **DB access library**: postgres.js (plain SQL, no ORM), in both packages.
- **Migrations**: plain SQL in `db/migrations/`, applied by the one-shot `migrations` compose service (dbmate).
- **Logs/history**: the API writes directly to PostgreSQL, asynchronously; a DB failure never fails the request.
- **Reverse proxy**: Caddy with automatic HTTPS in the VPS compose file.
- **Retention defaults**: 90 days for error logs, 1 year for PDF download history (configurable).
- **Local Docker**: Colima on the dev machine (macOS); the VPS (Oracle Cloud, **ARM64**) already has Docker.
- **Public URLs**: one domain, `vn.vlabs.com.br`: dashboard at `/`, API at `/broker/...` (Caddy strips the prefix).
- **Compose profiles**: dev machine runs only postgres + migrations; the VPS sets `COMPOSE_PROFILES=producao`.
- **Backup**: daily `pg_dump` into `./backups` on the VPS, keep 7, `BACKUP_HABILITADO` toggle. No off-site copy (user's choice).
- **API keys**: stored hashed, can be created, managed and revoked from the dashboard.
- **Per-key permissions** (e.g. a key that can list protocols but not download PDFs).
- **Rate limit per API key**, with an env flag to enable/disable it.
- **LGPD**: CPF masked in logs, automatic retention (old records purged).
- **Protocol query history** (2026-11-18): every GET /protocolos; CPF stored masked + HMAC (`CPF_HMAC_CHAVE`, same in
  API and dashboard) for search by full CPF; filters, result, count + protocol numbers; retention 90 days
  (`RETENCAO_CONSULTAS_DIAS`); own dashboard page. 401/403/429 are deliberately not logged (user's decision).
- **Automatic database backup**, with an env toggle.
- **Portal session keep-alive** (periodic light navigation), with an env toggle.

## 5. Database

```bash
cp .env.example .env               # set a URL-safe POSTGRES_PASSWORD; chmod 600 .env
docker compose up -d postgres      # PostgreSQL 17, data in the `pgdata` volume, port 127.0.0.1:5432
docker compose run --rm migrations # apply pending migrations (idempotent)
docker compose run --rm migrations --wait rollback   # undo the last migration
docker compose exec postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'   # SQL shell
```

- New migration: add `db/migrations/<YYYYMMDDHHMMSS>_<name>.sql` with `-- migrate:up` and `-- migrate:down`
  sections. Never edit a migration that has already been applied anywhere; add a new one.
- Tables (Portuguese names, like the code): `usuarios` (dashboard users), `api_keys` (only the SHA-256 hash of
  the key is stored, plus a visible `prefixo`; revocation = `revogada_em`), `logs_erro`, `downloads_pdf`,
  `consultas_protocolos` (GET /protocolos history: masked CPF + HMAC, never the CPF), `sessoes`.
- `api_keys.permissoes` accepts only `protocolos:listar`, `pdf:baixar`, `pdf:enviar` (CHECK constraint).
  Adding a permission requires a migration that changes the constraint.
- History rows keep working when a key or user is deleted (`ON DELETE SET NULL`). Prefer revoking keys.

## 6. Security baseline (all packages)

- `.env` files hold secrets, are git-ignored, and should be `chmod 600` on servers.
- CPF and names are personal data (LGPD). Never put real personal data in committed files, tests or docs.
  Use synthetic valid CPFs (e.g. `529.982.247-25`).
- Never print or persist credentials. Mask personal data in output and logs.
- When testing against the local database, delete **only the rows you created** (filter by your test user/key).
  The user keeps their own test data there.
- Test servers: always `HEADLESS=true` (the user's `api/.env` may say false: visible browser windows on their Mac).
- Stop background servers by process (`pkill -f "tsx ..."`) and confirm with `ps`; `kill %1` can leave them running.
