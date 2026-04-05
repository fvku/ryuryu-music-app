export interface SpotifyAlbum {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  releaseYear: string;
  spotifyUrl: string;
}

export interface ReleaseMasterAlbum {
  no: string;
  date: string;
  title: string;
  artist: string;
  genre: "邦楽" | "洋楽" | "";
  mjAdoption: string; // M/J採用 column (Q)
  mjTrackNo: string;  // M Number column (R)
  mjTrack: string;    // Track column (S)
  mjText: string;     // M/J採用（220−300）column (T)
  legacyScores: { name: string; value: string }[]; // Kwisoo, Meri, Kohei, Eddie, Hanawa
  spotifyUrl: string; // AB column
  coverUrl: string;   // AC column
}

export interface Score {
  reviewId: string; // = albumNo
  memberName: string;
  score: number | null;
  comment: string;
  submittedAt: string;
  albumTitle?: string;
  artistName?: string;
}

export interface AlbumWithScores extends ReleaseMasterAlbum {
  scores: Score[];
  averageScore: number | null;
}
