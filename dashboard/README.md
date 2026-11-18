# vetornorte — Dashboard

Monitoring and administration dashboard for the Broker Protocol API (`../api`). It has a login system,
and lets the team:

- view **error logs** recorded by the API (and by the dashboard itself);
- view the **protocol query history**: every protocol listing made to the API (masked CPF, filters, which
  protocols were returned, which key); searchable by full CPF;
- view the **PDF download history**: which protocol, when, the result, and which API key (and the user who
  created that key) made the request;
- **create, edit and revoke API keys** used to call the API.

It reads and writes the same PostgreSQL database as the API (root `docker-compose.yml`).

The interface is a React app (English and Portuguese, chosen per user) served by the same Fastify server
as its JSON API.

---

## Requirements

- Node.js 22+
- PostgreSQL with the monorepo migrations applied (`docker compose run --rm migrations` at the repo root)

## Installation

```bash
cd dashboard
npm ci
cp .env.example .env      # set DATABASE_URL (same database as the API); chmod 600 .env
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL URL, e.g. `postgres://vetornorte:<password>@127.0.0.1:5432/vetornorte` |
| `CPF_HMAC_CHAVE` | yes | — | Same value as in `api/.env`: lets the CPF filter of the query history find the API's hashes |
| `PORT` | no | `3100` | HTTP port |
| `HOST` | no | `127.0.0.1` | Bind address (in production only Caddy reaches it) |
| `COOKIE_SECURE` | no | `true` | Session cookie only over HTTPS. `false` only for local http on browsers that need it (Safari) |
| `SESSAO_INATIVIDADE_HORAS` | no | `8` | A session unused for this long expires |
| `SESSAO_DURACAO_MAXIMA_DIAS` | no | `7` | A session never lasts longer than this |
| `LOGIN_MAX_TENTATIVAS` | no | `5` | Wrong passwords (per e-mail) before blocking login |
| `LOGIN_BLOQUEIO_MINUTOS` | no | `15` | How long login stays blocked |

## Building and running the interface

```bash
npm run build      # compiles web/ (React + Vite) into web/dist
npm start          # serves the app at http://localhost:3100 and the API at /api
```

Development with hot reload (two terminals):

```bash
npm run dev        # backend on :3100 (restarts on changes)
npm run dev:web    # Vite on http://localhost:5173, proxies /api to :3100
```

Use `localhost` (not `127.0.0.1`) in the browser: browsers accept the `Secure` session cookie on
`http://localhost`. Safari does not; use `COOKIE_SECURE=false` locally there.

Pages: **Error logs** (filters, click a row for details/stack), **Protocol queries** (the CPF filter is kept
only in memory, never in the address bar; protocol numbers link to their PDF downloads), **PDF downloads** (which key and who created it),
**API keys** (create, edit, revoke; links to that key's downloads/errors), **My account** (language, change
password). The language selector is in the side bar and on the login page; after login the account's saved
language wins. New users start in English.

## Users

