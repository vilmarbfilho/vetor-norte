# AGENTS.md

Context for AI coding agents (and humans) working on the **`api/` package** of the `vetornorte` monorepo.
Read this and the root [`../AGENTS.md`](../AGENTS.md) before changing anything.
All paths and commands below are relative to `api/`. User-facing docs are in [`README.md`](README.md).

---

## 1. What this project is

A local HTTP API that automates the **Broker One** portal (`brokerone.com.br`, reached through the
Rede Lojacorr access portal). The portal has **no public API**, so everything is done by driving a
real Chromium browser with **Playwright**.

Endpoints (see README for the full contract):

- `GET /protocolos?cpf=...&<filters>` — all insurance protocols of a CPF, filtered in memory.
- `GET /protocolos/{protocolo}/pdf[?formato=base64]` — the protocol's "PDF da Proposta" (binary or JSON).
- `GET /destinos` / `POST /protocolos/{protocolo}/pdf/envios` — push the PDF to a configured destination.
- `GET /health` — number of open portal sessions.

## 2. Working agreement with the project owner

- **Language**: talk to the user in **Brazilian Portuguese**. Code identifiers, log messages and
  API error messages are in Portuguese. **Code comments**, `README.md` and `AGENTS.md` are in **English**.
- **Step-by-step methodology**: work is done in sequential stages ("Etapas"). Explain the plan,
  deliver modular code, say exactly how to test it, and **do not start the next stage until the user
  confirms** the current one works on their machine.
- Completed stages:
  1. Site reconnaissance (Playwright codegen) — `recordings/` (git-ignored).
  2. Standalone scraper CLI — `src/scripts/cli.ts`.
  3. HTTP API with persistent session — `src/server.ts`, `src/api`, `src/services`, `src/scraper/session.ts`.
  4. Generic PDF delivery (base64 format + pluggable destinations) — `src/delivery`, `src/services/documents.ts`
  5. Monorepo reorganization — the project moved into `api/`.
  6. PostgreSQL + migrations (root `docker-compose.yml`, `../db/migrations`).
  7. API key authentication, per-key permissions, rate limit — `src/auth`, `src/scripts/keys.ts`.
  8. Error log + PDF download history in PostgreSQL, CPF masking, retention — `src/audit`.
  9. Portal session keep-alive (removed in stage 17).
  (Stages 10–16: dashboard, Docker, profiles and portal credentials; see the root `AGENTS.md`.)
  17. One portal session per user with the user's own encrypted credentials — `src/scraper/sessions.ts`,
      `src/credentials`. Stage 18: docs and deploy.
- **Do not commit** unless asked. The user commits themselves.
- When the user authorizes it, you may run against the real portal (CLI: `--email` + hidden prompt, typed by the user).
  Prefer `HEADLESS=true`. Never print or persist credentials, and mask personal data in output.

## 3. Stack and commands

| Item | Choice |
|---|---|
| Runtime | Node.js ≥ 22 (dev machine: Node 26), ESM (`"type": "module"`) |
| Language | TypeScript 7, executed directly by `tsx` (no build step). `tsc` is only used for type checking |
| Browser automation | Playwright (Chromium) |
| HTTP | Fastify 5 (JSON-schema validation via Ajv) |
| Database | PostgreSQL via `postgres` (postgres.js 3.x, plain SQL tagged templates, no ORM) |
| Tests | `node:test` + `node:assert`, run through `tsx --test` |

```bash
npm run dev        # API in watch mode
npm start          # API
npm test           # unit + HTTP tests (fake service, no browser)
npm run typecheck  # tsc --noEmit — must be clean before handing work back
npm run cli -- --email <e-mail> <cpf> [protocolo] | --protocolo <n>   # scraper CLI (no DB; hidden password prompt)
npm run chaves -- criar --usuario <e-mail> ...|listar|revogar   # API key CLI (needs DATABASE_URL)
# `npm run etapa2 -- ...` is kept as an alias of `npm run cli -- ...`
```

