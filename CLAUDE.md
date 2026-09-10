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
  - `playlists` シート: A=playlistId, B=label, C=enabled, D=addedAt（プレイリスト収録タグの取得対象。管理画面から追加・削除）
  - アルバム紐付けは **albumUid（Release MasterのUID）優先、title+artistフォールバック**（2026-07-18〜）。albumUidが空の行は移行前の孤児データか手動追加行 → `scripts/backfill-album-uids.ts` の再実行で埋められる（冪等）
- **Release Master**: `RELEASE_MASTER_SPREADSHEET_ID`
  - A=No., B=Date, C=Title, D=Artist, E=Body, F=洋邦, G=Time, H=#, I=リスナー, K=playlist, L=genre/memo, M=国, P=WEEK, R=M/J採用, S=ASSIGN, T=M Number, U=Track, V=Start Time, W=M/J採用（220-300）, Y=Kwisoo, Z=Meri, AA=Kohei, AB=Eddie, AC=Hanawa, AD=Kaede, AF=Spotify, AG=spotifyカバー（640×640）, AJ=UID
  - 列位置は 2026-09-11 に playlist を K 列へ移動した時点のもの。コードはヘッダー名で解決するため、移動しても壊れない
  - `画像リンク変換` = Apple Music のカバー画像URL（2000×2000）。列位置は可変なのでヘッダー名で解決する。`spotifyカバー` より充足率が高く、高解像度が要る用途（monthly-generator）はこちらを使う

## 主要ファイル

- `lib/members.ts` — メンバーのemail↔表示名マッピング
- `lib/sheets.ts` — Sheets API ラッパー（scores/recommendations CRUD）
- `lib/release-master.ts` — Release Master への書き込み
- `lib/sheet-headers.ts` — 列名定数（`SHEET_COL`）と動的ヘッダー解決ユーティリティ
- `lib/score-utils.ts` — スコア集計の共通ロジック（最新絞り込み・legacy優先マージ・レビュー済み判定）
- `lib/api-cache.ts` — GET APIのin-memoryキャッシュ（書き込みルートで `invalidateCache` を呼ぶこと）
- `lib/uid.ts` / UID列 — アルバムの安定ID（改名に耐える行識別子。`scripts/assign-uids.ts` で採番）
- `lib/ops/` — メンテ処理のコアロジック（scripts/ と app/api/admin/ の両方から呼ばれる共通実装）
- `lib/playlist-sources.ts` — プレイリスト収録タグの取得対象（`playlists` シートのCRUD）
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
| `sync-playlist-tags.ts` | 登録プレイリストの収録曲からRMの`playlist`列を更新（dry-run / --apply / --init-column） |

### fill-time-tracks.ts のオプション

```bash
npx tsx scripts/fill-time-tracks.ts                        # dry-run（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply                # 書き込み（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply --force        # 全行上書き
npx tsx scripts/fill-time-tracks.ts --apply --force --from-row=915  # 指定行以降のみ
```

書き込み形式: `13songs, 50min 4sec`

## 管理画面の認可

`/admin` と `/api/admin/*` は Google ログインで認可する（2026-09-11に管理者パスワードから移行）。

- 判定は3段構え: 同一オリジンか → Googleログイン済みの許可メンバーか → 管理者か
- 管理者は `ADMIN_EMAILS`（カンマ区切り）。未設定なら Kohei のみ
- 実装は `lib/admin-auth.ts` の `guardAdmin(req, action, detail)`。各ルートの先頭で呼ぶ
- 実行者と操作は `admin_logs` シート（A=timestamp, B=email, C=action, D=result, E=detail）に追記
- 権限不足のログだけ記録する。未ログインや外部オリジンからの呼び出しは誰でも起こせるので残さない
- `ADMIN_PASSWORD` は未使用（Vercelの環境変数から削除してよい）

## プレイリスト収録タグ

Release Master の `playlist` 列に「そのアルバムがどの有名プレイリストに入っているか」を自動で書き込む。

- Spotify公式（エディトリアル）プレイリストは Web API から読めない。アプリが Development mode のため 404 になる（Client Credentials でもユーザー認可トークンでも同じ。2026-09-09に実測）
- そのため収録曲一覧は**埋め込みページ**（`open.spotify.com/embed/playlist/<id>`）から取得する。曲→アルバムの解決は公式API（`/v1/tracks`）
- 取得上限は各プレイリスト100曲。新しい順に並ぶのでおよそ直近1か月分をカバーする
- 判定基準は「そのアーティストの曲が1曲でも入っているか」。アルバム自体が入っている必要はない（2026-09-11に変更）。先行シングルはアルバム版と別トラック・別アルバムIDになるため、アルバム単位の照合だけだと同じ曲でも取りこぼす
- 照合は Spotify の**アーティストID**で行う。名前だと表記揺れ（石若駿 / Shun Ishiwaka）や「Blu & Sndtrak」のような&入りの名義で外れる。Release Master 側は対象行のアルバムを `/v1/albums`（20件ずつ）で引いてIDを得る。Spotify URL が無い行だけアーティスト名で照合する
- 客演も1曲として数える。アルバムに共演者がクレジットされていれば、その共演者の別作品の曲でもタグが付く
- コンピレーション名義（Various Artists）は照合から外す
- アルバムID・アルバム名+アーティスト名の照合も残している。アルバムIDは market 指定あり／なしの両方を索引に入れる（Track Relinkingでズレるため）
- 書き込みは**追記**。既存の名前は消さない（100曲の窓から外れたプレイリストのタグを失わないため）。誤ったタグは手でセルを編集する
- 収録曲の取得は並列、アルバム解決は全プレイリスト分をまとめて直列（公式APIを並列で叩くと429になる）
- 対象は既定で**当月のみ**（Date列の "YYYY/MM" 前方一致）。管理画面の「対象月」で変更、CLIは `--month=2026/08` / `--all`。プレイリスト側の取得量は月を絞っても変わらない
- 取得対象は管理画面（週次リリース処理タブ）から追加・削除する。`genre/memo` 列には触れない

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
