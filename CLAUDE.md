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
  - `scores` シート: A=reviewId, B=memberName(email), C=score, D=comment, E=submittedAt, F=albumTitle, G=artistName, H=albumUid, I=requestId（投稿の再送で二重登録しないための操作ID。2026-11-10〜）
  - `sync_review` シート: レビュー同期の確認待ち（`lib/ops/review-sync.ts` が毎回作り直す。手で触らない）。管理画面の保守タブで解消する
  - `sync_pending` シート: 旧同期の待機リスト。2026-11-10の作り直しで使わなくなった（データは残している）
  - `recommendations` シート: A=id, B=recommenderId, C=albumNo, D=albumTitle, E=artistName, F=coverUrl, G=message, H=createdAt, I=mentionedEmails(カンマ区切り), J=albumUid
  - `bookmarks` シート: A=memberName(email), B=albumTitle, C=artistName, D=savedAt, E=albumUid
  - `playlists` シート: A=playlistId, B=label, C=enabled, D=addedAt（プレイリスト収録タグの取得対象。管理画面から追加・削除）
  - `playlist_archive` シート: A=playlistId, B=label, C=kind, D=key, E=name, F=months, G=firstSeenAt, H=lastSeenAt（プレイリスト収録の観測履歴。`lib/ops/playlist-archive.ts` が自動更新するので手で触らない）
  - **Release Master を一部の列だけ選んで並べ替えない。** 右端のUID列が行とずれ、アプリのレビューが別の作品に付く（2026-11-10に本番で発生。`scripts/repair-album-uids.ts` で修復）。並べ替えるときは全列を選ぶ
- アルバム紐付けは **albumUid（Release MasterのUID）優先、title+artistフォールバック**（2026-07-18〜）。albumUidが空の行は移行前の孤児データか手動追加行 → `scripts/backfill-album-uids.ts` の再実行で埋められる（冪等）
- **Release Master**: `RELEASE_MASTER_SPREADSHEET_ID`
  - A=No., B=Date, C=Title, D=Artist, E=Body, F=洋邦, G=Time, H=#, I=リスナー, K=memo（旧playlist）, L=genre（旧genre/memo）, M=国, P=WEEK, R=M/J採用, S=ASSIGN, T=M Number, U=Track, V=Start Time, W=M/J採用（220-300）, Y=Kwisoo, Z=Meri, AA=Kohei, AB=Eddie, AC=Hanawa, AD=Kaede, AF=Spotify, AG=spotifyカバー（640×640）, AJ=UID
  - 列位置は 2026-09-11 に playlist を K 列へ移動した時点のもの。コードはヘッダー名で解決するため、移動しても壊れない
  - K/L列は 2026-09-18 に見出しを「playlist」→「memo」「genre/memo」→「genre」へ改名した（データの意味は変わらない。K=収録プレイリスト名＋手動メモ、L=手入力ジャンル）。`lib/sheet-headers.ts` の `buildHeaderMap` が新旧どちらの見出しでも解決するので、改名前後どちらの状態でもコードは動く
  - `読み` = 任意の列（無くてよい）。ジェネレーターで同じ日付の作品をあいうえお順に並べるときのアーティスト名の読み。空なら辞書（kuromoji）で推定するので、読み違えた行だけ書けばよい
  - `画像リンク変換` = Apple Music のカバー画像URL（2000×2000）。列位置は可変なのでヘッダー名で解決する。`spotifyカバー` より充足率が高く、高解像度が要る用途（monthly-generator）はこちらを使う

## 主要ファイル

