# アプリ課題の洗い出し（Claude, 2026-11-10）

> **記録について（2026-11-11追記）**: 以下は[調査対象のコミット `64ef156`](https://github.com/fvku/ryuryu-music-app/tree/64ef156)に対する当時の記録。修正の結果は[改善プラン冒頭](improvement-plan-2026-11-10.md)を参照。D3の「429件はすべてライブラリの単体テスト」という評価は、既存のAPI・DB契約テストがあるため、[改善プラン第5段階](improvement-plan-2026-11-10.md#5-運用と保守)で訂正している。

対象: ローカル `feat/generator-music-share`（`64ef156`）。この内容は `origin/main` に取り込み済みで、`origin/main` はさらに Saved Tracks 関連の5コミットが進んでいる（ジェネレーターの追加分だけなので、以下の指摘には影響しない）。

実施したこと: コードを読んで確認、`eslint`（0件）、`vitest`（38ファイル・429件すべて通過）、`tsc --noEmit`、`npm audit --omit=dev`、`npm outdated`。
実施していないこと: ブラウザや実機での画面確認（Google ログインが要るため）、本番環境への攻撃の再現。

確度の表記: **確認済** = コードと実行結果で確かめた / **要検証** = コード上はそう読めるが、外部サービスの挙動などに左右される

---

## A. セキュリティ

### A1. 【高・確認済】Spotify OAuth コールバックに反射型 XSS がある
- 場所: `app/api/spotify-oauth/callback/route.ts:24`
- `error` クエリを `JSON.stringify` しただけで `<script>` の中へ埋め込んでいる。`JSON.stringify` は `</script>` をエスケープしないので、`/api/spotify-oauth/callback?error=</script><script>…</script>` を開かせるとアプリのオリジン上で任意のスクリプトが動く
- このルートは middleware の対象外（`/api` は除外）なので、ログイン状態に関係なく開ける。ログイン中のメンバーが踏むと、同一オリジンからの fetch になるため `guardAdmin` の Origin 確認も通る。結果として、管理APIでシートの書き換え・行のクリア・スコアの改ざんができてしまう
- あわせて OAuth の `state` を発行・検証していない（`app/api/spotify-oauth/route.ts`）。他人の Spotify アカウントの refresh token を被害者のブラウザに入れさせる、ログイン CSRF ができる

### A2. 【高・確認済】`next` と `@auth/core` に critical の既知脆弱性がある
- `next@16.2.10` が該当する範囲（〜16.4.0）に入っている。中でも次の2つは、このアプリの構成に直接当てはまる
  - **Turbopack を使う App Router での middleware 迂回**（GHSA-6gpp-xcg3-4w24）。このアプリは画面のログイン必須化を `middleware.ts` だけで実現している
  - **Image Optimization API で AVIF を扱うときのリモートコード実行**（GHSA-2xp9-vwfh-vxw4）。`next.config.mjs` の `remotePatterns` に、誰でも画像を置ける imgur / gyazo / Google Drive などが入っている
- 修正版は 16.4.6（semver の範囲内で上げられる）
- `@auth/core@0.41.2`（`next-auth@5.0.0-beta.31` に含まれる）にも critical の指摘がある（OAuth の state / PKCE 用 Cookie がプロバイダーに紐付いていない、など）。`beta.32` で直る
- 本番依存で合計15件（critical 3 / high 5 / moderate 7）。sharp・postcss・nanoid なども、`npm audit fix` で直せるものが多い

### A3. 【中・確認済】認証なしで読み書きできる API が残っている
| ルート | 何が起きるか |
|---|---|
| `GET /api/scores` | 全レビューをメール・コメントごと返す（2026-09-18の点検で保留にしたもの） |
| `GET /api/scores/[albumNo]` | アルバムごとのレビュー |
| `GET /api/recommendations`（`forUser=me` 以外） | 全レコメンドを、メッセージ・メンション先メールごと返す |
| `GET /api/cron/sync-release-master` | **誰でも書き込み処理を起動できる**。RM→scores の同期、UID採番、UIDの紐付けまで走る。失敗すると `String(error)` をそのまま返す |
| `GET /api/sheets/check-album` | 書き込み用の資格情報で RM を読む |
| `GET /api/release-master/headers` | RM の列構成 |
| `GET /api/spotify/search` `album` `tracks` | アプリの Spotify クレジットを誰でも使える（クォータを消費される） |

### A4. 【中・要検証】Spotify ログインでメンバーになりすませる余地がある
- `lib/auth.ts` の `signIn` は、プロバイダーを問わず「メールが許可リストにあるか」だけで通す。Spotify はメールアドレスの確認を必須にしていない（と考えられる）ので、メンバーのメールで Spotify アカウントを作れればログインできる
- 管理API とジェネレーターは「Googleで確認済みのメール」を要求していて安全。一方、スコア・ブックマーク・レコメンド・`/api/release-master/[no]` PATCH・`/api/sheets/add-album` は `session.user.email` しか見ていない

### A5. 【低・確認済】エラーの中身をそのままクライアントへ返している
- `check-album` `add-album` `spotify/tracks` `spotify/album`（Spotify のレスポンス本文まで返す）、`cron/sync-release-master` など

---

## B. データの整合性

### B1. 【中・確認済】スコアの二重書き込みが原子的でない
- 投稿・更新は「scores シートへ書く → Release Master のメンバー列へ書く」の2段階になっている（`app/api/scores/[albumNo]/route.ts`）。後半が失敗しても `warning` を付けて 201 を返すだけで、ずれたまま残る
- 逆向き（RM→scores）は `sync-release-master` が自動で直すが、scores→RM の再同期は管理画面から手で実行するしかない

### B2. 【中・確認済】二重投稿の防止が実質的に効いていない
- `hasScore` を2回続けて呼んでから `append` している。チェックと書き込みの間に排他がないので、同時に投稿されると両方とも通る
- `updateScore` は「全行を読む → 行番号を見つける → その行を上書き」なので、管理画面の `dedup-scores` が行を削除していると、別の行を上書きしうる

### B3. 【中・確認済】RM 同期をホームの表示のたびに起動している
- `app/page.tsx:106` から `fetch("/api/cron/sync-release-master")` を投げっぱなしにしている。並走防止と5分の間隔制限はインスタンスのメモリにあるので、Fluid Compute で複数のインスタンスが立つと同時に走る。`sync_pending` の重複行や `addScore` の二重追加につながりうる
- 同期する1件ごとに `updateScore` が scores シート全体を読み直す（N+1）。`maxDuration=60` なので、件数が多い日にはタイムアウトしうる
- UID採番と紐付けの書き込みも、ホームが開かれるたびに（最短5分おきに）走る

### B4. 【低・確認済】削除が「行を空にする」方式なので、シートに空行が溜まる
- `bookmarks`・`sync_pending`（`batchClear`）。全件読みの範囲が増え続ける

### B5. 【中・確認済】データの置き場所が4つに分かれている
- アプリ用 Sheets、Release Master、Supabase（ジェネレーター）、Backblaze B2（音声）
- Supabase は無料プランで、使わない日が続くと休止する。そのため毎日 keepalive を cron で叩いている。2026-11-06 には実際に一度止まった
- Hobby プランの Cron の本数・回数の制限に合わせるため、keepalive に「音声の削除」も相乗りさせている

---

## C. パフォーマンスと使い勝手

### C1. 【中・確認済】画面を開くたびに全データを取り直している
- ホームは Release Master の全行（`A1:AZ`、2400行以上）と全スコア（約350KB）を、表示のたびにクライアントで取得している
- 下部ナビが `window.location.href` で移動するので、タブを切り替えるたびにページ全体が再読み込みになる（2026-09-18の点検で保留にしたもの）
- 主要ページはすべて `"use client"` で、サーバー側で描画しない。データが揃うまで画面が空のまま

### C2. 【低・確認済】キャッシュの破棄が、書き込みを受けたインスタンスにしか効かない
- `lib/api-cache.ts` はインスタンスごとのメモリ。ほかのインスタンスでは、TTL が切れるまで古い一覧が返る（コメントには書いてある前提だが、「投稿したのに他の人に見えない」問い合わせの原因になりうる）

---

## D. 開発と運用

### D1. 【中・確認済】CI がなく、`main` への push がそのまま本番に出る
- `.github/workflows` がない。lint・テスト・ビルドが通ることを、マージ前に機械的に保証していない

### D2. 【中・確認済】エラーを監視していない
- Sentry などがなく `console.error` だけ。日次 cron（収録タグ・keepalive・音声削除）が失敗しても誰も気づかない
- `guardAdmin` の実行ログは `void logAdminAction(...)` の投げっぱなしで、レスポンスを返した後に関数が止まると記録が落ちうる。さらに、記録のたびに `spreadsheets.get` を余分に1回呼んでいる

### D3. 【中・確認済】テストが lib 層に偏っている
- 429件はすべてライブラリの単体テスト。スコア投稿・認可・同期など、壊れると困る API ルートや画面の流れのテストがない

### D4. 【低・確認済】巨大なファイルと、残ったままの一時ファイルがある
- `app/generator/[id]/GeneratorWorkspace.tsx` が1919行、`app/admin/page.tsx` が1037行
- `app/generator/uipreview-temp/page.tsx` は「TEMPORARY: 確認後に削除する」と書かれた見た目確認用のページ。git で管理されていて本番にも出ている

### D5. 【低・確認済】ドキュメントが実態とずれている
- CLAUDE.md に Supabase・B2・関連の環境変数（`SUPABASE_*`、B2系、`GENERATOR_ENABLED`）が書かれていない
- 「画像ジェネレーターのUI引き継ぎ」節の「`main` は統合していない」「6コミット遅れ」は、すでに古い
- 列名の決め打ちが残っている。`app/api/release-master/route.ts` の `LEGACY_MEMBERS` は5人だけで、Kaede が入っていない。メンバーの追加にはコード変更が要る

### D6. 【低・確認済】ローカルとリポジトリの状態
- 今いるブランチは取り込み済みで、`origin/main` より5コミット遅れている。マージ済みのローカルブランチも4本残っている
- `.next/types` が古いので、ローカルの `tsc --noEmit` が存在しない saved-tracks ルートで失敗する（コードの不具合ではない）
- `origin/feat/web-push-notifications` が10-26から未マージのまま
- Vercel に重複プロジェクト `ryuryu-music-app-rkvn` がある（過去の記録より。今回は未確認）
- `@types/node` が 20。Vercel 側の Node が 20 なら、2026-10-01 に非推奨になっているので確認が要る

---

## 優先度のまとめ（改善プランの材料）

1. **すぐ直す**: A1（XSS と state）、A2（`next` 16.4.6・`next-auth` beta.32 へ上げる）
2. **次に直す**: A3（`sync-release-master` の起動方法と、読み取りAPIの認可）、A4（一般の書き込みでもプロバイダーを確認する）、D1（CI）
3. **計画して直す**: B1〜B3（書き込みの経路と同期の作り直し）、C1（データの取り方とナビ）、D2・D3
4. **ついでに直す**: A5、B4、D4〜D6
