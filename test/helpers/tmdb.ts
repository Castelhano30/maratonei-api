import { setTmdbClient } from '../../src/lib/tmdb/index.js';
import { clearTitleCache } from '../../src/modules/titles/index.js';
import { createFakeTmdb } from '../fakes/tmdb-client.js';

/**
 * TMDB fake em memória compartilhado pelos testes de API. O `test/setup.ts` o
 * injeta em `lib/tmdb` e o zera antes de cada teste: nenhum teste chama o TMDB real.
 */
export const fakeTmdb = createFakeTmdb();

export function resetTmdb(): void {
  fakeTmdb.reset();
  clearTitleCache();
  setTmdbClient(fakeTmdb);
}
