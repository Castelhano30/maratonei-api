# Publicação na Railway (runbook)

Este roteiro é **manual**: o repositório entrega `railway.toml`, CI e este texto, e nada aqui acessa painel algum. O gate de produção (AC-9.2 a 9.6 da Fase 7) só fecha quando você executa os passos e registra as medições em [producao-medicoes.md](producao-medicoes.md).

Arquitetura alvo: um projeto Railway com dois serviços, `api` (sem domínio público, só rede privada) e `web` (domínio público gerado). O web repassa `/api/v1/*` e `/docs` para a API pelo rewrite do Next, usando `API_ORIGIN` privado. O banco fica no Neon (branch `main`).

> **Nenhum segredo vai a repositório, log ou chat.** Valores só nas variáveis de cada plataforma. Esta página lista variáveis por nome, nunca por valor.

## 1. Criar o projeto e os serviços

1. Crie o projeto na Railway com os serviços `api` e `web`, cada um ligado à `main` do seu repositório (`maratonei-api` e `maratonei-web`).
2. Em cada serviço, ligue **Wait for CI** e deixe **Serverless desligado** (a API mantém cache em memória e uma só instância).
3. `api`: **não** gere domínio público. `web`: gere o domínio público.
4. Os arquivos `railway.toml` de cada repositório já definem build, start, healthcheck e, na API, o `preDeployCommand` (`pnpm db:deploy`, que roda `prisma migrate deploy`). Migrations só rodam nesse pré-deploy.

## 2. Banco (Neon)

No branch `main` do Neon, copie duas URLs:

- `DATABASE_URL`: a URL **com pooler** (usada pela API).
- `DIRECT_DATABASE_URL`: a URL **direta**, sem pooler (usada só pelo CLI do Prisma no pré-deploy).

## 3. Variáveis

**Serviço `api`** (as do `.env.example`, em produção):

| Variável                                   | Observação                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `production`                                                                                                                                   |
| `DATABASE_URL`, `DIRECT_DATABASE_URL`      | do passo 2                                                                                                                                     |
| `BETTER_AUTH_SECRET`                       | mínimo de 32 caracteres, gerado por você                                                                                                       |
| `TMDB_API_KEY`                             | chave da API v3 do TMDB                                                                                                                        |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | do Google Cloud (passo 4); sempre os dois ou nenhum                                                                                            |
| `WEB_ORIGIN`                               | origem pública do web (`https://<web>`), sem path                                                                                              |
| `ALLOWED_ORIGINS`                          | a mesma origem pública do web                                                                                                                  |
| `TRUST_PROXY`                              | `2` no primeiro deploy; a medição do passo 6 confirma ou corrige                                                                               |
| `EMAIL_TRANSPORT`                          | **não muda** (continua `console`): sem domínio próprio o e-mail de reset não tem entrega confiável em produção, e a jornada 8 não depende dele |

Opcionais, com padrão: `RATE_LIMIT_PUBLIC_PER_MIN` (120), `RATE_LIMIT_PUBLIC_GLOBAL_PER_MIN` (600), `CATALOG_MIN_VOTES_MOVIE` (3000), `CATALOG_MIN_VOTES_TV` (1000), `LOG_CLIENT_IP_DEBUG` (`false`), além das demais do `.env.example`.

**Serviço `web`:**

| Variável     | Observação                                                     |
| ------------ | -------------------------------------------------------------- |
| `API_ORIGIN` | `http://<api>.railway.internal:PORT` (rede privada da Railway) |

## 4. Google Cloud

No console do Google, registre o redirect autorizado `https://<web>/api/v1/auth/callback/google`. Enquanto as páginas de Termos e Privacidade não existirem, a tela de consentimento permanece em modo de teste.

## 5. Primeiro deploy e conferência

Faça o deploy e confira, **pelo domínio do web**:

- `/api/v1/health` responde `{"status":"ok"}`;
- `/api/v1/openapi.json` abre;
- `/docs` mostra a documentação da API.

## 6. Medições (AC-9.4, AC-9.5)

Ligue `LOG_CLIENT_IP_DEBUG=true` na API **só durante as medições**. A liveness passa a registrar uma linha `client-ip-debug` com `ip`, `ips` e `x-forwarded-for`. Faça as quatro medições descritas em [producao-medicoes.md](producao-medicoes.md), ajuste `TRUST_PROXY` se o `ip` registrado não for o IP real do cliente, **desligue o log** (`LOG_CLIENT_IP_DEBUG=false` ou remova a variável) e registre tudo no modelo. Só depois divulgue a URL.

## 7. Custo

Anote o consumo da Railway depois de 7 dias de uso e acompanhe todo mês (requisito de custo).

## Referências

- Critérios AC-9.1 a 9.6 da Fase 7 (spec do projeto, fora deste repositório).
- Limites públicos e cache: ver a seção de rotas públicas do [README](../README.md).
