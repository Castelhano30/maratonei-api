# maratonei-api

API do Maratonei: listas compartilhadas de filmes e séries. Express 5 + Prisma 7 + PostgreSQL 17,
contrato OpenAPI gerado dos schemas Zod.

## Pré-requisitos

- Node 24 (`.nvmrc`)
- pnpm 10 (`corepack enable` usa a versão de `packageManager`)
- Docker (Postgres 17 local via `docker compose`)

## Primeiros passos

```sh
docker compose up -d --wait   # Postgres 17 em 127.0.0.1:5432 (bancos maratonei e maratonei_test)
pnpm install
cp .env.example .env
pnpm db:generate              # gera o cliente Prisma em src/generated/prisma (obrigatório num clone novo)
pnpm db:migrate               # aplica as migrations no banco de dev
pnpm db:seed                  # cria o usuário verificado do E2E (e2e@maratonei.local)
pnpm dev                      # API em http://localhost:4000
```

- Liveness: `GET /api/v1/health` · readiness: `GET /api/v1/health/ready`
- Contrato: `GET /api/v1/openapi.json` · Swagger UI: http://localhost:4000/docs

## Qualidade

```sh
pnpm lint
pnpm typecheck
pnpm format:check   # pnpm format corrige
pnpm build          # compila para dist/ (pnpm start roda o build)
pnpm test
```

## Testes

Os testes de integração rodam contra o banco real `maratonei_test`, configurado em `.env.test`
(variáveis já exportadas, como no CI, têm precedência). O global setup aplica
`prisma migrate deploy` nesse banco e recusa qualquer banco cujo nome não termine em `_test`;
cada teste começa com `resetDb()` (truncate).

O banco `maratonei_test` é criado por `docker/postgres/init.sql`, que só roda quando o volume é
criado. Se o seu volume é anterior a esse arquivo, recrie-o (apaga os dados locais):

```sh
docker compose down -v
docker compose up -d --wait
```

## TMDB e contrato OpenAPI

- `TMDB_API_KEY` (opcional, chave v3) liga a busca e o detalhe de títulos. Sem ela, ou com o TMDB fora,
  essas rotas respondem 503 `TMDB_UNAVAILABLE`. Os testes nunca chamam o TMDB real: usam um fake injetável
  (`test/helpers/tmdb.ts`) e o cliente HTTP é testado contra o servidor fake de `test/fakes/tmdb-server.ts`.
- Para gerar o contrato para o web (Orval), com a API rodando (`pnpm dev`):

```sh
curl -s http://localhost:4000/api/v1/openapi.json -o ../maratonei-web/docs/contracts/openapi.local.json
```

## Avaliações e comentários

Sob `/api/v1/lists/:listId/items/:itemId` (qualquer membro; não membro recebe 404):

- `GET ratings` (nota de cada membro e média), `PUT ratings/me` (`{stars: 1..5}`, cria ou edita) e
  `DELETE ratings/me`. Só existe a nota própria: ninguém escreve a nota de outro membro.
- `GET comments?page=&pageSize=&sort=createdAt:desc|asc`, `POST comments` (`{body}`, 1 a 2000
  caracteres), `PATCH` e `DELETE comments/:commentId` (só o autor; de outro membro: 403 `NOT_OWN_RESOURCE`).
- `ListItem.ratingAverage` (2 casas, `null` sem notas) e `ratingCount` vêm das notas reais.
- Sair da lista, ser removido ou excluir o item apaga as notas e os comentários do membro (cascata).