Imports between local files use explicit `.ts` extensions (`allowImportingTsExtensions`).

## 4. Architecture

```
HTTP request
   │
   ▼
src/auth/hook.ts          onRequest: key from Authorization/X-API-Key → SHA-256 → RepositorioChaves
   │                      (401 / 503), route `config.permissao` (403), rate limit (429). Sets req.chaveApi.
   ▼
src/api/app.ts            Fastify routes. Validation (JSON schema + CPF check-digit), maps
   │                      ResultadoPdf → 200/404, unknown errors → 502. Hides internal fields.
   ▼
src/services/protocols.ts    ServicoProtocolos interface + ServicoProtocolosBroker (real impl).
   │                         listarPorCpf = buscarProtocolos(documento) + aplicarFiltros (filters.ts)
   │                         obterPdf     = buscarProtocolos(protocolo) + baixarPdfProposta
   ▼
src/scraper/sessions.ts   GerenciadorSessoes: one SessaoBroker per user (key owner), credentials from the DB,
   │                      status valida/invalida, idle close, SESSOES_MAX. ErroCredenciais → 409.
   ▼
src/scraper/session.ts    SessaoBroker: one user's context (shared Chromium) + one logged-in Broker tab.
   │                      executar(op) runs ops in a FIFO queue (one at a time);
   │                      on any error: discard context, re-login, retry ONCE (never on ErroLoginRecusado).
   ▼
src/scraper/portal.ts     Everything portal-specific: login, abrirBroker, overlay handlers,
                          buscarProtocolos (URL building + pagination), extrairTabela (DOM parsing),
                          baixarPdfProposta. Change this file when the portal changes.
```

Delivery (stage 4):

```
POST /protocolos/:n/pdf/envios
   → services/documents.ts enviarPdf: check destino exists (before the browser)
     → servico.obterPdf (inside the session queue)
     → destino.enviar(Documento, PedidoEnvio)   (OUTSIDE the queue)
src/delivery/types.ts     Destino interface, Documento, ErroEntrega (→ 502), arquivoEmJson
src/delivery/webhook.ts   DestinoWebhook: POST JSON {evento, protocolo, destinatario, mensagem, referencia, arquivo{base64}}
src/delivery/registry.ts  destinosDoAmbiente(env): DESTINO_<NOME>_URL/_TOKEN/_TIMEOUT_MS → Map<nome, Destino>
```

- To add a channel (e.g. native WhatsApp Cloud API, e-mail, S3): implement `Destino`, throw
  `ErroEntrega` on failure, and register it in `registry.ts`. Routes and services stay untouched.
- Destination URLs come **only from server config**, never from the request (no auth → SSRF/open relay risk).
- Delivery must stay outside `SessaoBroker.executar`: a failing receiver must not trigger a portal re-login.

Authentication (stage 7):

- Routes declare access in Fastify `config`: `{ permissao: 'pdf:baixar' }` or `{ publica: true }` (only `/health`).
  A new route without `permissao` only requires a valid key: **always declare one**.
- Permissions live in `PERMISSOES` (`src/auth/keys.ts`) and in the DB CHECK constraint. Change both together.
- `criarApp` requires `autenticacao` (there is no unauthenticated mode). Tests use `RepositorioChavesFake`
  (`src/tests/auth-fakes.ts`); route tests send `CHAVE_TOTAL`.