- `lib/members.ts` — メンバーのemail↔表示名マッピング
- `lib/sheets.ts` — Sheets API ラッパー（scores/recommendations CRUD）
- `lib/release-master.ts` — Release Master への書き込み
- `lib/sheet-headers.ts` — 列名定数（`SHEET_COL`）と動的ヘッダー解決ユーティリティ
- `lib/score-utils.ts` — スコア集計の共通ロジック（最新絞り込み・legacy優先マージ・レビュー済み判定）
- `lib/api-cache.ts` — GET APIのin-memoryキャッシュ（書き込みルートで `invalidateCache` を呼ぶこと）
- `lib/cron-status.ts` — 定期実行ログの成否・未記録・36時間経過の判定と、AI向け報告文の生成
- `lib/cron-status-store.ts` — `admin_logs` のA〜D列を読み取り専用で取得し、定期実行の状況を集計
- `app/admin/operations` — 定期実行3件の状況・履歴の表示と、AIへの報告文コピー画面
- `scripts/check-cron-status.ts` — Claude・Codex共用の読み取り専用確認コマンド（`--json` 対応）
- `lib/members.ts` — メンバー6人の唯一の定義（`EMAIL_TO_SHORT_NAME`・`MEMBER_SHORT_NAMES`＝Release Masterのスコア列順）。メンバー名を他のファイルで手書きしない
- `lib/data-events.ts` — 画面内の「保存しました」通知。モーダルで保存したら `notifyDataChanged`、一覧側は `useDataChanged` で受けて取り直す（再読み込みせずに一覧を揃える）
- `lib/drafts.ts` / `hooks/useUnsavedGuard.ts` — レビュー・M/J原稿の書きかけ退避（localStorage `ryuryu_draft:*`、14日）と、閉じる前の確認
- `lib/mj-concurrency.ts` — M/J保存の差分送信と競合判定。`PATCH /api/release-master/[no]` は `base` を受け取り、他の人が先に保存した項目があれば409
- `lib/fetch-json.ts` — 画面のデータ取得。失敗を空の一覧にせずエラーとして扱う
- `lib/uid.ts` / UID列 — アルバムの安定ID（改名に耐える行識別子。`scripts/assign-uids.ts` で採番）
- `lib/ops/` — メンテ処理のコアロジック（scripts/ と app/api/admin/ の両方から呼ばれる共通実装）
- `lib/playlist-sources.ts` — プレイリスト収録タグの取得対象（`playlists` シートのCRUD）
- `lib/ops/playlist-archive.ts` — プレイリスト収録の観測履歴（100曲の窓から外れた分を後から拾うための蓄積）
- `lib/spotify.ts` — Spotify API クライアント
- `app/weekly/page.tsx` — 今週のリリース作業（Weekly投稿の準備を1ページで案内。コアは `lib/ops/weekly.ts`・`lib/weekly/`）
- `lib/ops/fill-listeners.ts` — Spotify月間リスナー数の取得（旧GAS `fetchMonthlyListeners` の移植）
- `app/page.tsx` — ホーム（アルバム一覧、フィルター）
- `app/recommend/page.tsx` — タイムライン（レコメンド＋レビュー）
- `app/mypage/page.tsx` — マイページ（saved/foryou/reviewed タブ）
- `components/ReviewModal.tsx` — アルバムクリック時のモーダル（メインUI）
- `components/UpdateBanner.tsx` — 新しいデプロイがあれば「再読み込み」を促すバナー。前面復帰時に `/api/version`（`VERCEL_GIT_COMMIT_SHA`）とビルド時に埋め込んだ版（`next.config.mjs` の `NEXT_PUBLIC_APP_VERSION`）を比べる。ホーム画面アプリはService Workerが無いので再追加しなくても更新は届く。古いままになるのはバックグラウンドから復帰した画面だけ
- `content/how-to-use.md` — ヘッダーの「使い方」モーダルの本文のマスター。`lib/how-to-use.ts` が見出し（`##`）・段落・箇条書き（`- **ラベル** — 説明`）を読み込み、`components/HowToUseModal.tsx` が表示する。画面の挙動を変えたら、対応する説明もここで更新する

## スクリプト一覧（scripts/）

