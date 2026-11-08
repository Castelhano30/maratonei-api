import { AppError } from '../../http/app-error.js';

/** TTLs nomeados (AD-19). Cada cache guarda um só TTL. */
export const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
export const GENRES_TTL_MS = 24 * 60 * 60 * 1000;
export const SEARCH_TTL_MS = 10 * 60 * 1000;
export const DETAIL_TTL_MS = 60 * 60 * 1000;
export const PROVIDERS_TTL_MS = 24 * 60 * 60 * 1000;
/** Cache negativo: o que o TMDB disse não existir (404 → `TITLE_NOT_FOUND`). */
export const NEGATIVE_TTL_MS = 5 * 60 * 1000;
/** Quanto uma entrada vencida continua guardada para servir se o TMDB falhar. */
export const STALE_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Teto de entradas por cache; ao passar, descarta as mais antigas. */
export const CACHE_MAX_ENTRIES = 2000;
/** Acima deste tamanho, cada gravação descarta as entradas que já não servem para nada. */
const CACHE_SWEEP_SIZE = 500;

/** Depois de servir a cópia vencida, espera isto antes de tentar o TMDB de novo. */
export const STALE_RETRY_MS = 60 * 1000;

type Entry<T> = { at: number; value: T; retryAt?: number } | { at: number; notFound: AppError };

export interface CacheOptions {
  /** Frescor das entradas. */
  ttlMs: number;
  /**
   * Com o TMDB fora (`TMDB_UNAVAILABLE`), serve a entrada vencida há até
   * `STALE_RETENTION_MS` além do TTL, em vez de falhar. Padrão: desligado.
   */
  staleIfError?: boolean;
  /** Teto de entradas (padrão `CACHE_MAX_ENTRIES`). */
  maxEntries?: number;
}

export interface GetOptions {
  /** `false` ignora a cópia vencida (caminhos que gravam no banco). Padrão: o do cache. */
  allowStale?: boolean;
}

export interface Cache<T> {
  /**
   * Valor em cache dentro do TTL ou o resultado de `load`. Pedidos simultâneos à mesma
   * chave compartilham uma única chamada. Só o sucesso e o 404 (`TITLE_NOT_FOUND`, por 5 min)
   * ficam guardados; qualquer outra falha não é cacheada.
   */
  get(key: string, load: () => Promise<T>, options?: GetOptions): Promise<T>;
  /** Descarta uma entrada (por exemplo, uma resposta incompleta que não deve ficar em cache). */
  delete(key: string): void;
  clear(): void;
  readonly size: number;
}

const registry = new Set<{ clear(): void }>();

/** Esvazia todos os caches criados por `createCache` (testes). */
export function clearAllCaches(): void {
  for (const cache of registry) cache.clear();
}

export function createCache<T>(options: CacheOptions): Cache<T> {
  const { ttlMs, staleIfError = false, maxEntries = CACHE_MAX_ENTRIES } = options;
  const store = new Map<string, Entry<T>>();
  const inflight = new Map<string, Promise<T>>();

  const isFresh = (entry: Entry<T>): boolean =>
    Date.now() - entry.at < ('notFound' in entry ? NEGATIVE_TTL_MS : ttlMs);

  /** Entrada vencida que ainda pode servir como cópia de emergência. */
  const isServableStale = (entry: Entry<T>): entry is { at: number; value: T; retryAt?: number } =>
    staleIfError && 'value' in entry && Date.now() - entry.at < ttlMs + STALE_RETENTION_MS;

  const isUseless = (entry: Entry<T>): boolean => !isFresh(entry) && !isServableStale(entry);

  function remember(key: string, entry: Entry<T>): void {
    if (store.size >= CACHE_SWEEP_SIZE) {
      for (const [k, old] of store) if (isUseless(old)) store.delete(k);
    }
    // Teto duro: sem entradas inúteis suficientes, descarta as mais antigas (ordem de inserção).
    while (store.size >= maxEntries) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
    store.delete(key);
    store.set(key, entry);
  }

  const cache: Cache<T> = {
    get(key, load, getOptions) {
      const allowStale = getOptions?.allowStale ?? true;
      const hit = store.get(key);
      if (hit && isFresh(hit)) {
        if ('notFound' in hit) return Promise.reject(hit.notFound);
        // LRU: leitura recente fica no fim da fila e é a última a ser descartada pelo teto.
        store.delete(key);
        store.set(key, hit);
        return Promise.resolve(hit.value);
      }
      // O TMDB acabou de falhar e já servimos a cópia: não repete a ida até passar a espera.
      if (
        allowStale &&
        hit &&
        isServableStale(hit) &&
        hit.retryAt !== undefined &&
        hit.retryAt > Date.now()
      ) {
        return Promise.resolve(hit.value);
      }
      const running = inflight.get(key);
      if (running) return running;

      const flight: { promise?: Promise<T> } = {};
      flight.promise = (async () => {
        try {
          // `Promise.resolve().then` garante que `inflight` já guarda esta promessa quando
          // `load` falha de forma síncrona.
          const value = await Promise.resolve().then(load);
          remember(key, { at: Date.now(), value });
          return value;
        } catch (error) {
          if (error instanceof AppError && error.code === 'TITLE_NOT_FOUND') {
            remember(key, { at: Date.now(), notFound: error });
          } else if (
            allowStale &&
            error instanceof AppError &&
            error.code === 'TMDB_UNAVAILABLE' &&
            hit &&
            isServableStale(hit)
          ) {
            hit.retryAt = Date.now() + STALE_RETRY_MS;
            return hit.value;
          }
          throw error;
        } finally {
          if (inflight.get(key) === flight.promise) inflight.delete(key);
        }
      })();
      inflight.set(key, flight.promise);
      return flight.promise;
    },
    delete(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
      inflight.clear();
    },
    get size() {
      return store.size;
    },
  };
  registry.add(cache);
  return cache;
}
