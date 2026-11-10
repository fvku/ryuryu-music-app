/**
 * Spotifyのアルバム収録曲を全ページ読む。/v1/albums/{id}/tracks は1回50曲までで、
 * それ以上は next を辿る必要がある（ボックスセット・デラックス版で取りこぼしていた）。
 * 複数枚組は各ディスクに「1曲目」があるので、曲の識別には uri を使い disc_number も返す。
 */

export interface SpotifyAlbumTrackItem {
  track_number: number;
  disc_number?: number;
  name: string;
  duration_ms: number;
  uri: string;
}

export interface SpotifyPage {
  items?: SpotifyAlbumTrackItem[];
  next?: string | null;
}

/** 念のための上限。50曲×40ページ＝2000曲 */
const MAX_PAGES = 40;

type FetchPage = (url: string) => Promise<SpotifyPage>;

/** first（アルバム詳細に同梱の tracks など）から始めて next を最後まで辿る */
export async function collectAllTrackItems(first: SpotifyPage, fetchPage: FetchPage): Promise<SpotifyAlbumTrackItem[]> {
  const items = [...(first.items ?? [])];
  let next = first.next ?? null;
  for (let i = 0; next && i < MAX_PAGES; i++) {
    const page = await fetchPage(next);
    items.push(...(page.items ?? []));
    next = page.next ?? null;
  }
  return items;
}

export function bearerPageFetcher(accessToken: string): FetchPage {
  return async (url) => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
    if (!res.ok) throw new Error(`Spotify API error: ${res.status}`);
    return res.json();
  };
}

export function toAppTrack(t: SpotifyAlbumTrackItem) {
  return {
    trackNumber: t.track_number,
    discNumber: t.disc_number ?? 1,
    name: t.name,
    durationMs: t.duration_ms,
    uri: t.uri,
  };
}
