#!/usr/bin/env bash
# Restaura um dump num banco temporário e confere se a contagem de linhas de cada tabela bate
# com a origem. Uso: BACKUP_DATABASE_URL=... scripts/restore-check.sh arquivo.dump
# O servidor precisa permitir CREATE DATABASE. O banco temporário é removido no fim.
# PG_EXEC (opcional) prefixa os binários do Postgres (ver backup.sh). A URL nunca é impressa.
set -euo pipefail

: "${BACKUP_DATABASE_URL:?defina BACKUP_DATABASE_URL}"
dump="${1:?informe o arquivo .dump}"
# shellcheck disable=SC2206
pg=(${PG_EXEC:-})

tmp_db="restore_check_$(date -u +%s)_$$"
admin_url=$(printf '%s' "$BACKUP_DATABASE_URL" | sed -E 's#(://[^/]+/)[^?]*#\1postgres#')
tmp_url=$(printf '%s' "$BACKUP_DATABASE_URL" | sed -E "s#(://[^/]+/)[^?]*#\1${tmp_db}#")

counts() {
  "${pg[@]}" psql -At -F ' ' "$1" <<'SQL'
SELECT format('SELECT %L, count(*) FROM %I.%I', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename \gexec
SQL
}

cleanup() { "${pg[@]}" psql -q "$admin_url" -c "DROP DATABASE IF EXISTS \"${tmp_db}\"" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${pg[@]}" psql -q "$admin_url" -c "CREATE DATABASE \"${tmp_db}\"" >/dev/null
"${pg[@]}" pg_restore --no-owner --no-privileges --dbname "$tmp_url" <"$dump"

source_counts=$(counts "$BACKUP_DATABASE_URL")
restored_counts=$(counts "$tmp_url")

if [ "$source_counts" = "$restored_counts" ] && [ -n "$source_counts" ]; then
  echo "restore verificado: contagens iguais em $(printf '%s\n' "$source_counts" | wc -l | tr -d ' ') tabelas"
  printf '%s\n' "$restored_counts"
else
  echo "FALHA: contagens diferentes entre origem e restore" >&2
  diff <(printf '%s\n' "$source_counts") <(printf '%s\n' "$restored_counts") >&2 || true
  exit 1
fi
