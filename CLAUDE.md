# ryuryu-music

音楽グループ（6人）のアルバムレビューアプリ。Next.js 16 (Turbopack) + React 19 + next-auth v5 + Google Sheets + Spotify API + Vercel。

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
  - `scores` シート: A=reviewId, B=memberName(email), C=score, D=comment, E=submittedAt, F=albumTitle, G=artistName, H=albumUid
  - `recommendations` シート: A=id, B=recommenderId, C=albumNo, D=albumTitle, E=artistName, F=coverUrl, G=message, H=createdAt, I=mentionedEmails(カンマ区切り), J=albumUid
  - `bookmarks` シート: A=memberName(email), B=albumTitle, C=artistName, D=savedAt, E=albumUid
  - アルバム紐付けは **albumUid（Release MasterのUID）優先、title+artistフォールバック**（2026-07-18〜）。albumUidが空の行は移行前の孤児データか手動追加行 → `scripts/backfill-album-uids.ts` の再実行で埋められる（冪等）
- **Release Master**: `RELEASE_MASTER_SPREADSHEET_ID`
  - A=No., B=Date, C=Title, D=Artist, E=Body, F=洋邦, G=Time, H=#, I=リスナー, Q=M/J採用, R=ASSIGN, S=M Number, T=Track, U=Start Time, V=M/J採用（220-300）, X=Kwisoo, Y=Meri, Z=Kohei, AA=Eddie, AB=Hanawa, AC=Kaede, AD=Spotify, AE=spotifyカバー

## 主要ファイル

- `lib/members.ts` — メンバーのemail↔表示名マッピング
- `lib/sheets.ts` — Sheets API ラッパー（scores/recommendations CRUD）
- `lib/release-master.ts` — Release Master への書き込み
- `lib/sheet-headers.ts` — 列名定数（`SHEET_COL`）と動的ヘッダー解決ユーティリティ
- `lib/score-utils.ts` — スコア集計の共通ロジック（最新絞り込み・legacy優先マージ・レビュー済み判定）
- `lib/api-cache.ts` — GET APIのin-memoryキャッシュ（書き込みルートで `invalidateCache` を呼ぶこと）
- `lib/uid.ts` / UID列 — アルバムの安定ID（改名に耐える行識別子。`scripts/assign-uids.ts` で採番）
- `lib/ops/` — メンテ処理のコアロジック（scripts/ と app/api/admin/ の両方から呼ばれる共通実装）
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
| `repair-spotify.ts` | Spotify URL修復（画像URLが誤入力されている行を修正） |
| `refetch-spotify.ts` | Spotify URL空行の再取得（名前不一致はMISMATCHアラート） |
| `assign-uids.ts` | Release Master のUID列採番（dry-run / --apply、冪等） |
| `backfill-album-uids.ts` | scores/bookmarks/recommendations にRMのUIDを紐付け（dry-run / --apply、冪等） |

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

## 画像ジェネレーターのUI引き継ぎ

ジェネレーター一式は2026-09-07にブランチ `wip/generator-integration`（commit `7453325`）へ退避済み。`main` は `a9ae701` のまま統合していないので、`git status` が空でも作業が無い意味にはならない。現在地は `git log --oneline main..HEAD` で確認する。ローカル `main` は `origin/main` より6コミット遅れているため、統合時は差分解消が必要。

Monthly／Japan画像ジェネレーターの機能版は`app/generator/`に実装済み。ページ遷移・情報設計・UI／ビジュアルデザインを変更する前に、[Claude Code向け引き継ぎプロンプト](docs/claude-generator-ui-handoff.md)を**最初から最後まで読み**、そこからリンクされた操作仕様・共有保存契約・UI実装記録も確認すること。引き継ぎには、初回UI変更で失われかけた機能と2026-09-07の受入で復元した機能がまとまっている。

本文は天地左右25pxを確保し、複数行の行送りを利用可能な高さまで自動最大化するのが既定。最小行送りは28pxで、収まらない場合は警告してPNG生成を止める。この描画結果、`bodyLeadMode`／`bodyMaxLead`の保存契約、既存文書を自動として扱う互換性はUI変更でも維持する。API・DB・適用済みマイグレーションの変更が必要な場合は独断で変更せず、理由・案・影響範囲をCodexへの引き継ぎ事項として残す。

特に、Timeの空欄補完、字間・行送りの直接数値入力と`Mixed`表示、作品・背景の自動ロック取得と対象別version保存、プレビューからのおすすめ曲番号／曲名の個別選択、保存再送の`requestId`維持、heartbeat競合防止、並び順を含むローカル復旧、stickyと非表示タブでの画像準備は完成済み機能として維持する。「作品を編集」「背景を編集」の開始ボタンは再追加しない。

## 注意事項

- `scores` シートの `memberName` は email で管理（旧来の短縮名はレガシー）
- Release Master への書き込みは `SHEET_COL` 定数で列名解決（列移動に耐性あり）
- Spotify API レート制限: スクリプトは1件あたり300〜500ms のsleep を挟む
