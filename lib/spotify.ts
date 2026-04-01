import { SpotifyAlbum } from "./types";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.accessToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Spotify API credentials are not configured");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Spotify access token: ${errorText}`);
  }

  const data = await response.json();

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return tokenCache.accessToken;
}

export async function searchAlbums(query: string): Promise<SpotifyAlbum[]> {
  const accessToken = await getAccessToken();

  const params = new URLSearchParams({
    q: query,
    type: "album",
    limit: "8",
    market: "JP",
  });

  const response = await fetch(`https://api.spotify.com/v1/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spotify search failed: ${errorText}`);
  }

  const data = await response.json();

  const albums: SpotifyAlbum[] = data.albums.items.map(
    (item: {
      id: string;
      name: string;
      artists: { name: string }[];
      images: { url: string; width: number; height: number }[];
      release_date: string;
      external_urls: { spotify: string };
    }) => {
      const coverUrl =
        item.images && item.images.length > 0
          ? item.images[0].url
          : "";

      const releaseYear = item.release_date
        ? item.release_date.substring(0, 4)
        : "不明";

      return {
        id: item.id,
        name: item.name,
        artist: item.artists.map((a: { name: string }) => a.name).join(", "),
        coverUrl,
        releaseYear,
        spotifyUrl: item.external_urls.spotify,
      };
    }
  );

  return albums;
}