| ファイル | 用途 |
|---|---|
| `check-headers.ts` | Release Master の全列名を表示 |
| `fill-time-tracks.ts` | Time列(G)・#列(H)をSpotifyから補完 |
| `convert-time-hr.ts` | Time列の60分以上の値を `1hr 24min` 形式へ書き換え（dry-run / --apply、冪等。2026-09-18に156件適用済み） |
| `migrate-kaede-email.ts` | メールアドレス移行（dry-run / --apply） |
| `sync-scores-to-rm.ts` | scoresシート→Release Master スコア同期 |
| `dedup-scores-normalized.ts` | scoresシートの重複除去 |
| `repair-spotify.ts` | Spotify URL修復（画像URLが誤入力されている行を修正） |
| `refetch-spotify.ts` | Spotify URL空行の再取得（名前不一致はMISMATCHアラート） |
| `assign-uids.ts` | Release Master のUID列採番（dry-run / --apply、冪等） |
| `backfill-album-uids.ts` | scores/bookmarks/recommendations にRMのUIDを紐付け（dry-run / --apply、冪等） |
| `repair-album-uids.ts` | albumUid が作品名と食い違う行を、RMの作品名＋アーティスト名（決まらなければ作品名だけ）で付け直す（dry-run / --apply、冪等）。2026-11-10に本番で34件見つかった |
| `sync-playlist-tags.ts` | 登録プレイリストの収録曲からRMの`memo`（旧playlist）列を更新（dry-run / --apply / --init-column） |

### fill-time-tracks.ts のオプション

```bash
npx tsx scripts/fill-time-tracks.ts                        # dry-run（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply                # 書き込み（空行のみ）
npx tsx scripts/fill-time-tracks.ts --apply --force        # 全行上書き
npx tsx scripts/fill-time-tracks.ts --apply --force --from-row=915  # 指定行以降のみ
```

書き込み形式: `13songs, 50min 4sec`。60分以上は `24songs, 1hr 24min`（秒は切り捨てて省略）。表記は `lib/time-format.ts` に集約（アルバム追加APIも同じ関数を使う）

## レビュー同期（Release Master ⇄ アプリ）

2026-11-10に作り直した（改善プラン第2段階）。判定は `lib/review-sync.ts`、本体は `lib/ops/review-sync.ts`。

- 照合は albumUid × メンバー。Release Master の手入力の編集時刻は、同じファイルの `_review_edit_log`（`apps-script/ReviewJournal.gs` が手入力を、`lib/review-journal.ts` がアプリの書き込みを記録）だけを根拠にする
- 履歴でアプリより新しいと確かめられたものだけ、その記録時刻でアプリへ反映。それ以外の差分（時刻不明・アプリの方が新しい・同時刻・シートで削除・要確認）は `sync_review` に出して、管理画面で「シートの内容を採用」「アプリの内容を残す」を選ぶまで両方そのまま
- 検出した時刻を編集時刻の代わりに使わない。履歴の無いコメントだけのセルは、旧同期と同じく取り込まない
- セルの読み方は平均点の計算（`parseLegacyScoreNum`）と同じ「先頭の語を parseFloat」。変えると既存データと大量に食い違って見える（2026-11-10の本番照合で、揃えた後の差分は13件）
- 起動は Vercel Cron（毎日 19:00 UTC）とホームを開いたときのPOST。冪等なので同時に走っても壊れない
- アプリの投稿・更新は Release Master へも書く。スコアなしに更新したらコメントだけを書く（元が空なら書かない）。Release Master だけ失敗したら画面に「再送」を出す

## 管理画面の認可

`/admin` と `/api/admin/*` は Google ログインで認可する（2026-09-11に管理者パスワードから移行）。

