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