- `RepositorioChavesPg` caches lookups (found and not found) for 10 s, so revocation takes up to 10 s.
- Every key has an owner (`api_keys.usuario_id`, stage 14). The lookup joins `usuarios`: a deactivated owner → 401,
  and `ChaveApi.permissoes` is already the **effective** set (key ∩ owner's `permissoes_api`; admins unlimited).
  `ChaveApi.usuarioId` goes to every history/error row (`usuarioId` in `RegistroErro/Download/Consulta`).
  `ultimo_uso_em` is written at most once a minute per key, fire-and-forget.
- DB failure during key lookup → `503` (fail closed). It is handled in the hook, not thrown, so it never
  reaches the 502 "portal" error handler.
- `src/config/load.ts` loads `.env` and `obrigatoria()`; `env.ts` builds the server config. The key CLI
  imports only `load.ts`; `DATABASE_URL` and `CREDENCIAIS_CHAVE` are required by the server only.
- Never log API keys. Fastify's default request log does not include headers; keep it that way.

Error log and download history (stage 8):

- `criarApp` requires `auditoria: Auditoria` (`AuditoriaPg` in production, `AuditoriaFake` in tests).
- Error log = `onResponse` hook for status >= 500. The error object comes from `req.erroCapturado`, set by the
  error handler and by the auth hook (503). `rota` is the route template (`req.routeOptions.url`), never the
  raw URL. The raw URL goes to `detalhes.url`, masked.
- Download history = `historicoPdf(req, tipo, destino)` in the PDF routes: one row per request that reached the
  handler (`ok` / `nao_encontrado` / `sem_pdf` / `erro`). `destino_desconhecido` and 400s are not history.
- **Everything written to the DB goes through `textoSeguro`/`mascararCpf`** (inside `AuditoriaPg`), and the
  Fastify logger uses `serializadoresLog` (masked URL and errors, no headers). New log fields with free text
  must be masked too. `SessaoBroker` masks the error it prints on retry (Playwright errors contain the search URL).
- Inserts are fire-and-forget (`.catch` → `[auditoria]` console warning). Never `await` them in a route.
- Retention (`agendarRetencao`) runs in the API at startup and every 24 h; the timer is `unref`'d.

Per-user portal sessions (stage 17, replaces the stage 9 keep-alive):

- The portal is used with the credentials of the **API key's owner** (`req.chaveApi.usuarioId` → every
  `ServicoProtocolos` method takes `usuarioId` first). There are no portal credentials in `.env`.
- `src/credentials/crypto.ts` is a copy of `dashboard/server/utils/credentials-crypto.ts` (AES-256-GCM,
  `CREDENCIAIS_CHAVE`, user id as AAD). Keep both in sync; both test suites decrypt the same fixed vector.
- `GerenciadorSessoes` (`scraper/sessions.ts`) reads `credenciais_portal` on **every** request (1 query):
  missing → `ErroCredenciais('credenciais_nao_cadastradas')`; status `invalida` → `ErroCredenciais('credenciais_invalidas')`
  without touching the portal; a new version (`atualizada_em::text`) closes the old session.
  Status writes are conditional on that version, so a login result never overwrites credentials saved meanwhile.
- `ErroCredenciais` → `409 {erro, codigo}` in the error handler, **not** written to `logs_erro` nor to the
  query/download history (the portal was not queried).
- `login()` throws `ErroLoginRecusado` when the SSO (`POST /api/auth`) answers 4xx (not 429), or when the Broker
  button never shows while a password field is still visible (expired password, guessed: the real screen is
  unknown). Recon: wrong login = `400` + "Credenciais inválidas. Certifique-se de que está informando os dados corretos."
  `SessaoBroker` never retries it and never logs in again with those credentials; the manager marks them `invalida`.
  A successful login calls `aoLogar` → `valida` + `ultimo_login_ok_em`.
- One shared Chromium (`scraper/browser.ts`), one context + queue per user. Idle sessions (`SESSAO_OCIOSA_MINUTOS`)
  are closed by a 1-minute `unref`'d timer; at `SESSOES_MAX` the most idle **free** session is closed (if all are
  busy the limit is briefly exceeded). Map lookup → create → set has no `await` in between, so concurrent requests
  of one user share one session.
- `/health` is public: it shows only counts (`sessoesAbertas`, `maximo`), never which users are logged in.
  Console logs label sessions with a counter (`[sessao #3]`), never the e-mail.

Design rules:

- `portal.ts` knows the site but nothing about HTTP. `app.ts` knows HTTP but nothing about the site.
- `criarApp(servico)` receives the service by injection, so HTTP tests use a fake `ServicoProtocolos`.
- **Business outcomes are return values, technical failures are exceptions.** `obterPdf` returns
  `{tipo:'nao_encontrado' | 'sem_pdf' | 'ok'}`; only real failures throw. This matters because
  `SessaoBroker` retries on *any* exception (except `ErroLoginRecusado`), so never throw for "not found".
