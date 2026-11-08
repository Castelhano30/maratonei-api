# Catálogo do TMDB: spike e decisões (Fase 7a)

Registro do spike manual feito em **2026-11-08** contra a API real do TMDB (v3, `language=pt-BR`, `region=BR`), com a chave guardada só em `.env` (nunca impressa nem commitada). Os testes automatizados usam sempre o fake. O spike só decide o **mapa de tradução** de `catalog.service`; o contrato HTTP não muda.

Atende AC-31.11 (em cartaz com gênero), AC-32.2 (calibragem do ranking) e as decisões de `RECENT` e `STREAMING` do spec da Fase 7.

## Decisões

| Ponto                                                      | Decisão                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOW_PLAYING` sem gênero e `sort=POPULARITY`               | `GET /movie/now_playing?region=BR`                                                                                                                                                                                                                                                                                                                 |
| `NOW_PLAYING` com gênero ou outra ordem                    | `discover/movie` com `region=BR`, **`release_date.gte`/`release_date.lte`** (hoje − 45 dias até hoje), `with_release_type=2\|3`. O filtro de gênero **continua disponível** nessa coleção. Atenção: usar `primary_release_date.*` no lugar de `release_date.*` não filtra por região e traz milhares de títulos (total 7659 contra 224); é errado. |
| `RECENT`                                                   | `discover/tv` por **`first_air_date`** (estreias), janela de 180 dias até hoje. `air_date` foi descartado: devolve séries antigas com episódio novo (Os Simpsons com 38 temporadas, Lei & Ordem com 28).                                                                                                                                           |
| Piso de votos de `NEWEST`                                  | `vote_count.gte=10` em qualquer coleção. Sem piso, o topo de `NEWEST` são títulos de hoje com 0 votos.                                                                                                                                                                                                                                             |
| Piso de `VOTE_AVERAGE` em `NOW_PLAYING` e `RECENT`         | `vote_count.gte=25`                                                                                                                                                                                                                                                                                                                                |
| Piso de `VOTE_AVERAGE` em `ALL`, `STREAMING` e `TOP_RATED` | `CATALOG_MIN_VOTES_MOVIE` / `CATALOG_MIN_VOTES_TV`                                                                                                                                                                                                                                                                                                 |
| `CATALOG_MIN_VOTES_MOVIE`                                  | **3000** (mantido)                                                                                                                                                                                                                                                                                                                                 |
| `CATALOG_MIN_VOTES_TV`                                     | **2000** (era 1000)                                                                                                                                                                                                                                                                                                                                |
| `STREAMING`                                                | `with_watch_providers=8\|119\|337\|1899\|11`, `watch_region=BR`, `with_watch_monetization_types=flatrate`, data de lançamento até hoje                                                                                                                                                                                                             |
| Páginas                                                    | `page` de 1 a 500: o TMDB responde 400 acima disso, mesmo com `total_pages` maior (até 1001)                                                                                                                                                                                                                                                       |

## 1. Em cartaz (`NOW_PLAYING`)

`movie/now_playing?region=BR` devolve 176 filmes em 9 páginas, com janela de 2026-09-30 a 2026-11-11 (cerca de 40 dias). Comparação com `discover` na janela de 45 dias (`release_date`, `region=BR`, tipos 2 e 3) em 10 páginas:

- o `discover` devolveu 200 títulos; 143 dos 166 do `now_playing` estão nele;
- dos 40 primeiros por popularidade, 37 estão no `now_playing`;
- por gênero (primeira página de 20): Ação 16/20, Comédia 17/20, Drama 20/20, Terror 16/20, Animação 14/20 estão no `now_playing`.

A divergência é pequena e, em geral, são reprises de cinema; por isso o filtro de gênero fica disponível via `discover` e não é escondido. Ordenar por nota com piso de 25 votos põe "O Bosque Selvagem" (8,5) e "Três Horas Para Viver" (8,25) no topo; pisos maiores (50, 100) mudam pouco, e com 10 aparece um show filmado com 14 votos, então fica 25.

## 2. Séries recentes (`RECENT`)

- `first_air_date` (180 dias): 5447 séries; por popularidade o topo é reconhecível (VisionQuest, Dragon Ball Super: Beerus, dramas coreanos); todas as amostras têm `number_of_seasons = 1`, então o cartão mostra "1ª temporada" para estreias.
- `air_date` (30 dias): 3914 séries, topo dominado por produções longevas (Os Simpsons, Grey's Anatomy). Descartado.
- `NEWEST` (`first_air_date.desc`) sem piso: topo com 0 votos. Com `vote_count.gte=5`: 487 séries; com 10: 292; com 25: 134. Escolhido **10**.
- `VOTE_AVERAGE` com piso 25: notas 9,4 a 9,7 com 29 a 400 votos (aceitável como ranking de recentes).

## 3. Ranking (`TOP_RATED`) e pisos de votos

Filmes (`sort_by=vote_average.desc`, 1ª página):

| Piso     | Total | Top 5                                                                                                | Menor `voteCount` na página |
| -------- | ----- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| 1000     | 5052  | inclui títulos novos de 1,4 mil votos (Avatar Aang)                                                  | 1281                        |
| **3000** | 1970  | Um Sonho de Liberdade, O Poderoso Chefão, Devoradores de Estrelas, Michael, 12 Homens e uma Sentença | 4646                        |
| 5000     | 1092  | os clássicos, sem Michael                                                                            | 6610                        |
| 10000    | 398   | só clássicos                                                                                         | 10125                       |

Séries:

| Piso     | Total | Top 5                                                                              | Menor `voteCount` |
| -------- | ----- | ---------------------------------------------------------------------------------- | ----------------- |
| 300      | 1865  | Dragon Ball Super: Beerus (9,62 com 396 votos), Aprendendo a Lição, Rancho Dutton… | 396               |
| 1000     | 597   | Aprendendo a Lição (1014 votos), Breaking Bad, The Chosen, Frieren, Avatar         | 1014              |
| **2000** | 241   | Breaking Bad, Avatar: A Lenda de Aang, One Piece, Arcane, Chernobyl                | 2078              |
| 3000     | 147   | os mesmos cinco                                                                    | 3148              |

Conclusão (AC-32.2): com **3000** (filmes) e **2000** (séries) o top 5 é reconhecível e nenhum item tem `voteCount` abaixo do piso. Com 1000 para séries entram títulos de nota alta e poucos votos que distorcem o ranking.

## 4. Streamings (`STREAMING`)

Os cinco ids conferem em `watch/providers/movie?watch_region=BR`: Netflix=8, Amazon Prime Video=119, Disney Plus=337, HBO Max=1899, MUBI=11. Para o primeiro `flatrate` de cada título, `watch/providers` devolve um desses provedores (às vezes também a variante "with Ads" ou "Amazon Channel", que não está na lista fixa e deve ser ignorada).

`NEWEST` (por lançamento) com piso 10 de votos dá títulos de poucos dias com 17 a 89 votos; sem piso aparecem lançamentos com 0 a 5 votos. Por popularidade o topo inclui clássicos disponíveis (O Mentalista, Batman: O Cavaleiro das Trevas), como esperado de um catálogo de streaming.

## 5. Formato dos dados

- Item de filme em `discover` não traz `origin_country`; item de série traz.
- O detalhe de série tem `number_of_seasons`; o detalhe de filme e o de série têm `production_countries[].iso_3166_1`.
- `page=501` em `discover` responde 400 (`error`), e o cliente trata isso como indisponibilidade; a API limita `page` a 500.

## Como repetir

O script usado ficou fora do repositório, para não carregar a chave. Para repetir: rodar chamadas equivalentes com `node --env-file=.env` lendo `TMDB_API_KEY`, imprimindo apenas títulos, notas e contagens, **nunca** a URL com `api_key`.