- 判定は2段構え: 同一オリジンか → Googleログイン済みの許可メンバーか
- アプリにログインできるメンバー（`ALLOWED_MEMBER_EMAILS`、未設定なら `lib/members.ts` の6人）なら誰でも操作できる（2026-09-19に Kohei 限定から拡大。`ADMIN_EMAILS` は廃止）
- 実装は `lib/admin-auth.ts` の `guardAdmin(req, action, detail)`。各ルートの先頭で呼ぶ
- 実行者と操作は `admin_logs` シート（A=timestamp, B=email, C=action, D=result, E=detail）に追記
- 拒否のログは「ログイン済みだが許可メンバーでない／Google再ログインが必要」のケースだけ記録する。未ログインや外部オリジンからの呼び出しは誰でも起こせるので残さない
- `ADMIN_PASSWORD` は未使用（Vercelの環境変数から削除してよい）

## プレイリスト収録タグ

Release Master の `memo`（旧playlist）列に「そのアルバムがどの有名プレイリストに入っているか」を自動で書き込む。

- Spotify公式（エディトリアル）プレイリストは Web API から読めない。アプリが Development mode のため 404 になる（Client Credentials でもユーザー認可トークンでも同じ。2026-09-09に実測）
- そのため収録曲一覧は**埋め込みページ**（`open.spotify.com/embed/playlist/<id>`）から取得する。曲→アルバムの解決は公式API（`/v1/tracks`）
- 取得は3段構え（2026-09-12〜）
  1. 埋め込みページに同梱されている**匿名トークン**（`__NEXT_DATA__` の `state.settings.session.accessToken`）で `/v1/playlists/<id>/tracks` を全件ページング。これが通れば101曲目以降も読める
  2. 通らなければ埋め込みページの先頭100曲だけ
  3. どちらでも取れなかった分は**アーカイブ**（過去の観測）から拾う
- 埋め込みの取得上限は100曲ちょうど。`?offset=` は効かない（250曲級のプレイリストでも100で頭打ちになるのを2026-09-12に実測）
- **100曲は日付順ではない。** All New Indie の実測で、その日の最新リリースが3位・9位・13位などに散らばり、100位は3週間前だった。RapCaviar には2016年の曲も混ざる。今日リリースの作品が101曲目以降に埋もれることがあり、その回のクロールでは原理的に見えない
- 匿名トークンは**共有クォータ**で動いており、枯渇していると全エンドポイントが 429 QUOTA_EXCEEDED を返す（`retry-after` が十数時間。2026-09-12は塞がっていた）。待っても無駄なので、失敗したら即座に埋め込みへフォールバックする
- 判定基準は「そのアーティストの曲が1曲でも入っているか」。アルバム自体が入っている必要はない（2026-09-11に変更）。先行シングルはアルバム版と別トラック・別アルバムIDになるため、アルバム単位の照合だけだと同じ曲でも取りこぼす
- 照合は Spotify の**アーティストID**で行う。名前だと表記揺れ（石若駿 / Shun Ishiwaka）や「Blu & Sndtrak」のような&入りの名義で外れる。Release Master 側は対象行のアルバムを `/v1/albums`（20件ずつ）で引いてIDを得る。Spotify URL が無い行だけアーティスト名で照合する
- 客演も1曲として数える。アルバムに共演者がクレジットされていれば、その共演者の別作品の曲でもタグが付く
- コンピレーション名義（Various Artists）は照合から外す
- アルバムID・アルバム名+アーティスト名の照合も残している。アルバムIDは market 指定あり／なしの両方を索引に入れる（Track Relinkingでズレるため）
- 書き込みは**追記**。既存の名前は消さない（100曲の窓から外れたプレイリストのタグを失わないため）。誤ったタグは手でセルを編集する

### 収録アーカイブ（101曲目以降の取りこぼし対策）

