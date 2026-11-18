# vetornorte — Broker Protocol API

> Part of the `vetornorte` monorepo: this is the `api/` package. See the root [`AGENTS.md`](../AGENTS.md)
> for the overall layout (API, dashboard, database, Docker).

Local HTTP API that automates the **Broker One** portal (Rede Lojacorr), which has no public API.
It logs in with a real browser (Playwright), keeps the session open, and exposes:

- a **listing** of insurance protocols for a CPF, with filters;
- a **PDF download** ("PDF da Proposta") for a protocol number, as binary or base64 JSON;
- a **generic PDF delivery** to configured destinations (webhooks: n8n, WhatsApp gateways, ...).

> ⚠️ This API handles personal data (CPF, names) protected by Brazil's LGPD. Every endpoint except
> `/health` requires an **API key**. Keys travel in a header, so only expose the API over HTTPS.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running](#running)
- [Authentication (API keys)](#authentication-api-keys)
- [Error log and download history](#error-log-and-download-history)
- [API reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## Requirements

- **Node.js 22+** (developed on Node 26). Uses `process.loadEnvFile` and native TS tooling via `tsx`.
- **Chromium** downloaded by Playwright (see installation).
- **PostgreSQL** with the monorepo migrations applied (root `docker-compose.yml`, see the root `AGENTS.md`).
- A valid portal account (e-mail + password) with access to the Broker "Protocolo" screen.
- ~500 MB of free RAM for the headless browser.

## Installation

```bash
git clone <repo-url> vetornorte
cd vetornorte/api                      # this package lives in the api/ folder of the monorepo
npm ci
npx playwright install chromium        # on Linux servers: npx playwright install --with-deps chromium
cp .env.example .env                   # then fill in the credentials
```

## Configuration

All configuration comes from environment variables (loaded from `.env` if present; real
environment variables take precedence).

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORTAL_URL` | yes | — | Portal login URL (`https://portalacesso.redelojacorr.com.br/login`) |
| `PORTAL_EMAIL` | yes | — | Portal login e-mail |
| `PORTAL_SENHA` | yes | — | Portal password |
| `HEADLESS` | no | `true` | `false` opens a visible browser (useful for development) |
| `PORT` | no | `3000` | HTTP port |
| `HOST` | no | `127.0.0.1` | Bind address. `0.0.0.0` exposes it on the network — only behind the HTTPS reverse proxy |
| `PREFIXO_PUBLICO` | no | — | Path prefix added by a reverse proxy (`/broker` in Docker); used only in links returned by the API (`pdf`) |
| `DOWNLOAD_DIR` | no | `downloads` | Folder used by the CLI script and for error screenshots |
| `DATABASE_URL` | yes (server, key CLI) | — | PostgreSQL URL, e.g. `postgres://vetornorte:<password>@127.0.0.1:5432/vetornorte` |
| `RATE_LIMIT_HABILITADO` | no | `true` | `false` disables the per-key rate limit |
| `RATE_LIMIT_POR_MINUTO` | no | `60` | Requests per minute for keys without their own limit |
| `KEEPALIVE_HABILITADO` | no | `true` | `false` disables the portal session keep-alive |
| `KEEPALIVE_INTERVALO_MINUTOS` | no | `10` | Idle minutes before the keep-alive checks/renews the session |
| `RETENCAO_LOGS_DIAS` | no | `90` | Error logs older than this are deleted (daily) |
| `RETENCAO_DOWNLOADS_DIAS` | no | `365` | PDF download history older than this is deleted (daily) |
| `RETENCAO_CONSULTAS_DIAS` | no | `90` | Protocol query history older than this is deleted (daily) |
| `CPF_HMAC_CHAVE` | yes (server) | — | Secret (≥ 32 chars, `openssl rand -hex 32`) for CPF hashes in the query history. **Same value in `dashboard/.env`**. Do not change it after go-live |
| `DESTINO_<NOME>_URL` | no | — | Creates a delivery destination named `<nome>` (lowercase, `_` → `-`). http/https only |
| `DESTINO_<NOME>_TOKEN` | no | — | Sent to that destination as `Authorization: Bearer <token>` |
| `DESTINO_<NOME>_TIMEOUT_MS` | no | `15000` | Delivery timeout for that destination |

`.env` is git-ignored. Never commit credentials.

## Running

```bash
npm run dev     # watch mode (restarts on file changes)
npm start       # normal mode
```

On startup the server checks the database (it exits if PostgreSQL is unreachable or not migrated),
then logs in to the portal once (~8 s). Subsequent requests reuse that session.
`Ctrl+C` / `SIGTERM` shuts down the server and the browser cleanly.

**Keep-alive** (`KEEPALIVE_HABILITADO`): when the API has been idle for `KEEPALIVE_INTERVALO_MINUTOS`,
it reloads the Broker dashboard (a light page, never a search) through the normal request queue.
This keeps the portal session from expiring, so the first request after a quiet period does not pay
for a new login. If the session had expired anyway, it logs in again. If that also fails (portal down,
password changed), the failure goes to the error log (`logs_erro`, `detalhes.origem = "keepalive"`),
so it shows up in the dashboard before a client request hits it. While the portal stays down,
one entry is written per interval.

There is also a standalone CLI (no HTTP), useful for debugging the scraper:

```bash
npm run cli -- <cpf>                    # list protocols for a CPF
npm run cli -- <cpf> <protocol>         # list and download that protocol's PDF
npm run cli -- --protocolo <protocol>   # search by protocol number and download the PDF
```

## Authentication (API keys)

Every endpoint except `GET /health` requires a key, sent in either header:

```
Authorization: Bearer vn_...
X-API-Key: vn_...
```

Each key has a set of permissions:

| Permission | Endpoints |
|---|---|
| `protocolos:listar` | `GET /protocolos` |
| `pdf:baixar` | `GET /protocolos/{protocolo}/pdf` |
| `pdf:enviar` | `GET /destinos`, `POST /protocolos/{protocolo}/pdf/envios` |

Until the dashboard exists, keys are managed with a CLI (needs `DATABASE_URL`):

```bash
npm run chaves -- criar --nome "n8n produção" --permissoes protocolos:listar,pdf:baixar [--limite 30]
npm run chaves -- listar
npm run chaves -- revogar <prefixo>      # e.g. vn_AfafDxwV (shown by "listar")
```

- The full key is printed **once**, at creation. Only its SHA-256 hash is stored.
- A revoked key stops working within ~10 s (lookups are cached for 10 s).
- **Rate limit** (`RATE_LIMIT_HABILITADO`): fixed one-minute window per key, in memory (resets on restart).
  The limit is the key's own `--limite`, or `RATE_LIMIT_POR_MINUTO`. Responses carry
  `X-RateLimit-Limit` / `X-RateLimit-Remaining`; over the limit → `429` with `Retry-After`.

```bash
curl -H "Authorization: Bearer $CHAVE" "http://127.0.0.1:3000/protocolos?cpf=529.982.247-25"
```

## Error log, download history and query history

The API records, in PostgreSQL (read by the dashboard):

- **`logs_erro`**: every `5xx` response (portal failure, delivery failure, database down during
  authentication), with the route template, HTTP status, message, stack, API key and request id.
  `4xx` responses (invalid CPF, missing key, not found...) are caller mistakes and are not stored.
- **`downloads_pdf`**: every PDF request (`GET .../pdf` as `binario` or `base64`, and
  `POST .../pdf/envios` as `envio` with the destination), with the result (`ok`, `nao_encontrado`,
  `sem_pdf`, `erro`), size, duration and the API key that asked for it.
- **`consultas_protocolos`**: every `GET /protocolos` call with a valid CPF: the CPF **masked**
  (`529.***.***-25`) plus its keyed hash (HMAC-SHA256 with `CPF_HMAC_CHAVE`, so the dashboard can search by a
  full CPF without the CPF being stored), the other filters, result (`ok`/`erro`), how many and which
  protocol numbers were returned, duration and API key. Invalid CPFs (400) are not stored.

Writes are asynchronous: a database failure is printed on the console and never fails the request.

**LGPD**: CPFs are masked (`529.***.***-25`) in everything written to the database and in the console
logs (request URLs, error messages). The download history does not store CPFs at all; the query history
stores only the mask and the HMAC. Rows older than `RETENCAO_LOGS_DIAS` / `RETENCAO_DOWNLOADS_DIAS` /
`RETENCAO_CONSULTAS_DIAS` are deleted at startup and then once a day.

## API reference

Base URL: `http://127.0.0.1:3000`. All endpoints below require an API key, except `/health`.

### `GET /health`

Session status. Public (no key), for container health checks.

```json
{ "ok": true, "sessao": { "ativa": true, "abertaEm": "2026-11-18T00:48:12.903Z", "ultimaAtividadeEm": "2026-11-18T01:02:40.120Z" } }
```

### `GET /protocolos`

Lists all protocols of a CPF (all result pages are fetched), optionally filtered.

| Query param | Type | Match |
|---|---|---|
| `cpf` **(required)** | string, with or without mask | must be a valid CPF, otherwise `400` (the portal is not called) |
| `protocolo` | digits | exact |
| `dataProtocoloDe`, `dataProtocoloAte` | date | inclusive range |
| `vigenciaInicioDe`, `vigenciaInicioAte` | date | inclusive range |
| `vigenciaFimDe`, `vigenciaFimAte` | date | inclusive range |
| `segurado` | text | contains, case/accent-insensitive |
| `seguradora` | text | contains, case/accent-insensitive |
| `statusProtocolo` | text | contains, case/accent-insensitive |
| `statusProposta` | text | contains, case/accent-insensitive |
| `statusSinistro` | text | contains, case/accent-insensitive |

Dates accept `YYYY-MM-DD` or `DD/MM/YYYY`. Filters are combined with AND.
Unknown query parameters are rejected with `400`.

Example:

```bash
curl "http://127.0.0.1:3000/protocolos?cpf=529.982.247-25&seguradora=tokio&dataProtocoloDe=2026-01-01"
```

```json
{
  "cpf": "529.982.247-25",
  "total": 1,
  "protocolos": [
    {
      "protocolo": "12345678",
      "tipo": "Principal",
      "dataProtocolo": "20/04/2026 09:55:01",
      "vigenciaInicio": "16/10/2026",
      "vigenciaFim": "24/10/2026",
      "seguradoNome": "JOHN DOE",
      "seguradoDocumento": "529.982.247-25",
      "seguradora": "Tokio Marine Seguradora",
      "ramo": "Vida Individual",
      "produto": "Viagem",
      "statusProtocolo": "Proposta Emitida",
      "statusProposta": "Proposta Vigente",
      "statusSinistro": "",
      "proposta": "PROP0001",
      "apolice": "APOL0001",
      "possuiPdf": true,
      "pdf": "/protocolos/12345678/pdf"
    }
  ]
}
```

Dates in the response keep the portal format (`DD/MM/YYYY`, `DD/MM/YYYY HH:mm:ss`).
A CPF with no protocols returns `200` with `"total": 0`.

### `GET /protocolos/{protocolo}/pdf`

Downloads the "PDF da Proposta" of a protocol. Only the protocol number is needed.

```bash
curl -o proposta.pdf "http://127.0.0.1:3000/protocolos/12345678/pdf"
```

- `200` — `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="proposta_<n>.pdf"`

Add `?formato=base64` to get JSON instead (handy for low-code tools and messaging APIs that take base64):

```bash
curl "http://127.0.0.1:3000/protocolos/12345678/pdf?formato=base64"
```

```json
{
  "protocolo": "12345678",
  "arquivo": { "nome": "proposta_12345678.pdf", "mimeType": "application/pdf", "tamanho": 183422, "base64": "JVBERi0xLjcK..." }
}
```

### `GET /destinos`

Lists the configured delivery destinations (names and kinds only, never URLs or tokens).

```json
{ "destinos": [ { "nome": "n8n", "tipo": "webhook" }, { "nome": "whatsapp", "tipo": "webhook" } ] }
```

### `POST /protocolos/{protocolo}/pdf/envios`

Fetches the protocol's PDF and **pushes** it to a configured destination. The destination is
chosen by name; its URL lives only in the server configuration (the API has no authentication,
so callers can never point it at an arbitrary URL).

| Body field | Required | Description |
|---|---|---|
| `destino` | yes | Destination name (see `GET /destinos`) |
| `destinatario` | no | Channel-specific recipient (phone number, chat id, e-mail…), ≤ 100 chars |
| `mensagem` | no | Text to send with the file (e.g. WhatsApp caption), ≤ 1000 chars |
| `referencia` | no | Your correlation id, echoed to the destination and in the response, ≤ 100 chars |

```bash
curl -X POST "http://127.0.0.1:3000/protocolos/12345678/pdf/envios" \
  -H 'Content-Type: application/json' \
  -d '{"destino":"whatsapp","destinatario":"5511999999999","mensagem":"Segue sua proposta","referencia":"pedido-42"}'
```

```json
{ "enviado": true, "destino": "whatsapp", "protocolo": "12345678",
  "arquivo": { "nome": "proposta_12345678.pdf", "tamanho": 183422 }, "referencia": "pedido-42" }
```

The call is synchronous: `200` means the destination answered with a 2xx.

**Webhook payload** (what the destination receives, `POST`, `Content-Type: application/json`):

```json
{
  "evento": "protocolo.pdf_proposta",
  "protocolo": "12345678",
  "destinatario": "5511999999999",
  "mensagem": "Segue sua proposta",
  "referencia": "pedido-42",
  "arquivo": { "nome": "proposta_12345678.pdf", "mimeType": "application/pdf", "tamanho": 183422, "base64": "JVBERi0xLjcK..." },
  "enviadoEm": "2026-11-17T12:00:00.000Z"
}
```

Missing optional fields are sent as `null`. To deliver to WhatsApp today, point a destination at a
small flow (n8n, Make, your own service) that maps this payload to your WhatsApp provider's
"send document" call. A native adapter can be added later (see `AGENTS.md`).

### Errors

| Status | Body | When |
|---|---|---|
| `401` | `{"erro":"API key ausente. ..."}` | no `Authorization: Bearer` / `X-API-Key` header |
| `401` | `{"erro":"API key inválida ou revogada"}` | unknown or revoked key |
| `403` | `{"erro":"API key sem permissão para esta operação","permissaoNecessaria":"..."}` | key lacks the endpoint's permission |
| `429` | `{"erro":"Limite de requisições excedido","tenteNovamenteEmSegundos":N}` | rate limit hit (see `Retry-After`) |
| `503` | `{"erro":"Autenticação indisponível. Tente novamente."}` | database unreachable while validating the key |
| `400` | `{"erro":"CPF inválido"}` | CPF fails local check-digit validation |
| `400` | `{"erro":"Parâmetros inválidos","detalhes":"..."}` | missing/unknown/malformed parameter |
| `404` | `{"erro":"Protocolo não encontrado"}` | protocol number does not exist |
| `404` | `{"erro":"Protocolo não possui PDF da Proposta"}` | protocol exists but has no PDF |
| `400` | `{"erro":"Destino desconhecido","destinosDisponiveis":[...]}` | `destino` not configured (the portal is not called) |
| `502` | `{"erro":"Falha ao entregar o PDF no destino","destino":"..."}` | destination unreachable, timed out or answered non-2xx |
| `502` | `{"erro":"Falha ao consultar o portal. Tente novamente."}` | portal failed twice (the API already retried once with a fresh login) |

### Performance and concurrency

Measured against the real portal:

| Operation | Time |
|---|---|
| Login at startup (once) | ~8 s |
| Listing by CPF (warm session) | ~1–2.5 s |
| PDF download | ~3 s |
| Invalid CPF | ~1 ms |

Requests share **one** logged-in browser tab, so they are processed **one at a time** (queue).
Expect roughly 20–60 operations/minute per instance.

## Testing

```bash
npm test          # unit + HTTP tests with a fake service (no browser, no portal access)
npm run typecheck # TypeScript type checking
```

End-to-end check against the real portal (requires `.env`):

```bash
npm start
H="Authorization: Bearer $CHAVE"   # a key created with npm run chaves
curl -H "$H" "http://127.0.0.1:3000/protocolos?cpf=<a CPF with protocols>"
curl -H "$H" -o p.pdf "http://127.0.0.1:3000/protocolos/<protocol>/pdf" && head -c 5 p.pdf   # %PDF-
curl -H "$H" "http://127.0.0.1:3000/protocolos?cpf=111.111.111-11"                           # 400
curl "http://127.0.0.1:3000/protocolos?cpf=111.111.111-11"                                   # 401
```

## Deployment

**Recommended: Docker** with the whole monorepo stack (API, dashboard, PostgreSQL, Caddy HTTPS, backup).
See [`../deploy/README.md`](../deploy/README.md). There the API is served at `https://<domain>/broker/...`
(`api/Dockerfile`, based on the official Playwright image, amd64 and arm64).

The alternative below (systemd, without Docker) is kept for reference.

There is no build step: the server runs TypeScript directly through `tsx`
(`playwright`, `tsx` and `fastify` are runtime dependencies).

### Linux server with systemd (without Docker)

```bash
# 1. Node 22+ and the project
sudo mkdir -p /opt/vetornorte && sudo chown $USER /opt/vetornorte
git clone <repo-url> /opt/vetornorte && cd /opt/vetornorte/api
npm ci --omit=dev

# 2. Chromium + its system libraries
npx playwright install --with-deps chromium

# 3. Configuration
cp .env.example .env && chmod 600 .env   # fill in credentials; HEADLESS=true; HOST=127.0.0.1
```

`/etc/systemd/system/vetornorte.service`:

```ini
[Unit]
Description=vetornorte Broker API
After=network-online.target

[Service]
WorkingDirectory=/opt/vetornorte/api
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5
User=vetornorte
Environment=NODE_ENV=production
# Playwright looks for browsers in the user's cache; keep it explicit:
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/vetornorte/.browsers
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

If you set `PLAYWRIGHT_BROWSERS_PATH`, install Chromium with the same variable:
`PLAYWRIGHT_BROWSERS_PATH=/opt/vetornorte/.browsers npx playwright install --with-deps chromium`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vetornorte
journalctl -u vetornorte -f
curl http://127.0.0.1:3000/health
```

### Exposing it

API keys travel in request headers, so never expose the API over plain HTTP. Keep `HOST=127.0.0.1`
and put an HTTPS reverse proxy in front (Caddy in the monorepo compose file), or reach
it only through a VPN / private network.

### Deployment notes

- Run **a single instance** per portal account: each instance performs its own login.
  Horizontal scaling (session pool + job queue) is on the roadmap.
- Confirm the portal is reachable from the server's IP before going live
  (some portals block data-center IPs).
- Upgrading: `git pull && npm ci --omit=dev && npx playwright install chromium && sudo systemctl restart vetornorte`.
  Re-run `playwright install` whenever the `playwright` version changes.
- Docker: `api/Dockerfile`; keep its `FROM mcr.microsoft.com/playwright:v<version>` equal to the `playwright` version in `package-lock.json`.

## Troubleshooting

| Symptom | What to do |
|---|---|
| `Variável de ambiente ausente: ...` | Fill in `.env` (see `.env.example`). |
| `browserType.launch: Executable doesn't exist` | Run `npx playwright install chromium` (same user / `PLAYWRIGHT_BROWSERS_PATH`). |
| `502` on every request | Check credentials (log in manually), check `journalctl`, run the CLI with `HEADLESS=false` to watch it. |
| Wrong/empty data after a portal update | The portal markup changed. Run `npm run cli -- <cpf>` and inspect `downloads/erros/*.png` and `downloads/debug/`. See `AGENTS.md` → "Portal knowledge". |

## Project layout

```
src/
├── server.ts                 # entry point: session + service + HTTP server
├── api/app.ts                # Fastify routes, validation, error mapping, route permissions
├── auth/keys.ts              # key format, generation, SHA-256 hash, header parsing, permissions
├── auth/hook.ts              # onRequest hook: API key, permission (403), rate limit (429)
├── auth/rate-limit.ts        # in-memory fixed-window limiter per key
├── auth/repository.ts        # key lookup in PostgreSQL (10 s cache) + last-use tracking
├── db/client.ts              # PostgreSQL connection (postgres.js)
├── audit/mask.ts             # CPF masking (LGPD) + safe text for the DB
├── audit/logger.ts           # console log serializers that mask CPFs
├── audit/recorder.ts         # error log + PDF download history (fire-and-forget inserts)
├── audit/retention.ts        # daily purge of old rows
├── services/protocols.ts    # business logic (list by CPF, get PDF)
├── services/filters.ts      # in-memory listing filters
├── services/documents.ts    # PDF -> Documento, delivery orchestration
├── delivery/types.ts         # Destino contract, Documento, ErroEntrega
├── delivery/webhook.ts       # generic webhook destination (JSON + base64)
├── delivery/registry.ts      # builds destinations from DESTINO_* env vars
├── scraper/session.ts        # persistent logged-in browser, queue, retry
├── scraper/keepalive.ts      # idle-time session keep-alive
├── scraper/portal.ts         # all portal-specific automation (selectors, URLs, parsing)
├── config/load.ts            # loads .env; `obrigatoria()`
├── config/env.ts             # server configuration
├── utils/cpf.ts              # CPF/CNPJ validation and formatting
├── scripts/cli.ts            # standalone scraper CLI
├── scripts/keys.ts           # API key CLI (criar / listar / revogar)
├── tests/auth-fakes.ts       # in-memory key repository for tests
├── tests/audit-fakes.ts      # in-memory audit recorder for tests
└── tests/fixtures.ts         # shared test data
```

For architecture, portal internals and contribution guidelines, see [`AGENTS.md`](AGENTS.md).
