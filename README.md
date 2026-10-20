# maratonei-api

API do Maratonei: listas compartilhadas de filmes e séries. Express 5 + Prisma 7 + PostgreSQL 17,
contrato OpenAPI gerado dos schemas Zod.

## Arquitetura

```mermaid
flowchart LR
  Web["maratonei-web<br/>Next.js (Vercel)"] -- "rewrite /api/*" --> API
  Mobile["app mobile<br/>(futuro)"] -.-> API
  subgraph API["maratonei-api (Express 5)"]
    direction TB
    MW["helmet · pino-http · origin-check"] --> Auth["Better Auth<br/>/api/v1/auth/*"]
    MW --> Rate["rate limit (global e /titles)"] --> Mods["módulos: lists · members · invites<br/>items · ratings · comments · progress · titles"]
    Mods --> Err["error handler (problem+json)"]
  end
  Mods --> DB[("PostgreSQL 17<br/>Prisma 7 + adapter-pg")]
  Auth --> DB
  Mods --> TMDB["TMDB v3<br/>(cache em memória)"]
```

Cada módulo em `src/modules/<nome>` tem routes, controller, service e schemas Zod; módulos só se falam pelo
`index.ts`. Os mesmos schemas validam as requisições e geram o OpenAPI (`/api/v1/openapi.json`, Swagger em `/docs`).

### Decisões técnicas

- **Contrato único:** Zod é a fonte da verdade; o web gera o cliente do OpenAPI. Mudanças são aditivas dentro de `/v1`.
- **Erros:** sempre `application/problem+json` com `code` de um registro único (`src/http/error-codes.ts`); o cliente trata `code` como conjunto aberto.
- **Autenticação:** Better Auth com cookie httpOnly; isolada em `modules/auth` para aceitar tokens no mobile depois.
- **Autorização no servidor:** `requireListRole` em toda rota de lista; não membro recebe 404 (não revela a existência).
- **TMDB:** cópia do título em `Title` (7 dias); temporadas, detalhe e provedores só em memória, com chamadas simultâneas
  deduplicadas e cache negativo de 5 min para 404. Falha do TMDB não derruba a lista (serve a linha em cache).
- **Banco:** Prisma 7 com adapter-pg; pool com `connectionTimeoutMillis` e `statement_timeout` configuráveis; banco fora vira 503 `DB_UNAVAILABLE`.
- **Paginação:** toda coleção é `Page<T>`, exceto as limitadas por `MAX_LIST_MEMBERS` (progresso e notas), conferido por teste sobre o OpenAPI.

## Limites e observabilidade

- **Rate limit por IP** (`express-rate-limit`, memória): `RATE_LIMIT_GLOBAL_PER_MIN` (padrão 300, exceto `/health`) e
  `RATE_LIMIT_TITLES_PER_MIN` (padrão 60, rotas que tocam o TMDB). Excesso → 429 `RATE_LIMITED` com `Retry-After`.
  `0` desliga; com `NODE_ENV=test` ficam desligados. Atrás de proxy defina `TRUST_PROXY` (saltos confiáveis, 1 no Render)
  para o IP real; com mais de uma instância o contador em memória não é compartilhado. Login, cadastro e reset têm o limite próprio do Better Auth.
- **Logs:** pino estruturado com `requestId`; cookies, tokens de convite/reset e `code`/`state` do OAuth são mascarados.
- **Liveness/readiness:** `GET /api/v1/health` (para o monitor externo) e `/health/ready` (checa o banco).

## Desempenho (p95)

`pnpm perf:check` semeia 200 itens, 3 membros, notas, comentários e progresso no banco local, mede cada rota principal
contra a API em execução e remove os dados. Suba a API com os limites desligados
(`RATE_LIMIT_GLOBAL_PER_MIN=0 RATE_LIMIT_TITLES_PER_MIN=0 pnpm dev`). Medição local (Postgres no Docker, 100 amostras por rota,
mais 5 de aquecimento; rotas do TMDB fora, como no PRD):