- 実行のたびに「どのプレイリストにどのアルバム・アーティストが載っていたか」を `playlist_archive` シートへ追記する（`lib/ops/playlist-archive.ts`）
- プレイリストは随時入れ替わるので、今日101曲目にある新譜も後日100曲の窓へ入ってくる。その時点で観測してアーカイブに残せば、以後は窓から外れても拾える
- キーは playlistId + kind + key で冪等。kind は `albumId` / `albumKey` / `artistId` / `artistName` の4種（照合経路と1対1）
- `months` はその収録曲の**アルバムのリリース月**。照合時、Release Master の行の月と**±1か月**に収まるエントリだけ採用する。判定基準が「そのアーティストの曲が1曲でも入っているか」なので、月で絞らないと何年も前に載ったアーティストの新作にまでタグが付く
- 保持期間は15か月。それより古い月しか持たないエントリは書き込み時に捨てる。入れてもその場で期限切れになる旧譜は最初から入れない（毎回シート全体を書き直さないため）
- dry-run ではシートに書かないが、マージ結果は本番と同じものを使って照合する
- 日次クロール: `/api/cron/sync-playlist-tags` を Vercel Cron が毎日 15:30 UTC（JST 0:30）に叩く。設定は `vercel.json`、認証は `CRON_SECRET`（Vercelの環境変数。未設定だと500を返す）
- 2026-09-12 の初回投入で13,776件。38本のプレイリストで1回あたり60秒弱
- 収録曲の取得は並列、アルバム解決は全プレイリスト分をまとめて直列（公式APIを並列で叩くと429になる）
- 対象は既定で**当月のみ**（Date列の "YYYY/MM" 前方一致）。管理画面の「対象月」で変更、CLIは `--month=2026/08` / `--all`。プレイリスト側の取得量は月を絞っても変わらない
- 取得対象は管理画面（週次リリース処理タブ）から追加・削除する。`genre`（旧genre/memo）列には触れない

## 今週のリリース作業（/weekly）

金曜19時のWeekly投稿の準備を、メンバーの誰でもできるように1ページにまとめたもの（2026-09-28〜）。入口はマイページ上部の「投稿作業」カード（タップで Weekly作業・投稿画像ジェネレーター・管理者ページへのメニューが開く。`components/mypage/ProfileHeader.tsx`）。フッターのリンクは2026-09-28に廃止。週は土曜〜金曜（`lib/weekly/week.ts`。ジェネレーターと同じ定義）。API は `/api/admin/weekly`（`guardAdmin` で認可、`action` で分岐）。

1. 邦楽：New Music Wednesday（既定 `37i9dQZF1DWYBDycFJuxRt`。`settings` シートの `weekly_japan_playlist` で変更可）を埋め込み経由で読み、アルバムと4曲以上のEPだけを候補にする。インスト・ライブ・別バージョンを除いて4曲未満ならシングル扱い。℗の年が配信日より2年以上前ならリイシュー候補。同じアーティストの行が前後7日にあれば登録済み扱い（ローマ字／日本語表記の揺れ対策）
2. 洋邦混在：New Music Friday Japan（既定 `37i9dQZF1DXc57cuGAMEkA`。`settings` シートの `weekly_mixed_playlist` で変更可。2026-11-06〜）。読み込みは1と同じ処理（`playlistCandidates(url, window, "mixed")`）で、作品ごとに洋邦を判定する（`lib/weekly/waboku.ts`）。判定は Release Master の同じアーティストの過去の洋邦 → かな表記（共演名義を含む）→ メイン名義のSpotifyジャンル（j-pop / anime / japanese ... ）→ レーベル（Sony Music Labels / WM Japan ...）→ 名義の漢字 → それ以外は洋楽。洋楽はアルバムのみ（EPは「洋楽のEP」でチェックを外す）、邦楽はEPも候補。画面の「洋楽 ⇄」ボタンで切り替えると `[EP]` の付け外しと除外理由も作り直す
3. 洋楽：AOTY はサーバーからの取得を Cloudflare が403で弾くため、人がコピーしたページのテキストを貼る（`lib/weekly/aoty-parse.ts`）。日付行（`Oct 2 • LP`）の直前2行をアーティスト名・作品名として読む。整形済みのタブ区切りも可。オリジナルアルバムだけが対象で、EP・デラックス版・リイシュー・ライブ盤などは除外候補にする
4. 情報の更新：今週の行だけを対象に Spotify URL → Time → 月間リスナー数 → 収録タグ を順に実行（既存の ops に `dateRange` オプションを追加して流用）
5. 振り分け（WEEK列）はシートで行う。6. 画像はジェネレーター