There is no sign-up page. Users are managed from the command line; passwords are typed at a hidden
prompt (never passed as arguments, so they don't land in the shell history).

```bash
npm run usuarios -- criar --nome "Name" --email someone@example.com
npm run usuarios -- listar
npm run usuarios -- redefinir-senha someone@example.com   # also ends that user's open sessions
npm run usuarios -- desativar someone@example.com         # blocks login and ends open sessions
npm run usuarios -- ativar someone@example.com
```

On the VPS (Docker): `docker compose exec dashboard npm run usuarios -- criar ...` (see `../deploy/README.md`).
Passwords need at least 10 characters. All users are administrators (full access).
Users can change their own password in **My account** (requires the current password; ends their other sessions).

## Running

```bash
npm run dev     # watch mode
npm start
```

## HTTP API

Base URL: `http://127.0.0.1:3100/api`. Every response error has `{ "erro": "<pt message>", "codigo": "<code>" }`;
the frontend translates `codigo`.

**Authentication**: `POST /api/auth/login` sets an `httpOnly` session cookie (`vn_sessao`). Every
state-changing request (POST/PATCH) must send the header `X-Requested-With: vetornorte-dashboard` (CSRF
protection), or it gets `403 {codigo: "csrf"}`.

| Method & path | Description |
|---|---|
| `GET /api/health` | Public. `{ok: true}` |
| `POST /api/auth/login` | Public. Body `{email, senha}` → `{usuario}` + cookie. `401 credenciais_invalidas`, `429 login_bloqueado` |
| `POST /api/auth/logout` | Ends the session (204) |
| `GET /api/auth/eu` | Current user `{usuario: {id, nome, email, idioma}}` |
| `PATCH /api/auth/eu` | Body `{idioma: "pt" \| "en"}`: saves the user's interface language |
| `POST /api/auth/eu/senha` | Body `{senhaAtual, novaSenha}` → 204; ends the user's other sessions. `400 senha_atual_incorreta \| senha_curta \| senha_igual`, `429 login_bloqueado` |
| `GET /api/logs` | Error logs, newest first. Query: `de`, `ate` (ISO date-time), `origem` (`api`/`dashboard`), `status`, `busca` (text), `apiKeyId`, `pagina`, `porPagina` (≤ 200) |
| `GET /api/logs/:id` | One log, with `detalhes` (stack, masked URL...) |
| `GET /api/consultas` | Protocol query history. Query: `de`, `ate`, `cpf` (full; only its HMAC is used), `protocolo` (calls that returned it), `resultado` (`ok`/`erro`), `apiKeyId`, `pagina`, `porPagina` |
| `GET /api/downloads` | PDF history. Query: `de`, `ate`, `protocolo`, `tipo` (`binario`/`base64`/`envio`), `resultado` (`ok`/`nao_encontrado`/`sem_pdf`/`erro`), `apiKeyId`, `pagina`, `porPagina` |
| `GET /api/chaves` | `{chaves, permissoesDisponiveis}` (never the secret nor its hash) |
| `POST /api/chaves` | Body `{nome, permissoes[], limitePorMinuto?}` → `201 {chave, segredo}`. **`segredo` (the full key) is shown only here, once** |
| `PATCH /api/chaves/:id` | Body with any of `nome`, `permissoes`, `limitePorMinuto` (`null` = API default). `409 chave_revogada` |
| `POST /api/chaves/:id/revogar` | Revokes the key (cannot be undone). `409` if already revoked |

Lists return `{itens, total, pagina, porPagina}`. The API caches keys for 10 s, so edits and revocations
reach the API within ~10 s.

## Security

- Passwords: scrypt (N=2^15, r=8), random salt. Unknown e-mails take the same time as wrong passwords.
- Sessions: 256-bit random token in an `httpOnly; Secure; SameSite=Strict` cookie; only its SHA-256 hash is
  stored (`sessoes` table). Idle timeout + absolute maximum; logout deletes the row immediately.
- CSRF: `SameSite=Strict` + required custom header (needs a CORS preflight that this server never accepts).
- Login brute force: blocked per e-mail after `LOGIN_MAX_TENTATIVAS` wrong passwords (in memory).
- Logs: the session cookie is never logged; CPFs are masked (`529.***.***-25`).
- HTTP headers: strict Content-Security-Policy (same origin only, no inline scripts or styles, no framing),
  `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`; `/api` responses are `no-store`.
- The new API key secret lives only in the browser's memory while its dialog is open.
- Served only over HTTPS in production (Caddy; `COOKIE_SECURE` is forced to `true` by the compose file).

## Testing

```bash
npm test          # server unit + HTTP tests (in-memory repositories) and web unit tests (i18n, formatting)
npm run typecheck # server and web
```

## Project layout

```
server/
├── server.ts                 # entry point: DB, repositories, HTTP server, daily session purge
├── app.ts                    # Fastify app: cookie plugin, guards, error handler, error log, routes
├── auth/guard.ts             # CSRF header check + session cookie validation (req.usuario)
├── auth/passwords.ts         # scrypt hash/verify
├── auth/tokens.ts            # session token generation/hash, cookie name
├── auth/login-throttle.ts    # brute-force block per e-mail
├── auth/api-keys.ts          # API key generation (same format as api/src/auth/keys.ts)
├── routes/auth.ts            # login, logout, /eu, language preference
├── routes/monitoring.ts      # /logs, /downloads
├── routes/keys.ts            # /chaves
├── repositories/types.ts     # data contracts used by routes
├── repositories/*.ts         # PostgreSQL implementations
├── scripts/users.ts          # user management CLI
├── config/{load,env}.ts      # .env loading and validation
├── db/client.ts              # postgres.js connection
├── utils/mask.ts             # CPF masking (same rule as the API)
├── utils/cpf-hash.ts         # CPF HMAC (same as api/src/audit/cpf-hash.ts)
└── tests/fakes.ts            # in-memory repositories for tests
web/
├── index.html, vite.config.ts, tsconfig.json
└── src/
    ├── main.tsx, App.tsx     # providers, session check, page switch
    ├── api.ts                # fetch wrapper (cookie, CSRF header, typed errors); types shared with server/
    ├── router.tsx            # minimal History API router + <Link>
    ├── format.ts             # dates, sizes, durations, date filters -> ISO
    ├── i18n/                 # en.ts (default), pt.ts, translate.ts, React provider
    ├── components/           # Layout (side bar), ui.tsx (Modal, Paginacao, Selo, Alerta...)
    ├── pages/                # Login, Logs, Queries, Downloads, Keys, Account, useListagem (filters in the URL)
    └── styles.css            # color tokens (light/dark), responsive layout
```

For architecture and contribution rules, see [`AGENTS.md`](AGENTS.md).
