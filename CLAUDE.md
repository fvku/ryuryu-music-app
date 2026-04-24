# ryuryu-music

音楽グループ（6人）のアルバムレビューアプリ。Next.js 14 + Google Sheets + Spotify API + Vercel。

## メンバー

| 名前 | メール |
|---|---|
| Kohei | kohei.fuku0926@gmail.com |
| Meri | akyme68@gmail.com |
| Hanawa | yoshinorihnw@gmail.com |
| Eddie | edwardcannell93@gmail.com |
| Kwisoo | kwisoo1102@gmail.com |
| Kaede | qururiquiqui@gmail.com |

## データソース

- **Google Sheets（アプリ用）**: `GOOGLE_SPREADSHEET_ID`
  - `scores` シート: A=reviewId, B=memberName(email), C=score, D=comment, E=submittedAt, F=albumTitle, G=artistName
  - `recommendations` シート: A=id, B=recommenderId, C=albumNo, D=albumTitle, E=artistName, F=coverUrl, G=message, H=createdAt, I=mentionedEmails(カンマ区切り)
- **Release Master**: `RELEASE_MASTER_SPREADSHEET_ID`
  - A=No., B=Date, C=Title, D=Artist, E=Body, F=洋邦, G=Time, H=#, I=リスナー, Q=M/J採用, R=ASSIGN, S=M Number, T=Track, U=M/J採用（220-300）, W=Kwisoo, X=Meri, Y=Kohei, Z=Eddie, AA=Hanawa, AB=Kaede, AD=Spotify, AE=spotifyカバー

## 主要ファイル

- `lib/members.ts` — メンバーのemail↔表示名マッピング
- `lib/sheets.ts` — Sheets API ラッパー（scores/recommendations CRUD）
- `lib/release-master.ts` — Release Master への書き込み
- `lib/sheet-headers.ts` — 列名定数（`SHEET_COL`）と動的ヘッダー解決ユーティリティ
- `lib/spotify.ts` — Spotify API クライアント
- `app/page.tsx` — ホーム（アルバム一覧、フィルター）
- `app/recommend/page.tsx` — タイムライン（レコメンド＋レビュー）
- `app/mypage/page.tsx` — マイページ（saved/foryou/reviewed タブ）
- `components/ReviewModal.tsx` — アルバムクリック時のモーダル（メインUI）

## スクリプト一覧（scripts/）

| ファイル | 用途 |
|---|---|
| `check-headers.ts` | Release Master の全列名を表示 |
| `fill-time-tracks.ts` | Time列(G)・#列(H)をSpotifyから補完 |
| `migrate-kaede-email.ts` | メールアドレス移行（dry-run / --apply） |
| `sync-scores-to-rm.ts` | scoresシート→Release Master スコア同期 |
| `dedup-scores-normalized.ts` | scoresシートの重複除去 |
| `repair-spotify.ts` | Spotify URL修復 |

### fill-time-tracks.ts のオプション

```bash
npx tsx scripts/fill-time-tracks.ts                        # dry-run（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply                # 書き込み（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply --force        # 全行上書き
npx tsx scripts/fill-time-tracks.ts --apply --force --from-row=915  # 指定行以降のみ
```

書き込み形式: `13songs, 50min 4sec`

## フィルター状態の永続化（localStorage）

| ページ | キー |
|---|---|
| ホーム | `ryuryu_home_filters` |
| タイムライン | `ryuryu_timeline_filters` |
| マイページ | `ryuryu_mypage_filters` |

初期化完了フラグ（`filtersInitialized`）で、デフォルト値による上書きを防止。

## デプロイ

- GitHub `main` ブランチへのプッシュで Vercel が自動デプロイ
- リポジトリ: `https://github.com/fvku/ryuryu-music-app`
- dev サーバー: `npm run dev`（デフォルト3000、または `-- --port 3456`）

## 注意事項

- `scores` シートの `memberName` は email で管理（旧来の短縮名はレガシー）
- Release Master への書き込みは `SHEET_COL` 定数で列名解決（列移動に耐性あり）
- Spotify API レート制限: スクリプトは1件あたり300〜500ms のsleep を挟む
