export const SPOTIFY_BATCH_LIMIT_OPTIONS = [10, 20, 30, 50, 100] as const;
export const DEFAULT_SPOTIFY_BATCH_LIMIT = 30;
export const MAX_SPOTIFY_BATCH_LIMIT = 100;

export function parseSpotifyBatchLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_SPOTIFY_BATCH_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_SPOTIFY_BATCH_LIMIT) return null;
  return value;
}
