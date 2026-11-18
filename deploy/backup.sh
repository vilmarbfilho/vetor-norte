#!/bin/sh
# Daily PostgreSQL backup (runs in the "backup" compose service, postgres image).
#   BACKUP_HABILITADO=true   enables it (anything else: the service just idles)
#   BACKUP_HORA=03:00        time of day (container TZ)
#   BACKUP_MANTER=7          how many backup files to keep (older ones are deleted)
# Manual run (also when disabled):  docker compose exec backup sh /backup.sh agora
# Files: /backups/vetornorte_<date>_<time>.dump (pg_dump custom format, compressed). Restore: see deploy/README.md.

set -u
umask 077 # backups contain personal data: owner-only files

HORA="${BACKUP_HORA:-03:00}"
MANTER="${BACKUP_MANTER:-7}"
export PGPASSWORD="$POSTGRES_PASSWORD"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

fazer_backup() {
  arquivo="/backups/vetornorte_$(date +%Y-%m-%d_%H%M%S).dump"
  # Written to a temporary name first, so a failed dump never looks like a valid backup.
  if pg_dump -Fc -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$arquivo.parcial"; then
    mv "$arquivo.parcial" "$arquivo"
    log "ok: $(basename "$arquivo") ($(du -h "$arquivo" | cut -f1))"
  else
    rm -f "$arquivo.parcial"
    log "FALHA no pg_dump"
    return 1
  fi
  # Keep only the newest $MANTER files.
  ls -1t /backups/vetornorte_*.dump 2>/dev/null | tail -n +"$((MANTER + 1))" | while read -r antigo; do
    rm -f "$antigo" && log "removido: $(basename "$antigo")"
  done
}

if [ "${1:-}" = "agora" ]; then
  fazer_backup
  exit $?
fi

if [ "${BACKUP_HABILITADO:-false}" != "true" ]; then
  log "desabilitado (BACKUP_HABILITADO=${BACKUP_HABILITADO:-false})"
  exec sleep infinity
fi

case "$HORA" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) log "BACKUP_HORA inválida: $HORA (use HH:MM)"; exit 1 ;;
esac
case "$MANTER" in
  ''|*[!0-9]*|0) log "BACKUP_MANTER inválido: $MANTER"; exit 1 ;;
esac

log "habilitado: todo dia às $HORA, mantendo $MANTER arquivo(s)"
while true; do
  agora=$(date +%s)
  alvo=$(date -d "$(date +%Y-%m-%d) $HORA" +%s)
  [ "$alvo" -le "$agora" ] && alvo=$((alvo + 86400))
  sleep $((alvo - agora))
  fazer_backup || true # one failure must not stop tomorrow's backup
done