| Rota                                | p50 ms | p95 ms |
| ----------------------------------- | ------ | ------ |
| GET /health                         | 0.7    | 1.5    |
| GET /me                             | 5.6    | 7.4    |
| GET /lists                          | 7.2    | 8.7    |
| GET /lists/:id                      | 8.4    | 11.7   |
| GET /lists/:id/members              | 8.4    | 12.3   |
| GET /lists/:id/items (pageSize 100) | 14.7   | 24.8   |
| GET /lists/:id/items?status=WANT    | 10.3   | 13.8   |
| GET /lists/:id/items/random         | 11.4   | 13.3   |
| GET /items/:id/ratings              | 9.6    | 11.9   |
| GET /items/:id/comments             | 9.6    | 12.1   |
| GET /items/:id/progress             | 10.6   | 12.3   |

Todas ficam abaixo de 500 ms. É medição local, sem rede nem cold start; repetir contra produção está nas pendências.

## Backup

O workflow `.github/workflows/backup.yml` roda `pg_dump` (formato custom) aos domingos e guarda o artefato por 30 dias; exige o
secret `BACKUP_DATABASE_URL` (conexão direta, sem pooler). Para testar localmente contra o Postgres do Docker:

```sh
export BACKUP_DATABASE_URL=postgresql://maratonei:maratonei@localhost:5432/maratonei
export PG_EXEC="docker exec -i maratonei-api-db-1"   # usa os binários do contêiner; omita se tiver o cliente instalado
bash scripts/backup.sh maratonei.dump
bash scripts/restore-check.sh maratonei.dump         # restaura num banco temporário e compara a contagem de cada tabela
```

## Rodar API e web juntos

```sh
# terminal 1: API (este repositório)
docker compose up -d --wait && pnpm install && cp .env.example .env && pnpm db:generate && pnpm db:migrate && pnpm db:seed && pnpm dev
# terminal 2: web (../maratonei-web) — o rewrite /api/* aponta para http://localhost:4000
pnpm install && pnpm dev          # http://localhost:3000
```

Entre com `e2e@maratonei.local` (senha do seed em `.env.example`). O `WEB_ORIGIN` e o `ALLOWED_ORIGINS` da API devem conter `http://localhost:3000`.

## Pendências de produção

Dependem de deploy real e não foram tentadas: Render, Neon (pooler e `statement_timeout`), Resend e domínio, Vercel (rewrite, `Origin` e IP real),
monitor externo na liveness, restore do backup a partir do banco de produção, p95 em produção e prints do README. Detalhes em `deferred-work.md`.

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

## Progresso, onde assistir e sorteio

- Progresso de séries, sob `/api/v1/lists/:listId/items/:itemId/progress` (qualquer membro; filme → 400
  `NOT_A_SERIES`): `GET` devolve um registro por membro (`current` = maior `(season, episode)` marcado,
  `watchedCount`, `episodes`), `PUT` e `DELETE me/episodes/:season/:episode` marcam e desmarcam o episódio
  do próprio membro (idempotentes). Não existe rota para escrever o progresso de outro membro, e marcar
  episódios não altera o status coletivo do item. Temporada ou episódio fora de `Title.seasons` → 400
  `VALIDATION_FAILED`. Sair da lista ou ser removido apaga o progresso (cascata).
- `GET /api/v1/titles/TV/:tmdbId/seasons/:season`: episódios da temporada (cache em memória de 1 h).
- `GET /api/v1/titles/:mediaType/:tmdbId/providers`: `{flatrate, rent, buy, link}` da região BR (cache em
  memória de 24 h); sem dados BR, listas vazias e `link: null`. Nada disso é persistido no banco.
- `GET /api/v1/lists/:listId/items/random?mediaType=`: sorteia um item `WANT`; sem pendentes, 200 com `{data: null}`.
