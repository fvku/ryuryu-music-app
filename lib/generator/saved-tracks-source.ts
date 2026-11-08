import "server-only";
import { clearTokenCache, getAccessToken } from "@/lib/spotify";
import { GeneratorError } from "./errors";
import { parsePlaylistItems, SAVED_TRACKS_PLAYLIST_ID, type SavedTrack } from "./saved-tracks";

const PAGE_SIZE = 100;
/** 際限なくページを送らないための歯止め */
const MAX_TRACKS = 2000;
const FIELDS = "total,items(added_at,track(id,name,type,is_local,artists(name),album(images)))";

function unavailable(): never {
  throw new GeneratorError("SPOTIFY_UNAVAILABLE", 502, "Spotifyからプレイリストを読み込めませんでした。少し待ってもう一度お試しください。");
}

async function fetchPage(offset: number, retryToken = true): Promise<{ total: number; items: unknown[] }> {
  const url = `https://api.spotify.com/v1/playlists/${SAVED_TRACKS_PLAYLIST_ID}/tracks`
    + `?limit=${PAGE_SIZE}&offset=${offset}&fields=${encodeURIComponent(FIELDS)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` }, cache: "no-store" });
  if (response.status === 401 && retryToken) {
    clearTokenCache();
    return fetchPage(offset, false);
  }
  if (!response.ok) unavailable();
  const body = await response.json() as { total?: number; items?: unknown[] };
  return { total: body.total ?? 0, items: body.items ?? [] };
}

/** プレイリストの全曲を、プレイリストの並びのまま返す。自分たちの公開プレイリストなので公式APIで読める。 */
export async function fetchSavedTracks(): Promise<SavedTrack[]> {
  const items: unknown[] = [];
  try {
    for (let offset = 0; offset < MAX_TRACKS; offset += PAGE_SIZE) {
      const page = await fetchPage(offset);
      items.push(...page.items);
      if (page.items.length < PAGE_SIZE || items.length >= page.total) break;
    }
  } catch (error) {
    if (error instanceof GeneratorError) throw error;
    unavailable();
  }
  return parsePlaylistItems(items);
}