- Validate input **before** touching the browser (invalid CPF → 400 in ~1 ms).
- Never expose `pdfUrl`/`idInterno` (internal portal URLs) in API responses.

## 5. Portal knowledge (hard-won — read before touching `portal.ts`)

### Login and navigation
1. `PORTAL_URL` (portalacesso.redelojacorr.com.br/login): textboxes "E-mail", "Senha", button "Entrar".
   Login succeeded when a button whose name starts with "Broker" appears.
2. Clicking that button opens the Broker in a **popup**. The popup goes through redirects
   (`/broker-api/public/integrador/broker/<uuid>?...` → `https://brokerone.com.br/broker/menu.php`).
   **Wait until the dashboard link "Protocolo" is visible** before navigating, or `page.goto`
   fails with `net::ERR_ABORTED`.
3. The dashboard link's accessible name is icon glyphs + "Protocolo". Use `/^\W*Protocolo$/`.
   A loose `/Protocolo/` matches notification cards ("Protocolo não localizado no BrokerOne") and
   "Protocolo Online".

### Overlays (appear at unpredictable times)
- `#colorbox` (jQuery Colorbox) with an iframe (notices, campaigns). Its iframe `name` is a
  timestamp, so never select by it. Close it via the "Fechar" button inside the iframe, `#cboxClose`,
  Escape, or, as a last resort, remove it from the DOM.
- `.announcekit-widget-iframe-backdrop` (news widget) intercepts clicks.
- Both are handled globally with `page.addLocatorHandler` in `registrarFechamentoDeOverlays`.

### Search = plain GET form (do not fill the UI form)
The CPF input in the UI is **cleared by the page during initialization** (AJAX combos reload),
so `fill()` silently ends up empty and the search returns everything. Instead we navigate directly to:

```
https://brokerone.com.br/broker/buscaProtocolosNovo.php?busca=ok&...&page=N
```

Form fields (defaults in `PARAMETROS_PADRAO`):

```
busca=ok txtProdutor= txtCompanhia=0 txtRamo= txtNomeSegurado= txtTelefone= txtCpfSegurado=
txtNrProtocolo= txtNrProposta= txtNrApolice= txtNrEndosso= txtDtVigenciaInicio= txtDtVigenciaFim=
txtDtCadastroInicio= txtDtCadastroFim= txtStatusProtocolo= txtStatusProposta= txtNrSinistroBroker=
txtNrSinistroSeguradora= txtPossuiSinistro= txtNrPlaca= txtNrChassi= txtCep=
txtValorOrdem=lojacobr.protocolo.data txtOrdem=desc
```

- `txtCpfSegurado` **must be masked** (`529.982.247-25`). Digits only → 0 results. `formatarDocumento` handles CPF/CNPJ.
- `txtNrProtocolo` works on its own (used by the PDF endpoint).
- `txtNomeSegurado` returned 0 results in a test with a partial name. The expected format is unknown, so it is not exposed in the API.
- Server-side select codes observed (may be useful for future server-side filters):
  `txtCompanhia` numeric ids (`0`=all, `35`=Allianz…), `txtRamo` numeric ids (`1`=Automóvel…),
  `txtStatusProtocolo` lowercase text values (`aguardando emissão`…), `txtStatusProposta` numeric ids,
  `txtPossuiSinistro` = `Sim`/`Nao`, `txtValorOrdem` ∈ {`lojacobr.protocolo.nr_protocolo`, `.data`, `.vigencia`, `.vigenciaFim`}.
- The result count is the text `"<N> resultados encontrados"` (`0 resultados encontrados` when empty).
  The UI also uses "Sem resultados encontrados" elsewhere, so rely on the count.
- Pagination: `&page=N`, **14 protocols per page**. `buscarProtocolos` loops until it has `N`
  rows (cap `MAX_PAGINAS = 50`).
