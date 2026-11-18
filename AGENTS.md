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
8. error log + PDF download history + CPF masking + retention, 9. portal session keep-alive (removed in 17),
10. dashboard backend, 11. dashboard frontend, 12. Docker + Caddy (HTTPS) + DB backup.

**Multi-user (admin / corretor) + per-user portal credentials** (agreed and completed 2026-11-18):
13. DB migration `20261118130000_profiles_and_portal_credentials` (done);
14. profiles, permissions and data isolation in the dashboard backend + API key ownership, forced change of
    admin-generated temporary passwords (migration `20261118140000`) (done);
15. dashboard screens: users, permissions, forced password change, menu by profile (done);
16. encrypted portal credentials: save/update + dashboard screen, status visible to the user and to admins (done);
17. API with one portal session per user, `PORTAL_EMAIL`/`PORTAL_SENHA` and keep-alive removed (done);
18. docs and deploy: root/dashboard/API READMEs, deploy guide with the upgrade path (done).

## 4. Decisions taken

- **Database**: PostgreSQL, shared by API and dashboard.
- **Dashboard stack**: React + Vite SPA + its own Node/TypeScript backend with Fastify, in `dashboard/`.
- **Dashboard login**: users created by CLI (`npm run usuarios`, hidden password prompt); scrypt; httpOnly cookie
  sessions stored hashed in `sessoes` (8 h idle, 7 days max); 5 wrong passwords → 15 min block; profiles below.
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
- **Profiles** (2026-11-18): `admin` / `corretor` (`usuarios.perfil`). Admins see everything (with a "Corretor"
  column/filter) and create users (admins too) in the dashboard; the CLI can create both. Corretores see only their
  own data. Screens grantable to a corretor: `downloads`, `consultas`, `chaves` (`usuarios.telas`). Errors and Users
  are admin-only; My account and Portal credentials are always available.
- **API permissions ceiling**: `usuarios.permissoes_api`; effective key permissions = key ∩ owner's ceiling, on every
  request (removing one affects existing keys at once). Every key has an owner (`api_keys.usuario_id`); a deactivated
  user's keys are rejected. Both the admin and the corretor can create a corretor's keys.
- **Portal credentials per user** (`credenciais_portal`, optional for admins): AES-256-GCM with `CREDENCIAIS_CHAVE`
  (API + dashboard), user id as AAD; password never returned. Portal rejects it → status `invalida`, no more login
  attempts until updated; shown to the user and to admins. API errors: `409 credenciais_nao_cadastradas` /
  `409 credenciais_invalidas` (not written to `logs_erro`).
- **Portal sessions**: one Chromium, one logged-in context per user with its own queue, closed after
  `SESSAO_OCIOSA_MINUTOS` (15) idle, at most `SESSOES_MAX` (5) open (the most idle is closed). Keep-alive is removed.
- **Scraper CLI** stays for debugging: `--email` argument + hidden password prompt (never a password argument).
- **Delivery destinations** stay global in `.env` (SSRF); access is controlled by `pdf:enviar`.
- ~~Portal session keep-alive~~ (stage 9): superseded by per-user sessions that expire when idle (removed in stage 17).

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
- Tables (Portuguese names, like the code): `usuarios` (dashboard users; `perfil`, `telas`, `permissoes_api`),
  `credenciais_portal` (per-user portal login, encrypted password), `api_keys` (only the SHA-256 hash of
  the key is stored, plus a visible `prefixo`; revocation = `revogada_em`), `logs_erro`, `downloads_pdf`,
  `consultas_protocolos` (GET /protocolos history: masked CPF + HMAC, never the CPF), `sessoes`.
- `api_keys.permissoes` accepts only `protocolos:listar`, `pdf:baixar`, `pdf:enviar` (CHECK constraint).
  Adding a permission requires a migration that changes the constraint.
- History rows (`downloads_pdf`, `consultas_protocolos`, `logs_erro`) carry `usuario_id` = key owner at request time.
  They keep working when a key or user is deleted (`ON DELETE SET NULL`). Users with keys cannot be deleted
  (`RESTRICT`): deactivate them. Prefer revoking keys.

## 6. Security baseline (all packages)

- `.env` files hold secrets, are git-ignored, and should be `chmod 600` on servers.
- CPF and names are personal data (LGPD). Never put real personal data in committed files, tests or docs.
  Use synthetic valid CPFs (e.g. `529.982.247-25`).
- Never print or persist credentials. Mask personal data in output and logs.
- When testing against the local database, delete **only the rows you created** (filter by your test user/key).
  The user keeps their own test data there.
- Test servers: always `HEADLESS=true` (the user's `api/.env` may say false: visible browser windows on their Mac).
- Stop background servers by process (`pkill -f "tsx ..."`) and confirm with `ps`; `kill %1` can leave them running.