- 重複の判定（候補を「登録済み」に回す）は Spotify アルバムID → 作品名＋アーティスト名の一致 → `findNearbyDuplicate`（`lib/weekly/duplicates.ts`）。最後のものは配信日が前後7日以内の行に限り、名義を `,` `&` `feat.` などで分けたどれかの一致か、作品名（記号除く・6文字以上）の包含で同じ作品とみなす。AOTY とNMFで表記が揃わない（「久石譲 & …」と「Joe Hisaishi, …」）ため。2026-11-06 に手順を NMW → NMF → AOTY の順へ並べ替え、AOTY にもこの照合をかけた
- 行の追加は重複を書き込み直前にも再確認する。A列（No.）の数式は2407行目で途切れているため、空なら `=ROW()-1` を入れる（No.が空の行はアプリ・ジェネレーターに出ない）。`/api/sheets/add-album` も同様
- 洋楽の Spotify URL 取得はアルバム形式の結果だけを採用する（配信前は同名の先行シングルが先頭に来るため）
- 月間リスナー数はアーティストページのHTMLから読む。短いUA（`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`）でないとサーバー描画されず数値が入っていない。書き込み先は「リスナー / Google Script 作動」列（旧GASと同じ）。アーティストはアルバムのクレジットから特定し、URLが無い行だけ名前の完全一致で探す。特定できなければセルに何も書かない

## Saved Tracks Stories画像（/generator/saved-tracks）

毎週月曜のストーリー投稿（1080×1920）を、プレイリスト「Hyoryu's Saved Tracks」（`6stewW41e2gvYLcg5sRYSK`）から作る画面（2026-11-08〜）。デザインはFigmaの Saved_1〜3（Weekly_Currents ページ）。

- データの保存はしない。選曲・文字の修正・背景の選択はその場限りで、Supabaseの共有文書とは無関係
- 曲は公式API（`/v1/playlists/<id>/tracks`、Client Credentials）で読む。自分たちの公開プレイリストなのでエディトリアルと違って通る。追加日時は `added_at`
- 版面の数値と文字の収め方は `lib/generator/saved-tracks.ts`、描画は `app/generator/saved-tracks/story-canvas.ts`
- 文字の中心は帯の中央（540）ではなく537。Figmaの文字枠の実測値
- 帯のFigma Glassエフェクトは Canvas で再現できないので、光る縁の細線で近似している
- 文字は4倍で描いて縮小する（等倍だとmacOSで太る）。曲名の字間 −5% はSafari対応のため1文字ずつ置く
- 背景は動画の任意フレーム（`video-frames.ts`）。標準の動画は `public/saved-tracks/wave.mp4`（原版 wave.m4v を `-crf 26 -g 30 -vf fps=30` で約30MBへ変換。アプリと同一オリジンなのでCanvasへ描ける）。読み込めないときだけ Figma の静止画2種（`still-*.jpg`）を、Saved_1〜3と同じ位置で順に使う

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

ジェネレーター一式は `main` に統合済み（2026-11時点。PR #16〜#19 など）。2026-09-07の退避ブランチ `wip/generator-integration` の記述は経緯として残る文書があるが、現在の作業は `main` から始める。

