import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../http/app-error.js';
import {
  CATALOG_TTL_MS,
  clearAllCaches,
  createCache,
  DETAIL_TTL_MS,
  GENRES_TTL_MS,
  NEGATIVE_TTL_MS,
  PROVIDERS_TTL_MS,
  SEARCH_TTL_MS,
  STALE_RETENTION_MS,
  STALE_RETRY_MS,
} from './index.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

afterEach(() => {
  vi.useRealTimers();
});

function clock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  return {
    advance(ms: number) {
      vi.setSystemTime(Date.now() + ms);
    },
  };
}

describe('lib/cache — TTLs nomeados (AC-8.1)', () => {
  it('catálogo 6 h, gêneros 24 h, busca 10 min, detalhe 1 h, provedores 24 h, negativo 5 min', () => {
    expect(CATALOG_TTL_MS).toBe(6 * HOUR);
    expect(GENRES_TTL_MS).toBe(24 * HOUR);
    expect(SEARCH_TTL_MS).toBe(10 * MINUTE);
    expect(DETAIL_TTL_MS).toBe(1 * HOUR);
    expect(PROVIDERS_TTL_MS).toBe(24 * HOUR);
    expect(NEGATIVE_TTL_MS).toBe(5 * MINUTE);
    expect(STALE_RETENTION_MS).toBe(24 * HOUR);
  });

  it('repetir dentro do TTL não chama o carregador; depois do TTL chama de novo', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: SEARCH_TTL_MS });
    const load = vi.fn(async () => 'valor');

    await cache.get('k', load);
    time.advance(SEARCH_TTL_MS - 1);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);

    time.advance(2);
    await cache.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('chaves diferentes não se misturam', async () => {
    const cache = createCache<string>({ ttlMs: HOUR });
    const load = vi.fn(async () => 'valor');
    await Promise.all([cache.get('a', load), cache.get('b', load)]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('lib/cache — stale-if-error (AC-8.2)', () => {
  const down = () => Promise.reject(new AppError('TMDB_UNAVAILABLE'));

  it('vencida há menos de 24 h e o TMDB falhando: serve a cópia', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'cópia');

    time.advance(HOUR + STALE_RETENTION_MS - 1);

    await expect(cache.get('k', down)).resolves.toBe('cópia');
  });

  it('além da retenção de 24 h: 503 TMDB_UNAVAILABLE', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'cópia');

    time.advance(HOUR + STALE_RETENTION_MS + 1);

    await expect(cache.get('k', down)).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('sem cópia: 503 TMDB_UNAVAILABLE', async () => {
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await expect(cache.get('k', down)).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('sem staleIfError a entrada vencida não é servida', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR });
    await cache.get('k', async () => 'cópia');
    time.advance(HOUR + 1);
    await expect(cache.get('k', down)).rejects.toMatchObject({ code: 'TMDB_UNAVAILABLE' });
  });

  it('só TMDB_UNAVAILABLE usa a cópia: outros erros e o 404 passam', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'cópia');
    time.advance(HOUR + 1);

    await expect(cache.get('k', () => Promise.reject(new Error('bug')))).rejects.toThrow('bug');
    await expect(
      cache.get('k', () => Promise.reject(new AppError('TITLE_NOT_FOUND'))),
    ).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
  });

  it('uma recarga bem-sucedida troca a cópia e renova o prazo', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'velha');
    time.advance(HOUR + 1);
    await expect(cache.get('k', async () => 'nova')).resolves.toBe('nova');
    time.advance(HOUR + 1);
    await expect(cache.get('k', down)).resolves.toBe('nova');
  });
});

describe('lib/cache — dedupe, falha e negativo (AC-8.3)', () => {
  it('N pedidos simultâneos iguais geram 1 chamada e dividem o resultado', async () => {
    const cache = createCache<{ id: number }>({ ttlMs: HOUR });
    const load = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { id: 1 };
    });

    const results = await Promise.all(Array.from({ length: 8 }, () => cache.get('k', load)));

    expect(load).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
  });

  it('falha não é cacheada: a seguinte tenta de novo (mesmo com falhas simultâneas)', async () => {
    const cache = createCache<string>({ ttlMs: HOUR });
    const failing = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new AppError('TMDB_UNAVAILABLE');
    });

    const settled = await Promise.allSettled([cache.get('k', failing), cache.get('k', failing)]);
    expect(settled.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(failing).toHaveBeenCalledTimes(1);

    await expect(cache.get('k', async () => 'ok')).resolves.toBe('ok');
  });

  it('404 fica 5 min em cache e depois consulta de novo', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR });
    const missing = vi.fn(() => Promise.reject(new AppError('TITLE_NOT_FOUND')));

    await expect(cache.get('k', missing)).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
    time.advance(NEGATIVE_TTL_MS - 1);
    await expect(cache.get('k', missing)).rejects.toMatchObject({ code: 'TITLE_NOT_FOUND' });
    expect(missing).toHaveBeenCalledTimes(1);

    time.advance(2);
    await expect(cache.get('k', async () => 'achou')).resolves.toBe('achou');
  });
});

