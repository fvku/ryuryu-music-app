# 運用ガイド（データの置き場所・定期実行・障害時の確認）

2026-11-10作成（改善プラン第5段階）。リポジトリから確認できた事実と、まだ決まっていないこと（**未決定**）を分けて書く。外部サービスの管理画面で確かめていないものは「未確認」とする。

## データの置き場所

| 置き場所 | 中身 | 消えたときの影響 | 復旧の手がかり |
|---|---|---|---|
| Google Sheets（アプリ用、`GOOGLE_SPREADSHEET_ID`） | scores・recommendations・bookmarks・playlists・playlist_archive・settings・admin_logs | レビュー・レコメンド・保存リストが失われる | Googleスプレッドシートの「版の履歴」で過去の状態へ戻せる。別ファイルへの定期コピーは**未決定** |
| Release Master（`RELEASE_MASTER_SPREADSHEET_ID`） | アルバム一覧・手入力のスコア・M/J原稿・UID | アプリ全体が表示できない | 同上（版の履歴）。共同編集者が多いので、復元は戻す範囲を決めてから行う |
| Supabase（`SUPABASE_URL`、無料プラン） | 画像ジェネレーターの共有文書・履歴・画像 | ジェネレーターの保存・履歴が使えない（画像の書き出しは手元の下書きから可能） | 無料プランは自動バックアップの保持が短い。移行時の部分退避は `.local/generator-migration-backups/`（完全なバックアップではない。[記録](./generator-project-reuse.md)） |
| Backblaze B2（`B2_*`） | 動画用の音声 | 動画に音を付けられない | 原本は各自の手元。対象月の終わりから1年で自動削除する設計 |
| 端末のlocalStorage | フィルター状態、レビュー・M/J原稿の書きかけ（`ryuryu_draft:*`、14日で失効）、Spotifyのアクセストークン | その端末の表示設定・書きかけだけ | 復旧不要 |

Supabase は無料プランで、アクセスが無い日が続くと休止する（2026-11-06に一度停止）。毎日の `supabase-keepalive` で防いでいる。

## 定期実行（Vercel Cron、`vercel.json`）

| パス | 時刻 | 内容 | 結果の記録 |
|---|---|---|---|
| `/api/cron/sync-playlist-tags` | 毎日 15:30 UTC（JST 0:30） | プレイリスト収録タグの更新とアーカイブ | `admin_logs` に `email=cron, action=cron:sync-playlist-tags` |
| `/api/cron/supabase-keepalive` | 毎日 3:00 UTC（JST 12:00） | Supabase休止防止と期限切れ音声の削除 | `admin_logs` に `action=cron:supabase-keepalive`。音声削除だけ失敗した場合も `failed` |
| `/api/cron/sync-release-master` | 毎日 19:00 UTC（JST 4:00） | レビュー同期とUID採番。ホームを開いたときにも動く | `admin_logs` に `action=cron:sync-release-master`（ホームからの実行は、反映があったときと失敗時だけ） |

- 認証は `CRON_SECRET`（Vercel の環境変数）。未設定だと500。
- Hobby プランは1日1回まで・本数に上限があるため、keepalive に音声削除を相乗りさせている。
- レビュー同期で自動で決められない差分は、管理画面の保守タブ「レビュー同期の確認待ち」に出る。

### 失敗に気づく方法（2026-11-11決定）

- `admin_logs` シートの `result=failed` の行を見る（2026-11-10〜記録）。
- Vercel のダッシュボード → Logs で `[cron/` を検索する。
- 管理画面の「定期実行の状況」から専用ページ `/admin/operations` を開く。`logCronResult`（[`lib/admin-auth.ts`](../lib/admin-auth.ts)）が残した記録を、[`readCronStatus`](../lib/cron-status-store.ts) が読み取る。メール・Slack・Discordへの送信は行わない。
- 各処理の直近の記録が失敗なら警告し、その後の成功記録があれば解消する。収録タグの取得は、一部のプレイリストだけ失敗した場合も失敗として記録する。過去5件の履歴も表示する。
- ログがない場合と、最後の成功記録から36時間以上経過した場合も確認を促す。これは日次実行の途切れに気づくための目安で、実行開始・タイムアウトを直接監視するものではない。レビュー同期の記録にはホームからの実行も含むため、Cron自体の稼働を保証しない。
- 画面は表示時と「更新」を押したときに取得する。取得失敗を「問題なし」に置き換えず、読み込みエラーを表示する。閲覧APIはGoogleで確認済みの許可メンバーだけが利用でき、ログの自由記述（detail）やメールアドレスを返さない。

### Claude・Codexへの共有と定期確認

