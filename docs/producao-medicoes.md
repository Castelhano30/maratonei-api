# Medições em produção (modelo vazio)

**Estado: pendente.** Este arquivo é o modelo do gate de produção (AC-9.4 a 9.6). Nenhuma medição foi feita; todos os campos abaixo estão em branco de propósito e só devem ser preenchidos por quem executou a medição, com o resultado observado. Não registre segredos (cookies, tokens, chaves) em lugar nenhum deste arquivo.

Pré-requisito: o deploy do [runbook](deploy-railway.md) concluído e `LOG_CLIENT_IP_DEBUG=true` ligado **apenas durante as medições**.

## 1. IP real e `TRUST_PROXY`

Como medir: do seu aparelho, abra `https://<web>/api/v1/health` e leia, nos logs da API, a linha `client-ip-debug`. Compare `ip` com o IP público do aparelho (por exemplo, o que um serviço de "meu IP" mostra).

| Campo                                  | Valor |
| -------------------------------------- | ----- |
| Data e hora                            |       |
| URL consultada                         |       |
| IP público do aparelho                 |       |
| `ip` registrado                        |       |
| `ips` registrado                       |       |
| `x-forwarded-for` registrado           |       |
| `TRUST_PROXY` em uso                   |       |
| O `ip` é o IP real do cliente?         |       |
| Decisão (valor final de `TRUST_PROXY`) |       |

## 2. `Origin` depois do rewrite

Como medir: faça uma mutação pelo domínio do web (por exemplo, cadastro ou login) e confira que a API recebe um `Origin` aceito por `ALLOWED_ORIGINS` (a requisição não deve falhar na verificação de origem).

| Campo                          | Valor |
| ------------------------------ | ----- |
| Data e hora                    |       |
| Rota exercitada                |       |
| `Origin` recebido pela API     |       |
| Resultado (aceito ou recusado) |       |
| Ajuste necessário              |       |

## 3. Login por e-mail e por Google através do rewrite

Como medir: com `API_ORIGIN` privado, faça login por e-mail e senha e login com Google pelo domínio do web; confira o cookie de sessão e o retorno à origem.

| Campo                                                         | Valor |
| ------------------------------------------------------------- | ----- |
| Data e hora                                                   |       |
| Login por e-mail: resultado                                   |       |
| Login com Google: resultado                                   |       |
| Cookie de sessão presente e enviado nas chamadas seguintes?   |       |
| Redirect do Google conferido (`/api/v1/auth/callback/google`) |       |
| Problemas encontrados                                         |       |

## 4. Balde do SSR (IP privado do Next)

Como medir: com a Home aberta (renderização no servidor do web chamando a API pela rede privada), observe nos logs o `ip` das chamadas do SSR e confirme que elas dividem um só balde de limite público por IP.

| Campo                                                                     | Valor |
| ------------------------------------------------------------------------- | ----- |
| Data e hora                                                               |       |
| `ip` das chamadas do SSR                                                  |       |
| Chamadas por carregamento da Home                                         |       |
| Alguma resposta 429 vinda do SSR?                                         |       |
| Decisão (por exemplo, repassar o IP do cliente em cabeçalho de confiança) |       |

## Fechamento (AC-9.5)

| Campo                            | Valor |
| -------------------------------- | ----- |
| `TRUST_PROXY` final              |       |
| `LOG_CLIENT_IP_DEBUG` desligado? |       |
| Data do fechamento               |       |
| Responsável                      |       |