Monthly／Japan画像ジェネレーターの機能版は`app/generator/`に実装済み。ページ遷移・情報設計・UI／ビジュアルデザインを変更する前に、[Claude Code向け引き継ぎプロンプト](docs/claude-generator-ui-handoff.md)を**最初から最後まで読み**、そこからリンクされた操作仕様・共有保存契約・UI実装記録も確認すること。引き継ぎには、初回UI変更で失われかけた機能と2026-09-07の受入で復元した機能がまとまっている。

本文は天地左右25pxを確保し、複数行の行送りを利用可能な高さまで自動最大化するのが既定。最小行送りは28pxで、収まらない場合は警告してPNG生成を止める。この描画結果、`bodyLeadMode`／`bodyMaxLead`の保存契約、既存文書を自動として扱う互換性はUI変更でも維持する。API・DB・適用済みマイグレーションの変更が必要な場合は独断で変更せず、理由・案・影響範囲をCodexへの引き継ぎ事項として残す。

Monthly／Japanの表紙（画像01）は作品のジャケットだけで作る。**Monthly（洋楽）は採用→掲載の先頭9作品を3×3で隙間なく、左上から行ごとに投稿順**（2026-10-08〜。`Layout.GRID`）、**Japanは先頭6作品を斜めの6枠に並べたコラージュ**（2026-10-07〜。`Layout.COLLAGE`）。版面は`coverLayoutOf(series)`で企画から決める。切り抜き位置は作品ごとの`coverFocusX`／`coverFocusY`。表紙の無い旧文書は「Release Masterから取り込み直す」で表紙が追加される。作品名の`[EP]`は取り込みで外さない。採用・掲載の並びは EP末尾 → 日付 → アーティスト名（英字a-z → 日本語あいうえお順。漢字はRelease Masterの`読み`列、無ければ辞書で推定。`lib/generator/artist-reading.ts`）。

特に、Timeの空欄補完、Release Masterから文字情報を読み直す再取得導線（差分選択→ローカル下書き→作品ごとの保存）、字間・行送りの直接数値入力と`Mixed`表示、作品・背景の自動ロック取得と対象別version保存、プレビューからのおすすめ曲番号／曲名の個別選択、保存再送の`requestId`維持、heartbeat競合防止、並び順を含むローカル復旧、stickyと非表示タブでの画像準備は完成済み機能として維持する。「作品を編集」「背景を編集」の開始ボタンは再追加しない。

## 運用

データの置き場所・定期実行・障害時の確認順は [運用ガイド](docs/operations.md)。Cronの成否は `admin_logs` に `email=cron` で残る（`logCronResult`）。

定期確認はClaudeの `ryuryu-cron-watch` が毎日13:30 JSTに行う（Codexの定期タスクは停止済み。頼まれたときだけ調査する）。

環境変数（Vercel Production）: Google（`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_SERVICE_ACCOUNT_KEY`）、Sheets（`GOOGLE_SPREADSHEET_ID`・`RELEASE_MASTER_SPREADSHEET_ID`）、認証（`NEXTAUTH_URL`・`NEXTAUTH_SECRET`・`ALLOWED_MEMBER_EMAILS`。ローカルは `AUTH_URL`/`NEXTAUTH_URL` を `http://127.0.0.1:3000` に揃える）、Spotify（`SPOTIFY_CLIENT_ID`・`SPOTIFY_CLIENT_SECRET`）、外部ツール用（`RELEASE_MASTER_API_TOKEN`）、Cron（`CRON_SECRET`）、ジェネレーター（`GENERATOR_ENABLED`・`SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`、音声は `B2_KEY_ID`・`B2_APPLICATION_KEY`・`B2_BUCKET`・`B2_ENDPOINT`）。`VAPID_*` は未マージの Web Push 用。

## 注意事項

- `scores` シートの `memberName` は email で管理（旧来の短縮名はレガシー）
- Release Master への書き込みは `SHEET_COL` 定数で列名解決（列移動に耐性あり）
- Spotify API レート制限: スクリプトは1件あたり300〜500ms のsleep を挟む
