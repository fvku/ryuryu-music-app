export interface SpotifyAlbum {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  releaseYear: string;
  releaseDate: string;
  albumType: string; // Spotify album_type: "album" | "single" | "compilation"
  spotifyUrl: string;
}

export interface ReleaseMasterAlbum {
  no: string;
  uid: string;        // UID column — 改名に耐える安定ID（空の行もありうる）
  date: string;
  title: string;
  artist: string;
  genre: "邦楽" | "洋楽" | "";
  duration: string;   // Time column (G) — 曲数・総尺。例: "9songs, 29min 9sec"
  weekNumber: string; // # column (H) — Weeklyの週番号（土曜〜金曜）
  genreMemo: string;  // genre/memo column (K)
  country: string;    // 国 column (L)
  weekAdoption: string; // WEEK column (O): 採用／掲載／不採用
  mjAdoption: string; // M/J採用 column (Q=16)
  mjAssign: string;   // ASSIGN column (R=17)
  mjTrackNo:   string;  // M Number column (S=18)
  mjTrack:     string;  // Track column (T=19)
  mjStartTime: string;  // Start Time column (U=20)
  mjText:      string;  // M/J採用（220−300）column (V=21)
  legacyScores: { name: string; value: string }[]; // Kwisoo, Meri, Kohei, Eddie, Hanawa
  spotifyUrl: string; // AB column
  coverUrl: string;   // AC column（spotifyカバー。640×640）
  coverUrlLarge: string; // 画像リンク変換 column（Apple Music。2000×2000）。空の行もありうる
}

export interface Score {
  reviewId: string; // = albumNo
  memberName: string;
  score: number | null;
  comment: string;
  submittedAt: string;
  albumTitle?: string;
  artistName?: string;
  albumUid?: string; // Release MasterのUID。空の行（移行前の孤児等）はtitle+artistで照合
}

export interface AlbumWithScores extends ReleaseMasterAlbum {
  scores: Score[];
  averageScore: number | null;
}
