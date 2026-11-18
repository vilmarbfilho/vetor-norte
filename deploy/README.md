# Deployment (VPS with Docker)

Everything runs from the root `docker-compose.yml` with the `producao` profile:

```
internet ─► caddy :80/:443 (HTTPS, Let's Encrypt)
              ├─ https://<DOMINIO>/broker/*  ─► api:3000        (prefix stripped)
              └─ https://<DOMINIO>/*         ─► dashboard:3100  (UI + /api)
            postgres (internal only; 127.0.0.1:5432 on the host)
            migrations (one-shot), backup (daily pg_dump, toggle)
```

Only Caddy publishes ports. The images are multi-arch (tested on arm64; the Oracle ARM VPS works).

## 1. Before the first start

1. **DNS**: an `A` record `vn.vlabs.com.br` → the VPS public IP. It must resolve **before** Caddy starts,
   otherwise the certificate cannot be issued (`dig +short vn.vlabs.com.br`).
2. **Oracle Cloud firewall** — ports 80 and 443 must be open in two places:
   - Console: *Networking → Virtual Cloud Networks → (VCN) → Security Lists → Default* → add **Ingress rules**
     source `0.0.0.0/0`, TCP, destination ports `80` and `443` (optionally UDP `443` for HTTP/3).
   - Inside the VM (Oracle's Ubuntu images ship with restrictive iptables rules):
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. Docker with the compose plugin (`docker compose version`).

## 2. Configuration (three `.env` files, all `chmod 600`, never committed)

```bash
git clone <repo-url> ~/vetornorte && cd ~/vetornorte
cp .env.example .env                       # root: database, domain, backup
cp api/.env.example api/.env               # portal credentials, rate limit, keep-alive, retention
cp dashboard/.env.example dashboard/.env   # session/login options
chmod 600 .env api/.env dashboard/.env
```

- Root `.env`: a strong URL-safe `POSTGRES_PASSWORD` (e.g. `openssl rand -hex 24`), `CPF_HMAC_CHAVE`
  (`openssl rand -hex 32`; never change it later, or old query history can't be searched by CPF), uncomment
  `COMPOSE_PROFILES=producao`, `DOMINIO=vn.vlabs.com.br`, `BACKUP_HABILITADO=true` if wanted.
- `api/.env` and `dashboard/.env`: their `DATABASE_URL`, `HOST`, `PORT` (and `HEADLESS`, `COOKIE_SECURE`,
  `PREFIXO_PUBLICO`, `CPF_HMAC_CHAVE`) are **overridden by the compose file**; you don't need to edit them.

## 3. Start, users, logs

```bash
docker compose up -d --build                    # first build takes a few minutes
docker compose ps                               # api/dashboard "healthy"
docker compose logs -f caddy                    # watch the certificate being issued
docker compose exec dashboard npm run usuarios -- criar --nome "Name" --email someone@example.com
```

Open `https://vn.vlabs.com.br`, log in and create API keys. Integrations call
`https://vn.vlabs.com.br/broker/protocolos?cpf=...` with `Authorization: Bearer <key>`.

API key CLI (alternative to the dashboard): `docker compose exec api npm run chaves -- listar`.

## 4. Updating

```bash
git pull
docker compose up -d --build     # rebuilds changed images, applies new migrations, restarts
docker image prune -f            # optional: remove old image layers
```

When the `playwright` version in `api/package-lock.json` changes, update the `FROM` tag in `api/Dockerfile`
to the same version.

## 5. Backup

Enabled by `BACKUP_HABILITADO=true` (root `.env`, then `docker compose up -d backup`). Every day at
`BACKUP_HORA` (timezone `TZ`), `pg_dump` writes `./backups/vetornorte_<date>_<time>.dump` and keeps only the
newest `BACKUP_MANTER` (7) files. Files are owned by root with mode 600 (they contain personal data):
use `sudo` to read or copy them.

Backups live **only on this VPS**: they protect against mistakes and bad migrations, not against losing
the VPS. Copy one elsewhere from time to time if that matters.

```bash
docker compose logs backup                      # schedule and results
docker compose exec backup sh /backup.sh agora  # manual backup now (works even when disabled)
```

Restore (replaces the current data):

```bash
docker compose stop api dashboard
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U $POSTGRES_USER -d $POSTGRES_DB' \
  < backups/vetornorte_YYYY-MM-DD_HHMMSS.dump        # run as root/sudo (file mode 600)
docker compose start api dashboard
```

## 6. Notes

- Keep the `caddy_data` volume: it holds the certificates (Let's Encrypt limits re-issuing).
- Caddy access logs are disabled on purpose: API URLs contain CPFs.
- The database port is bound to `127.0.0.1`; to inspect it remotely use an SSH tunnel
  (`ssh -L 5432:127.0.0.1:5432 vps`) or `docker compose exec postgres psql ...`.
- Run a single `api` instance (one portal session per account).
