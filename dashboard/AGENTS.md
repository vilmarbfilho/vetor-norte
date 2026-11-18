# AGENTS.md (dashboard)

Context for AI coding agents (and humans) working on the **`dashboard/` package** of the `vetornorte` monorepo.
Read the root [`../AGENTS.md`](../AGENTS.md) first (working agreement, stages, decisions). All paths and
commands below are relative to `dashboard/`. User-facing docs are in [`README.md`](README.md).

---

## 1. What this package is

Admin/monitoring dashboard with login, for a small team (2 people, all administrators):
error logs, PDF download history, API key management. Shares the PostgreSQL database with the API.

- Stage 10: backend JSON API in `server/`.
- Stage 11 (awaiting user confirmation): React + Vite SPA in `web/`, served by the same Fastify server, UI in
  **en and pt** with a per-user selector (saved via `PATCH /api/auth/eu`). Default language: **en**
  (column default since migration `20261118010000`; also the login page default).

## 2. Stack and commands

| Item | Choice |
|---|---|
| Runtime | Node.js ≥ 22, ESM, TypeScript run by `tsx` (no build step for the server) |
| HTTP | Fastify 5 + `@fastify/cookie` |
| Database | postgres.js 3.x, plain SQL, no ORM |
| Frontend | React 19 + Vite 8, no UI or router library, plain CSS with tokens |
| Tests | `node:test` + `node:assert` via `tsx --test` (server and pure web modules) |

```bash
npm run dev | npm start            # backend (serves web/dist when it exists)
npm run dev:web                    # Vite dev server :5173 with /api proxy
npm run build                      # web -> web/dist (required before npm start shows the UI)
npm test            # no DB: in-memory fakes (server/tests/fakes.ts) + web/src/**/*.test.ts
npm run typecheck   # server and web; must be clean before handing work back
npm run usuarios -- criar|listar|redefinir-senha|desativar|ativar ...
```

## 3. Architecture

```
request ─► auth/guard.ts (onRequest, /api/* only)
             1. non-GET without X-Requested-With: vetornorte-dashboard → 403 csrf
             2. unless route config.publica: cookie vn_sessao → sha256 → contas.sessaoValida → req.usuario (else 401)
        ─► routes/*.ts  (JSON schema validation, business outcomes as return values)
        ─► repositories/types.ts interfaces  ─► repositories/*.ts (PostgreSQL)
errors ─► app.ts error handler (400 validation / 500 generic) + onResponse: 5xx → logs_erro (origem 'dashboard')
```

Rules:

- Routes depend only on `Repositorios` (injected into `criarApp`). Tests use `ContasFake`, `MonitoramentoFake`,
  `ChavesFake`. Never touch the DB in `npm test`.
- Every error body is `{erro, codigo}`. `erro` is Portuguese (code convention); the frontend translates by
  `codigo`. Add new codes to the frontend translations (stage 11).
- **Business outcomes are return values** (`ResultadoAlteracaoChave`: `ok` / `nao_encontrada` / `revogada`),
  mapped to 200/404/409 in the route.
- New routes are protected by default. Only mark `{ config: { publica: true } }` with a reason.
- State-changing routes must not be GET (the CSRF check only covers non-GET methods).
- Never select or return `api_keys.hash`. The full key (`segredo`) is returned only by `POST /api/chaves`,
  with `Cache-Control: no-store`.
- Login always runs scrypt (`HASH_FICTICIO` for unknown e-mails) and returns the same 401 for unknown e-mail,
  wrong password and inactive user.
- `BloqueioLogin` and nothing else is in memory; the dashboard runs as a single instance.

## 4. Frontend (`web/`)

- **No inline styles or scripts**: the CSP (`server/app.ts`) is `style-src 'self'; script-src 'self'`. Use classes
  in `styles.css`. Colors only via the tokens on `:root` (redefined for dark mode).
- **Texts**: every visible string goes through `t('key')`. Add the key to `en.ts` first; `pt.ts` is typed from it,
  so a missing translation fails `npm run typecheck`; `i18n.test.ts` also checks placeholders.
- **Errors**: show `useMensagemErro()(erro)`, which translates the backend `codigo` (`erro.<codigo>`). A new backend
  code needs `erro.<codigo>` in both dictionaries (the test lists the known codes).
- `api.ts` imports types from `server/` (type-only, erased by Vite). Never import runtime server code in `web/`.
- List pages keep filters in the URL (`useListagem`); dates are `YYYY-MM-DD` in the URL and become ISO instants of
  the user's local day only when calling the API (`consultaDaApi`).
- The server serves `web/dist` with `@fastify/static` (wildcard, so a rebuild needs no restart), `/` explicitly,
  and `index.html` for other GETs without a file extension (client routes). Missing files are real 404s.
- Visual check: a throwaway Playwright script (e.g. `api/.dev/visual-dashboard.ts`, git-ignored) that logs in with a
  test user and takes screenshots; check console errors (CSP violations show there) and horizontal overflow at 390 px.

## 5. Shared contracts with the API (keep in sync)

| What | Here | In the API |
|---|---|---|
| Key format (`vn_` + 32 bytes base64url, prefix 11 chars, SHA-256 hex) | `server/auth/api-keys.ts` | `api/src/auth/keys.ts` |
| Permissions list | `PERMISSOES` in `server/auth/api-keys.ts` | `PERMISSOES` in `api/src/auth/keys.ts` + DB CHECK |
| CPF masking | `server/utils/mask.ts` | `api/src/audit/mask.ts` |
| Tables | `usuarios`, `sessoes`, `api_keys` (write), `logs_erro` (read + write dashboard errors), `downloads_pdf` (read) | `api_keys` (read), `logs_erro`/`downloads_pdf` (write) |

Schema changes go in `../db/migrations` (new file, never edit an applied one).

## 6. Security

- Session cookie: `httpOnly; Secure; SameSite=Strict; Path=/`, `Max-Age` = absolute maximum. Idle timeout
  is enforced server-side (`sessoes.ultimo_uso_em`, refreshed at most once per minute).
- `COOKIE_SECURE=false` is for local http only; the server warns on startup.
- `trustProxy` trusts loopback and private networks (Caddy in Docker) for the client IP stored with sessions.
- The Fastify logger never logs headers (cookie). Mask CPFs in anything logged or stored.
- Password reset and deactivation delete the user's sessions (`scripts/users.ts`).
- Users CLI reads passwords from a hidden prompt; with piped stdin it reads lines (one shared readline with a
  line queue, or the second line is lost).

## 7. Testing expectations

- `npm run typecheck` clean and `npm test` green before handing work back.
- End-to-end (with the user's authorization for real data): start PostgreSQL, create a throwaway user with the
  CLI, run `curl` against `/api/*` (send the CSRF header and the cookie), and **delete only the rows you
  created** (filter by your test user/key). Never run unfiltered DELETEs: the user's own data lives there.
- Stop servers by process (`pkill -f "tsx server/server.ts"`), not with `kill %1`: that kills `npm` and can leave
  the `tsx` child running (and, for the API, writing keep-alive errors every interval).
