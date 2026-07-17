import { describe, it, expect } from "vitest";
import {
  albumKey,
  dedupeLatestScores,
  buildScoreSummary,
  namesForUser,
  getCombinedScore,
  toMemberScores,
  getMyReviewedAlbumNos,
  scoreAlbumKey,
  isSameAlbum,
  getSummaryEntry,
} from "@/lib/score-utils";
import { Score, ReleaseMasterAlbum } from "@/lib/types";

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    reviewId: "1",
    memberName: "kohei.fuku0926@gmail.com",
    score: 8,
    comment: "",
    submittedAt: "2026-01-01T00:00:00.000Z",
    albumTitle: "Album A",
    artistName: "Artist A",
    ...overrides,
  };
}

function makeAlbum(overrides: Partial<ReleaseMasterAlbum> = {}): ReleaseMasterAlbum {
  return {
    no: "1",
    uid: "uid-1",
    date: "",
    title: "Album A",
    artist: "Artist A",
    genre: "",
    genreMemo: "",
    country: "",
    mjAdoption: "",
    mjAssign: "",
    mjTrackNo: "",
    mjTrack: "",
    mjStartTime: "",
    mjText: "",
    legacyScores: [],
    spotifyUrl: "",
    coverUrl: "",
    ...overrides,
  };
}

describe("albumKey", () => {
  it("joins title and artist with :: separator", () => {
    expect(albumKey("Title", "Artist")).toBe("Title::Artist");
  });

  it("does not normalize input", () => {
    expect(albumKey(" Title ", "Artist")).toBe(" Title ::Artist");
  });
});

describe("dedupeLatestScores", () => {
  it("keeps only the latest submission per album+member (byAlbum=true default)", () => {
    const scores = [
      makeScore({ score: 5, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ score: 9, submittedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = dedupeLatestScores(scores);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(9);
  });

  it("treats different albums as distinct even for the same member", () => {
    const scores = [
      makeScore({ albumTitle: "Album A" }),
      makeScore({ albumTitle: "Album B" }),
    ];
    expect(dedupeLatestScores(scores)).toHaveLength(2);
  });

  it("is case-insensitive on memberName", () => {
    const scores = [
      makeScore({ memberName: "Kohei", submittedAt: "2026-01-01T00:00:00.000Z", score: 1 }),
      makeScore({ memberName: "KOHEI", submittedAt: "2026-01-02T00:00:00.000Z", score: 2 }),
    ];
    const result = dedupeLatestScores(scores);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(2);
  });

  it("dedupes by member only (ignoring album) when byAlbum=false", () => {
    const scores = [
      makeScore({ albumTitle: "Album A", submittedAt: "2026-01-01T00:00:00.000Z", score: 3 }),
      makeScore({ albumTitle: "Album B", submittedAt: "2026-01-02T00:00:00.000Z", score: 7 }),
    ];
    const result = dedupeLatestScores(scores, false);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(7);
  });
});

describe("buildScoreSummary", () => {
  it("aggregates avg/count/total per album", () => {
    const scores = [
      makeScore({ memberName: "a@x.com", score: 8, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ memberName: "b@x.com", score: 6, submittedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const summary = buildScoreSummary(scores);
    const entry = summary[albumKey("Album A", "Artist A")];
    expect(entry.count).toBe(2);
    expect(entry.total).toBe(14);
    expect(entry.avg).toBe(7);
  });

  it("rounds avg to 1 decimal place", () => {
    const scores = [
      makeScore({ memberName: "a@x.com", score: 7, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ memberName: "b@x.com", score: 8, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ memberName: "c@x.com", score: 8, submittedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const summary = buildScoreSummary(scores);
    const entry = summary[albumKey("Album A", "Artist A")];
    expect(entry.avg).toBe(7.7);
  });

  it("counts comment-only entries (score=null) in members but not in avg/total", () => {
    const scores = [
      makeScore({ memberName: "a@x.com", score: null, comment: "nice", submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ memberName: "b@x.com", score: 8, submittedAt: "2026-01-01T00:00:00.000Z" }),
    ];
    const summary = buildScoreSummary(scores);
    const entry = summary[albumKey("Album A", "Artist A")];
    expect(entry.members.size).toBe(2);
    expect(entry.count).toBe(1);
    expect(entry.avg).toBe(8);
    expect(entry.memberScores["a@x.com"]).toBeUndefined();
  });

  it("only counts the latest submission per member when duplicates exist", () => {
    const scores = [
      makeScore({ memberName: "a@x.com", score: 2, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ memberName: "a@x.com", score: 10, submittedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const summary = buildScoreSummary(scores);
    const entry = summary[albumKey("Album A", "Artist A")];
    expect(entry.count).toBe(1);
    expect(entry.avg).toBe(10);
  });

  it("separates albums with different title/artist keys", () => {
    const scores = [
      makeScore({ albumTitle: "Album A", artistName: "Artist A" }),
      makeScore({ albumTitle: "Album B", artistName: "Artist B", memberName: "b@x.com" }),
    ];
    const summary = buildScoreSummary(scores);
    expect(Object.keys(summary)).toHaveLength(2);
  });
});

describe("namesForUser", () => {
  it("includes the lower-cased email itself", () => {
    expect(namesForUser("Kohei.Fuku0926@gmail.com")).toContain("kohei.fuku0926@gmail.com");
  });

  it("includes the short display name in lower-case", () => {
    expect(namesForUser("kohei.fuku0926@gmail.com")).toContain("kohei");
  });

  it("includes legacy name variants mapping to the same email", () => {
    const names = namesForUser("kohei.fuku0926@gmail.com");
    expect(names).toContain("kohei fukuda");
  });

  it("returns only the email for an unknown address", () => {
    const names = namesForUser("unknown@example.com");
    expect(names).toEqual(new Set(["unknown@example.com"]));
  });
});

describe("getCombinedScore", () => {
  it("returns null avg and 0 count when there are no scores at all", () => {
    const result = getCombinedScore({ legacyScores: [] }, undefined);
    expect(result).toEqual({ avg: null, count: 0 });
  });

  it("uses only app scores when there are no legacy scores", () => {
    const result = getCombinedScore({ legacyScores: [] }, { "a@x.com": 8, "b@x.com": 6 });
    expect(result).toEqual({ avg: 7, count: 2 });
  });

  it("uses only legacy scores when there are no app scores", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "8" }, { name: "Meri", value: "6" }] },
      undefined
    );
    expect(result).toEqual({ avg: 7, count: 2 });
  });

  it("prioritizes legacy score and excludes the matching member's app score", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "10" }] },
      { "kohei.fuku0926@gmail.com": 2, "meri": 6 }
    );
    // legacy Kohei(10) covers kohei.fuku0926@gmail.com's app score; meri's app score(6) is added
    expect(result).toEqual({ avg: 8, count: 2 });
  });

  it("adds app scores for members not covered by legacy", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "10" }] },
      { "eddie": 4 }
    );
    expect(result).toEqual({ avg: 7, count: 2 });
  });

  it("ignores legacy score values out of the 0-10 range", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "11" }, { name: "Meri", value: "-1" }] },
      { "eddie": 4 }
    );
    expect(result).toEqual({ avg: 4, count: 1 });
  });

  it("parses legacy score values with trailing comments", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "7.5 良かった" }] },
      undefined
    );
    expect(result).toEqual({ avg: 7.5, count: 1 });
  });

  it("ignores unparseable legacy score values", () => {
    const result = getCombinedScore(
      { legacyScores: [{ name: "Kohei", value: "N/A" }] },
      { "eddie": 4 }
    );
    expect(result).toEqual({ avg: 4, count: 1 });
  });
});