describe('lib/cache — teto de entradas e limpeza', () => {
  it('passando do teto descarta as mais antigas', async () => {
    const cache = createCache<number>({ ttlMs: HOUR, maxEntries: 3 });
    for (const n of [1, 2, 3, 4]) await cache.get(`k${n}`, async () => n);

    expect(cache.size).toBe(3);
    const reload = vi.fn(async () => 99);
    await cache.get('k1', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('clearAllCaches esvazia todos os caches criados', async () => {
    const a = createCache<number>({ ttlMs: HOUR });
    const b = createCache<number>({ ttlMs: HOUR });
    await a.get('k', async () => 1);
    await b.get('k', async () => 2);

    clearAllCaches();

    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
  });
});

describe('lib/cache — varredura, espera após cópia vencida e opções', () => {
  const down = () => Promise.reject(new AppError('TMDB_UNAVAILABLE'));

  it('a varredura (500+ entradas) guarda cópias ainda servíveis e remove o que não serve mais', async () => {
    const time = clock();
    const cache = createCache<number>({ ttlMs: HOUR, staleIfError: true });
    for (let n = 0; n < 500; n++) await cache.get(`velha-${n}`, async () => n);

    // Vencidas, mas dentro da retenção de 24 h: precisam sobreviver à próxima gravação.
    time.advance(HOUR + 1);
    await cache.get('nova', async () => 1);
    expect(cache.size).toBe(501);
    await expect(cache.get('velha-7', down)).resolves.toBe(7);

    // Além de TTL + retenção: a próxima gravação as descarta.
    time.advance(STALE_RETENTION_MS + 1);
    await cache.get('outra', async () => 2);
    // Sobram só 'nova' (ainda servível, com 24 h de idade) e 'outra'.
    expect(cache.size).toBe(2);
  });

  it('a varredura também remove o negativo (404) vencido', async () => {
    const time = clock();
    const cache = createCache<number>({ ttlMs: HOUR, staleIfError: true });
    for (let n = 0; n < 500; n++) {
      await expect(
        cache.get(`ausente-${n}`, () => Promise.reject(new AppError('TITLE_NOT_FOUND'))),
      ).rejects.toBeInstanceOf(AppError);
    }
    time.advance(NEGATIVE_TTL_MS + 1);
    await cache.get('nova', async () => 1);
    expect(cache.size).toBe(1);
  });

  it('depois de servir a cópia vencida espera antes de tentar o TMDB de novo', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'cópia');
    time.advance(HOUR + 1);

    const failing = vi.fn(down);
    await expect(cache.get('k', failing)).resolves.toBe('cópia');
    await expect(cache.get('k', failing)).resolves.toBe('cópia');
    expect(failing).toHaveBeenCalledTimes(1);

    time.advance(STALE_RETRY_MS + 1);
    await expect(cache.get('k', async () => 'nova')).resolves.toBe('nova');
  });

  it('allowStale: false ignora a cópia vencida', async () => {
    const time = clock();
    const cache = createCache<string>({ ttlMs: HOUR, staleIfError: true });
    await cache.get('k', async () => 'cópia');
    time.advance(HOUR + 1);
    await expect(cache.get('k', down, { allowStale: false })).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
    });
  });

  it('o teto descarta o menos usado recentemente (LRU)', async () => {
    const cache = createCache<number>({ ttlMs: HOUR, maxEntries: 3 });
    for (const n of [1, 2, 3]) await cache.get(`k${n}`, async () => n);
    await cache.get('k1', async () => 99); // leitura recente de k1
    await cache.get('k4', async () => 4); // descarta k2, não k1

    const reload = vi.fn(async () => 0);
    await cache.get('k1', reload);
    expect(reload).not.toHaveBeenCalled();
    await cache.get('k2', reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('delete remove a entrada', async () => {
    const cache = createCache<number>({ ttlMs: HOUR });
    await cache.get('k', async () => 1);
    cache.delete('k');
    expect(cache.size).toBe(0);
  });

  it('carregador que falha de forma síncrona não deixa promessa pendurada', async () => {
    const cache = createCache<number>({ ttlMs: HOUR });
    const broken = (): Promise<number> => {
      throw new Error('boom');
    };
    await expect(cache.get('k', broken)).rejects.toThrow('boom');
    await expect(cache.get('k', async () => 5)).resolves.toBe(5);
  });
});
