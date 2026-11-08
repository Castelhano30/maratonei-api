/**
 * Nota do TMDB (0 a 10) como a API a publica: uma casa decimal, ou `null` quando não há votos
 * (o TMDB devolve 0 para título sem votos, o que não é uma nota).
 */
export function toPublicRating(
  voteAverage: number | null | undefined,
  voteCount: number | null | undefined,
): number | null {
  if (voteAverage == null || !voteCount || voteCount <= 0) return null;
  return Math.round(voteAverage * 10) / 10;
}
