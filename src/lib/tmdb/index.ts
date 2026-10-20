import { config } from '../../config.js';
import { AppError } from '../../http/app-error.js';
import { createHttpTmdbClient } from './client.js';
import type { TmdbClient } from './types.js';

export { createHttpTmdbClient, DEFAULT_TMDB_BASE_URL } from './client.js';
export type * from './types.js';

/** Cliente de quando não há `TMDB_API_KEY`: toda chamada vira 503 `TMDB_UNAVAILABLE`. */
export const unconfiguredTmdbClient: TmdbClient = {
  getPopularMovies: () => Promise.reject(new AppError('TMDB_UNAVAILABLE', 'TMDB não configurado.')),
  search: () => Promise.reject(new AppError('TMDB_UNAVAILABLE', 'TMDB não configurado.')),
  getTitle: () => Promise.reject(new AppError('TMDB_UNAVAILABLE', 'TMDB não configurado.')),
  getSeason: () => Promise.reject(new AppError('TMDB_UNAVAILABLE', 'TMDB não configurado.')),
  getProviders: () => Promise.reject(new AppError('TMDB_UNAVAILABLE', 'TMDB não configurado.')),
};

let current: TmdbClient | undefined;

/** Cliente em uso: o injetado (testes) ou o HTTP criado da config na primeira chamada. */
export function getTmdb(): TmdbClient {
  current ??= config.TMDB_API_KEY
    ? createHttpTmdbClient({
        apiKey: config.TMDB_API_KEY,
        ...(config.TMDB_BASE_URL ? { baseUrl: config.TMDB_BASE_URL } : {}),
      })
    : unconfiguredTmdbClient;
  return current;
}

/** Injeta um cliente (fake nos testes); `undefined` volta ao cliente da config. */
export function setTmdbClient(client: TmdbClient | undefined): void {
  current = client;
}
