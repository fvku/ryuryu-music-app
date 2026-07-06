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
  uid: string;        // UID column — 改名に耐える安定ID（空の行もありうる）
  date: string;
  title: string;
  artist: string;
  genre: "邦楽" | "洋楽" | "";
  genreMemo: string;  // genre/memo column (K)
  country: string;    // 国 column (L)
  mjAdoption: string; // M/J採用 column (Q=16)
  mjAssign: string;   // ASSIGN column (R=17)
  mjTrackNo:   string;  // M Number column (S=18)
  mjTrack:     string;  // Track column (T=19)
  mjStartTime: string;  // Start Time column (U=20)
  mjText:      string;  // M/J採用（220−300）column (V=21)
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