- Without filters the Protocolo screen lists *recent protocols of other people* (~3000). Never treat
  "a table appeared" as "my search finished". With a `documento` filter, `buscarProtocolos`
  **aborts if any row belongs to another document** (privacy guard).

### Result table structure (`extrairTabela`)
- Each protocol is **one main `<tr>`** (contains the `button#demo-menu-lower-right_<idInterno>`)
  followed by **detail rows** (`<td colspan=9>`) with "Pagamento / Prêmio", "Proposta: X Apolice: Y",
  the sales hierarchy, and "Item: ..." rows.
- Columns are located **by header text**, not by position. Headers: Protocolo, Data Protocolo,
  Vigência Início, Vigência Fim, Segurado, Seguradora, Status protocolo, "Status proposta / Status
  sinistro" (**one shared column**), menu.
- Cell formats:
  - Protocolo: `[NP] 12345678 <br> [TP] Principal` → `protocolo`, `tipo`.
  - Segurado: `NAME <br> (529.982.247-25)` → `seguradoNome`, `seguradoDocumento`.
  - Seguradora: `<img alt="Tokio Marine Seguradora"> <br> Ramo <br> Produto`.
  - Status proposta/sinistro: first line = proposta, remaining lines = sinistro (assumption: no
    real sinistro sample seen yet; `statusSinistro` has always been empty).
- Row menu: `<ul for="demo-menu-lower-right_<id>">` with `<li onclick="window.open('<url>')">` items:
  "Protocolo", **"PDF da Proposta"** (`/broker-api/public//protocolo/<id>/arquivo/<hash>.pdf`),
  "Histórico do Protocolo", "Perfil do Segurado". Some protocols have no PDF item → `pdfUrl: null`.

### PDF download
`context.request.get(pdfUrl)` reuses the browser session cookies and follows the redirect to a
**pre-signed S3 URL** (`broker-files.s3.amazonaws.com`, `X-Amz-Expires=600`). No clicking or popups are needed.
The body is validated with the `%PDF` magic bytes (an HTML body usually means the session expired).

## 6. Known pitfalls

| Pitfall | Fix in place |
|---|---|
| `ReferenceError: __name is not defined` inside `page.evaluate` | `tsx`/esbuild wraps named inner functions with `__name()`, which doesn't exist in the browser. `prepararContexto(context)` injects a no-op `__name` via `addInitScript`. **Always call it right after `newContext()`.** |
| `locator.isVisible({ timeout })` doesn't wait | Use `locator.waitFor({ state: 'visible', timeout })`. |
| Codegen selectors with dynamic ids (`iframe[name="1794958818369"]`, `#demo-menu-lower-right_5695859`) | Use prefix selectors (`[id^="demo-menu-lower-right_"]`) or role/text selectors. |
| `npm ci --omit=dev` broke runtime | `playwright`, `tsx`, `fastify` are **dependencies**. Keep it that way. |
| Scratch scripts outside the package are CommonJS | Put them in `.dev/` (inside the package, git-ignored). |
| `wait` in shell tests hangs when the server runs in the background | Wait for specific PIDs, then kill the server explicitly. |
| A test API with a fake `PORTAL_URL` opened visible Chromium windows on the user's Mac (their `api/.env` has `HEADLESS=false`) | Always start test servers with `HEADLESS=true` explicitly, besides the fake `PORTAL_URL`. |
| `kill %1` on a background `npm start` left the `tsx` child running (a test API kept writing errors for 15 min) | Stop it with `pkill -f "tsx src/server.ts"` and check with `ps` that nothing is left. |

## 7. Debugging a portal change

1. `HEADLESS=false npm run cli -- --email <e-mail> <cpf>` and watch the browser.
2. On failure, the CLI saves full-page screenshots of every tab to `downloads/erros/`, and listings to
   `downloads/debug/protocolos_<key>.json`. `htmlDosResultados()` returns the table HTML for inspection.