- 管理画面の「AIへの報告文をコピー」で、処理名・成否・日時と調査依頼文をコピーし、ClaudeまたはCodexに貼り付ける。コピーだけではAIへ送信されない。
- 両方のAIから使える読み取り専用コマンド: `node --import tsx scripts/check-cron-status.ts`（機械向けは `--json`、`npx tsx` でも実行可）。`.env.local` のアプリ用Sheetsの設定を使う。読み取り専用スコープで `admin_logs` のA〜D列だけを読み、シートの作成・変更・ログ追記は行わない。終了コードは0＝直近の記録はすべて成功、1＝要確認、2＝取得失敗。エラーの詳細や資格情報は出力しない。
- 2026-11-11、**CodexとClaudeがそれぞれ毎日12:30 JSTに確認する**方針を決定。Codex側は「ryuryu-music 定期実行の確認」を有効にした。Claude側は画面操作ツールがウインドウを操作できず未登録のため、[登録用の依頼文と確認手順](cron-monitoring-setup.md)を用意した。登録が完了したら、この記録を更新する。
- [Codexの定期タスク](https://learn.chatgpt.com/docs/automations?surface=app)と[Claude Code Desktopの定期タスク](https://code.claude.com/docs/en/desktop-scheduled-tasks)は、今回のローカルファイルを使う構成ではMacが起動・起床し、それぞれのアプリが稼働している必要がある。タスクの設定時刻は12:30だが、実行の開始には遅れが生じることがある。コマンドがcheckoutに無い場合は、ブランチを切り替えず監視不能として報告する。
- 自動確認を設定するときは、変更のない異常を毎回通知せず、新しい異常・状態の変化・復旧・確認処理自体の失敗を知らせる。通知するかは前回の結果との比較で決める。AIは原因の確認と提案までとし、同じ作業フォルダの同時編集、本番Sheetsへの書き込み、Apps Scriptの変更、無承認のマージは行わない。

## 本番の状態（2026-11-10確認）

- Vercel の Node は 24.x（`vercel project ls`）。`@types/node` は 20 のままで、型定義だけの差。
- 本番の依存は `npm audit --omit=dev` で0件。開発依存に Moderate 7件（typescript-eslint が依存する minimatch 10系）。修正版は minimatch 11系のみで、typescript-eslint の最新 8.72.2 も10系を指定しているため、上流の更新を待つ（メジャーを無理に上書きしない）。
- Vercel の Production 環境変数に `VAPID_*` がある。これは未マージの `feat/web-push-notifications`（2026-10-26）用で、現在の main では使っていない。
- 重複プロジェクト `ryuryu-music-app-rkvn` は、現在のCLIのスコープの一覧には出なかった（別チーム側にあるかは未確認）。

## Release Master の並べ替え

一部の列だけを選んで並べ替えると、右端のUID列が行とずれる。アプリはUIDでレビュー・ブックマーク・レコメンドを作品に結び付けているので、別の作品にレビューが出る（2026-11-10に本番で発生）。並べ替えるときは全列を選ぶ。起きてしまったら `npx tsx scripts/repair-album-uids.ts` のdry-runで確認する。結果と対象をKoheiに示して承認を得てから `--apply` で直す。

## 障害時の確認順

1. `https://ryuryu-music-app.vercel.app/api/version` が返るか（デプロイが生きているか）。
2. Vercel の Logs でエラーを確認する。画面に「ログインの有効期限が切れました」と出る場合はセッション切れで、障害ではない。
3. Google Sheets API の失敗なら、サービスアカウント（`GOOGLE_SERVICE_ACCOUNT_KEY`）の共有設定とシート名・見出しを確認する（列は見出し名で解決するので、見出しの改名に注意）。
4. ジェネレーターだけ失敗する場合は Supabase の休止を疑う。管理画面から再開する。

## 担当

2026-11-11、**Koheiが担当**すると決定。定期実行の失敗確認、原因調査の依頼、復旧の判断を行う。本番Sheets（scores・Release Master・admin_logsなど）の変更・復元は、毎回Koheiの承認を得てから実行する。スクリプトは先にdry-runの結果を示す。本番Release MasterのApps Script（プロジェクト「popularity」）には触らない。

レビュー同期の確認待ち3件（Kairos／MENU／All Tomorrows）はKwisooの判断待ちのため、定期確認や復旧作業では解消しない。

## 片付けの記録

- 2026-11-10、本番に取り込み済みのローカルブランチ5本を削除。リモートの取り込み済みブランチ（`codex/oauth-security-update`・`feat/generator-*` 3本・`fix/supabase-keepalive-daily`）は残している。
- `app/generator/uipreview-temp/page.tsx` は、2026-09-09の利用者指示（モバイル再設計の受入まで残す）に従って残している。
- 空行の整理（bookmarks・sync_pending の削除が行を空にする方式）は、安定IDと参照を壊さない方法を決めるまで行わない。
