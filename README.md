# vetornorte — Broker Protocol API

Local HTTP API that automates the **Broker One** portal (Rede Lojacorr), which has no public API.
It logs in with a real browser (Playwright), keeps the session open, and exposes:

- a **listing** of insurance protocols for a CPF, with filters;
- a **PDF download** ("PDF da Proposta") for a protocol number.

> ⚠️ This API handles personal data (CPF, names) protected by Brazil's LGPD and has **no
> authentication yet**. Keep it bound to `127.0.0.1` or behind an authenticated proxy/VPN.

---

## Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running](#running)
- [API reference](#api-reference)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Project layout](#project-layout)

---

## Requirements

- **Node.js 22+** (developed on Node 26). Uses `process.loadEnvFile` and native TS tooling via `tsx`.
- **Chromium** downloaded by Playwright (see installation).
- A valid portal account (e-mail + password) with access to the Broker "Protocolo" screen.
- ~500 MB of free RAM for the headless browser.

## Installation

```bash
git clone <repo-url> vetornorte
cd vetornorte
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
| `HOST` | no | `127.0.0.1` | Bind address. `0.0.0.0` exposes it on the network — only behind auth |
| `DOWNLOAD_DIR` | no | `downloads` | Folder used by the CLI script and for error screenshots |

`.env` is git-ignored. Never commit credentials.

## Running

```bash
npm run dev     # watch mode (restarts on file changes)
npm start       # normal mode
```

On startup the server logs in to the portal once (~8 s). Subsequent requests reuse that session.
`Ctrl+C` / `SIGTERM` shuts down the server and the browser cleanly.

There is also a standalone CLI (no HTTP), useful for debugging the scraper:

```bash
npm run cli -- <cpf>                    # list protocols for a CPF
npm run cli -- <cpf> <protocol>         # list and download that protocol's PDF
npm run cli -- --protocolo <protocol>   # search by protocol number and download the PDF
```

## API reference

Base URL: `http://127.0.0.1:3000`

### `GET /health`

Session status.

```json
{ "ok": true, "sessao": { "ativa": true, "abertaEm": "2026-11-18T00:48:12.903Z" } }
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

### Errors

| Status | Body | When |
|---|---|---|
| `400` | `{"erro":"CPF inválido"}` | CPF fails local check-digit validation |
| `400` | `{"erro":"Parâmetros inválidos","detalhes":"..."}` | missing/unknown/malformed parameter |
| `404` | `{"erro":"Protocolo não encontrado"}` | protocol number does not exist |
| `404` | `{"erro":"Protocolo não possui PDF da Proposta"}` | protocol exists but has no PDF |
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
curl "http://127.0.0.1:3000/protocolos?cpf=<a CPF with protocols>"
curl -o p.pdf "http://127.0.0.1:3000/protocolos/<protocol>/pdf" && head -c 5 p.pdf   # %PDF-
curl "http://127.0.0.1:3000/protocolos?cpf=111.111.111-11"                           # 400
```

## Deployment

There is no build step: the server runs TypeScript directly through `tsx`
(`playwright`, `tsx` and `fastify` are runtime dependencies).

### Linux server with systemd (recommended for now)

```bash
# 1. Node 22+ and the project
sudo mkdir -p /opt/vetornorte && sudo chown $USER /opt/vetornorte
git clone <repo-url> /opt/vetornorte && cd /opt/vetornorte
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
WorkingDirectory=/opt/vetornorte
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

The API has no authentication. Do **not** bind it to `0.0.0.0` on a public network. Options:

- keep `HOST=127.0.0.1` and put a reverse proxy (nginx/Caddy) in front with authentication + TLS;
- or reach it only through a VPN / private network.

### Deployment notes

- Run **a single instance** per portal account: each instance performs its own login.
  Horizontal scaling (session pool + job queue) is on the roadmap.
- Confirm the portal is reachable from the server's IP before going live
  (some portals block data-center IPs).
- Upgrading: `git pull && npm ci --omit=dev && npx playwright install chromium && sudo systemctl restart vetornorte`.
  Re-run `playwright install` whenever the `playwright` version changes.
- Docker is not provided yet (planned).

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
├── api/app.ts                # Fastify routes, validation, error mapping
├── services/protocols.ts    # business logic (list by CPF, get PDF)
├── services/filters.ts      # in-memory listing filters
├── scraper/session.ts        # persistent logged-in browser, queue, retry
├── scraper/portal.ts         # all portal-specific automation (selectors, URLs, parsing)
├── config/env.ts             # environment loading/validation
├── utils/cpf.ts              # CPF/CNPJ validation and formatting
├── scripts/cli.ts            # standalone CLI
└── tests/fixtures.ts         # shared test data
```

For architecture, portal internals and contribution guidelines, see [`AGENTS.md`](AGENTS.md).