3. Exploration scripts live in `.dev/` (git-ignored). Run them with `npx tsx .dev/<file>.ts`.
   Log `request` events to discover the URLs the page calls.
4. `npx playwright codegen <url>` records new flows. Store recordings in `recordings/` (git-ignored, may contain credentials).
5. Add/adjust a unit test with the new HTML shape when possible.

## 8. Testing expectations

- Before handing work back: `npm run typecheck` clean and `npm test` green.
- Unit tests must not touch the network or browser. Use `src/tests/fixtures.ts` (`protocoloFake`)
  and a fake `ServicoProtocolos` with `app.inject(...)`.
- End-to-end verification (only with user authorization): start the server with `HEADLESS=true PORT=<free port>`,
  then run `curl` checks for listing, filters, empty CPF, invalid CPF (400), PDF (`%PDF` + headers),
  unknown protocol (404) and concurrent requests. Then stop the server.
- Never put real CPFs, names or credentials in committed files, tests or docs. Use synthetic valid CPFs
  (e.g. `529.982.247-25`).

## 9. Security and privacy

- CPF and names are personal data (LGPD). `downloads/` (PDFs, debug JSON/HTML, screenshots) is
  git-ignored, so keep it that way and avoid logging personal data beyond what is necessary.
- `.env` holds `CREDENCIAIS_CHAVE` (decrypts every user's portal password). It is git-ignored and should be `chmod 600` on servers.
- Every route except `/health` requires an API key. Keys travel in headers, so the API must only be
  exposed through HTTPS. The default bind is `127.0.0.1`. Do not change the default (Docker sets
  `HOST=0.0.0.0` inside the internal network; only Caddy is published).
- Docker image: the `FROM mcr.microsoft.com/playwright:v<x>` tag must match the `playwright` version in
  `package-lock.json`. Behind Caddy the API lives under `/broker` (prefix stripped); `PREFIXO_PUBLICO` fixes links.
- The CPF filter has a privacy guard (abort if a row belongs to another document). Do not remove it.

## 10. Code conventions

- Portuguese identifiers and messages (`buscarProtocolos`, `FiltrosListagem`, `erro`), matching the domain.
- **File and folder names are in English** (`services/filters.ts`, `scraper/session.ts`, `tests/`).
- Comments (`//`, JSDoc, `.env.example`) are written in **English**. Portal terms stay as they appear on the site
  (e.g. "PDF da Proposta", "resultados encontrados").
- Small single-purpose functions, each with a short comment explaining **why** (portal quirks).
- Selectors: prefer role/text/attribute-prefix selectors. Never use codegen's dynamic ids.
- Log with the `[portal]` / `[sessao]` / `[sessoes]` / `[auth]` / `[auditoria]` / `[retencao]` prefixes (console). Fastify's logger is used for HTTP.
- Keep filter logic pure (`aplicarFiltros`) and unit-tested.
- Dates in API responses keep the portal format. Filter inputs accept `YYYY-MM-DD` or `DD/MM/YYYY`.

## 11. Roadmap / open questions

The monorepo roadmap (dashboard, Docker, reverse proxy, backup) lives in the root
[`../AGENTS.md`](../AGENTS.md). API-specific item still open:

- **Scale**: pool of N sessions + job queue (e.g. BullMQ/Redis). Today it is one session with
  serial processing (~20–60 ops/min). Confirm the portal tolerates concurrent sessions per account first.

Known gaps:

- `statusSinistro` parsing has not been validated with a protocol that has a claim (sinistro).
- `txtNomeSegurado` (name search) format unknown.
- CNPJ is accepted by the scraper (`formatarDocumento`) but the API only accepts CPF and does not validate CNPJ check digits.
- The portal's session timeout is unknown. Sessions are closed after `SESSAO_OCIOSA_MINUTOS` idle anyway; if the portal
  expires them sooner, the first request after that pays one re-login (`[sessao #n] Falha na operação`).
- What the portal shows for an **expired** password is unknown: treated as refused only when a password field is still
  on screen after a 2xx login. Adjust `login()` when it is seen.
