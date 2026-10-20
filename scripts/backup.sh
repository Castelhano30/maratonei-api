#!/usr/bin/env bash
# Gera um dump (formato custom do pg_dump) do banco em $BACKUP_DATABASE_URL.
# Uso: BACKUP_DATABASE_URL=postgresql://... scripts/backup.sh [arquivo-de-saida]
# PG_EXEC (opcional) prefixa os binários do Postgres, ex.: PG_EXEC="docker exec -i maratonei-api-db-1".
# A URL nunca é impressa.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?defina BACKUP_DATABASE_URL (conexão direta, sem pooler)}"
out="${1:-maratonei-$(date -u +%Y%m%dT%H%M%SZ).dump}"
# shellcheck disable=SC2086
${PG_EXEC:-} pg_dump --format=custom --no-owner --no-privileges "$BACKUP_DATABASE_URL" >"$out"
test -s "$out" || { echo "dump vazio" >&2; exit 1; }
echo "dump gravado em $out ($(wc -c <"$out") bytes)"