describe("toMemberScores", () => {
  it("maps memberName(lower-case) to score", () => {
    const scores = [
      makeScore({ memberName: "Kohei", score: 8 }),
      makeScore({ memberName: "Meri", score: 6 }),
    ];
    expect(toMemberScores(scores)).toEqual({ kohei: 8, meri: 6 });
  });

  it("excludes comment-only entries (score=null)", () => {
    const scores = [
      makeScore({ memberName: "Kohei", score: null }),
      makeScore({ memberName: "Meri", score: 6 }),
    ];
    expect(toMemberScores(scores)).toEqual({ meri: 6 });
  });
});

describe("getMyReviewedAlbumNos", () => {
  it("includes albums with an app score/comment from the user", () => {
    const albums = [makeAlbum({ no: "1", title: "Album A", artist: "Artist A" })];
    const scores = [
      makeScore({ memberName: "kohei.fuku0926@gmail.com", albumTitle: "Album A", artistName: "Artist A" }),
    ];
    const result = getMyReviewedAlbumNos(albums, scores, "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set(["1"]));
  });

  it("includes comment-only entries (score=null) as reviewed", () => {
    const albums = [makeAlbum({ no: "1", title: "Album A", artist: "Artist A" })];
    const scores = [
      makeScore({
        memberName: "kohei.fuku0926@gmail.com",
        score: null,
        comment: "listened",
        albumTitle: "Album A",
        artistName: "Artist A",
      }),
    ];
    const result = getMyReviewedAlbumNos(albums, scores, "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set(["1"]));
  });

  it("includes albums where the user has a legacy score", () => {
    const albums = [
      makeAlbum({ no: "2", title: "Album B", artist: "Artist B", legacyScores: [{ name: "Kohei", value: "8" }] }),
    ];
    const result = getMyReviewedAlbumNos(albums, [], "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set(["2"]));
  });

  it("matches legacy scores via short-name/email/legacy-name aliases", () => {
    const albums = [
      makeAlbum({ no: "3", title: "Album C", artist: "Artist C", legacyScores: [{ name: "kohei fukuda", value: "9" }] }),
    ];
    const result = getMyReviewedAlbumNos(albums, [], "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set(["3"]));
  });

  it("does not include albums reviewed only by other members", () => {
    const albums = [makeAlbum({ no: "1", title: "Album A", artist: "Artist A" })];
    const scores = [
      makeScore({ memberName: "akyme68@gmail.com", albumTitle: "Album A", artistName: "Artist A" }),
    ];
    const result = getMyReviewedAlbumNos(albums, scores, "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set());
  });
});

// ── UIDフェーズ2: albumUid 優先マッチング ──────────────────────────────

describe("scoreAlbumKey", () => {
  it("uses uid:: key when albumUid is present", () => {
    expect(scoreAlbumKey(makeScore({ albumUid: "abc123" }))).toBe("uid::abc123");
  });

  it("falls back to title::artist when albumUid is empty", () => {
    expect(scoreAlbumKey(makeScore({ albumUid: "" }))).toBe("Album A::Artist A");
    expect(scoreAlbumKey(makeScore())).toBe("Album A::Artist A");
  });
});

describe("isSameAlbum", () => {
  it("matches by uid when both sides have one, even if titles differ (rename)", () => {
    const album = makeAlbum({ uid: "abc123", title: "New Title" });
    expect(isSameAlbum(album, { albumUid: "abc123", albumTitle: "Old Title", artistName: "Artist A" })).toBe(true);
  });

  it("does not match different uids even if titles are identical", () => {
    const album = makeAlbum({ uid: "abc123" });
    expect(isSameAlbum(album, { albumUid: "zzz999", albumTitle: "Album A", artistName: "Artist A" })).toBe(false);
  });

  it("falls back to title+artist when the row has no uid", () => {
    const album = makeAlbum({ uid: "abc123" });
    expect(isSameAlbum(album, { albumTitle: "Album A", artistName: "Artist A" })).toBe(true);
    expect(isSameAlbum(album, { albumUid: "", albumTitle: "Album A", artistName: "Artist A" })).toBe(true);
    expect(isSameAlbum(album, { albumTitle: "Other", artistName: "Artist A" })).toBe(false);
  });

  it("falls back to title+artist when the album has no uid", () => {
    const album = makeAlbum({ uid: "" });
    expect(isSameAlbum(album, { albumUid: "abc123", albumTitle: "Album A", artistName: "Artist A" })).toBe(true);
  });
});

describe("getSummaryEntry", () => {
  it("finds the entry via uid key after the album was renamed", () => {
    const scores = [makeScore({ albumUid: "abc123", albumTitle: "Old Title" })];
    const summary = buildScoreSummary(scores);
    const album = makeAlbum({ uid: "abc123", title: "New Title" });
    expect(getSummaryEntry(summary, album)?.avg).toBe(8);
  });

  it("falls back to title::artist key for scores without uid", () => {
    const scores = [makeScore({ albumUid: "" })];
    const summary = buildScoreSummary(scores);
    const album = makeAlbum({ uid: "abc123" });
    expect(getSummaryEntry(summary, album)?.avg).toBe(8);
  });

  it("returns undefined when neither key matches", () => {
    const summary = buildScoreSummary([makeScore({ albumUid: "other" })]);
    const album = makeAlbum({ uid: "abc123", title: "X", artist: "Y" });
    expect(getSummaryEntry(summary, album)).toBeUndefined();
  });
});

describe("dedupeLatestScores with albumUid", () => {
  it("treats rows with the same uid but different titles as the same album", () => {
    const scores = [
      makeScore({ albumUid: "abc123", albumTitle: "Old Title", score: 5, submittedAt: "2026-01-01T00:00:00.000Z" }),
      makeScore({ albumUid: "abc123", albumTitle: "New Title", score: 9, submittedAt: "2026-01-02T00:00:00.000Z" }),
    ];
    const result = dedupeLatestScores(scores);
    expect(result).toHaveLength(1);
    expect(result[0].score).toBe(9);
  });
});

describe("getMyReviewedAlbumNos with albumUid", () => {
  it("resolves the album by uid even after a rename", () => {
    const albums = [makeAlbum({ no: "1", uid: "abc123", title: "New Title" })];
    const scores = [makeScore({ albumUid: "abc123", albumTitle: "Old Title" })];
    const result = getMyReviewedAlbumNos(albums, scores, "kohei.fuku0926@gmail.com");
    expect(result).toEqual(new Set(["1"]));
  });
});
