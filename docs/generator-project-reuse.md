# hyoryu-tools：旧プロトタイプDBの再利用

2026-09-05。ユーザー承認に基づき、旧`hyoryu-playlist-prototype`に画像ジェネレーターのDBを追加した。**既存プレイリストと画像は削除・変更していない。共有文書、対象別共同編集、履歴、非公開画像、個別プレビュー、PNG出力までローカル接続済み。** 2026-09-11に旧Vercelの停止状態とCron無効化を再確認した。

## 対象と実行結果

| 対象 | 状態・根拠 |
| --- | --- |
| Supabase | Organization `fvku's Org`、project ref `jmgpepnycyyjujkrrvwy`、東京。表示名`hyoryu-tools`への変更はユーザーへ依頼済み。2026-09-11の確認時は管理画面がサインイン画面へ遷移し、管理API認証も無いため完了未確認。[設定](https://supabase.com/dashboard/project/jmgpepnycyyjujkrrvwy/settings/general) |
| 旧Vercel | `fvkus-projects/prototype`、ID `prj_xbRKxSjaNMm9loxkzJt2QQRmqB80`。pause API成功、再取得で`paused:true`、公開URLがHTTP 503になった。[管理画面](https://vercel.com/fvkus-projects/prototype) |
| 旧Cron | `/api/cron/resolve`、`0 3 * * *`（UTC、JST 12:00）。2026-09-11にVercel Settings → Cron Jobsで無効化し、再取得で`disabledAt: 2026-09-10T15:02:09.987Z`を確認した。[無効化手順](https://vercel.com/docs/cron-jobs/manage-cron-jobs) |
| 新DB | `generator_*`の5テーブル、保存・ロック・履歴・構成版・画像ライフサイクル・再取り込みRPCを適用済み。[初期SQL](../supabase/migrations/202609040001_generator.sql)、[追加SQL](../supabase/migrations/202609050001_generator_completion.sql)、[再取り込みSQL](../supabase/migrations/202609110001_generator_reimport.sql)、[source更新SQL](../supabase/migrations/202609120001_generator_item_source.sql) |
| 新Storage | `generator-assets`作成済み。非公開、PNG/JPEG/WebP、1ファイル10MiBまで。サーバーで形式・寸法・40MP上限を検証してからready確定し、認可ルート経由で取得する。[画像実装](../lib/generator/image.ts) |
| 環境 | Git対象外の`.env.development.local`にサーバー専用接続を設定。既存legacy service_roleキーを利用し、DBパスワードはコピーしていない。ファイル権限600。Vercel Productionには`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`GENERATOR_ENABLED=true`を暗号化登録し、再デプロイはReady。Previewには本番DB接続を登録していない。[設定処理](../tools/generator-admin/configure.mjs) |

旧Vercelの停止は復旧可能で、デプロイ・環境変数・GitHubリポジトリは削除していない。Supabase自体を停止すると画像ジェネレーターも止まるので、SupabaseのPause/Deleteは今回の手順に含めない。[Vercelの停止・再開仕様](https://vercel.com/docs/projects/managing-projects)

## 既存データの保全

DB追加前に、`pl_*`の全行、列・制約・ポリシー、Storageのバケットとオブジェクト一覧をローカル退避した。退避ファイルを読み直してハッシュを確認し、DB追加と同じトランザクション内で追加前後の内容を照合した。既存内容に変化があれば追加処理をロールバックする方式。[実行スクリプト](../tools/generator-admin/reuse-project.mjs)

退避先：`.local/generator-migration-backups/playlist-1788540135591.json`。ディレクトリ700・ファイル600、Git対象外。データ本文には個人情報等を含み得るので、チャット・公開リポジトリへ添付しない。

内容SHA-256：`f2744ae5c0e5aa2a4d8be53f5ad9fbe141ea7926ba1140d13b72745eedfd8b61`。

| 保持したテーブル | 行数 |
| --- | ---: |
| pl_admin_users | 6 |
| pl_link_exclusions | 209 |
| pl_pending_links | 436 |
| pl_playlist_links | 33 |
| pl_playlist_tracks | 2,938 |
| pl_playlists | 34 |
| pl_resolve_jobs | 3,392 |
| pl_schema_migrations | 5 |
| pl_track_links | 5,015 |
| pl_tracks | 2,798 |

上記件数と既存`playlist-artwork`の画像等2,617件は、実DB集計と退避スクリプト出力で確認した。新しい非公開バケットとは別に保持している。旧`playlist-artwork`はもともと公開バケットであり、Vercel停止だけでは旧画像URLを非公開にしない。

**この退避は完全なDBバックアップではない。** 画像実体、Auth全体、秘密情報、全DBの復元用DDLは含まない。画像実体は元Storageに残した。将来の削除前には画像実体の退避と復元試験を別途行う。このJSONだけを根拠に元データを削除しない。

## DB追加・検証

適用ファイル：`202609040001_generator.sql`。SHA-256：`24264542c5e7705a4a27f659ad4c6e3ffd3c2d9675b4976a454e45cde6ae7345`。[SQL](../supabase/migrations/202609040001_generator.sql)

- `generator_documents/items/locks/revisions/assets`の5テーブルすべてRLS有効。
- anon／authenticatedは直接テーブル・RPCとも拒否。service_roleも直接テーブルと内部ヘルパーを拒否し、外向けRPCだけ実行可能。
- 実DBのトランザクション内でテスト文書作成、3対象の保存、1対象だけの過去版復元が成功。全書き込みをロールバックし、テスト文書が残らないことも確認。
- 実PostgREST経由の文書一覧読み取りが成功。Googleセッションから画面まで通したE2Eではない。
- 既存のStorage objectsポリシーは検査時0件。generatorの非公開バケットに匿名書き込みを許可するポリシーは追加していない。
- 追加SQLは適用トランザクション内で既存データのハッシュ不変を確認した。実DBの合成トランザクションで構成保存・再取り込みと画像準備・ready・読取を確認してロールバックした。
- 実Storageへ1px PNGをアップロードし、同一内容のダウンロード後に削除した。`_smoke`の一時オブジェクトは残していない。

根拠：[権限の確認処理](../tools/generator-admin/reuse-project.mjs)、[実DBスモークテスト](../tools/generator-admin/live-smoke.mts)。ローカルの本体テスト267件、ESLint、型検査、本番ビルドも成功した。

4つのマイグレーション（`202609120001_generator_item_source.sql`を含む）は**既に適用済み**なので、編集・再適用しない。以後の変更は新しい追加マイグレーションとこの適用記録を照合して進める。

## 今後の分離・削除方針

保存データは`pl_*`と`generator_*`、画像は`playlist-artwork`と`generator-assets`で分ける。ジェネレーター側にプレイリストのテーブル・画像への依存は作らない。[モデル](../lib/generator/model.ts)、[SQL](../supabase/migrations/202609040001_generator.sql)

将来プレイリストを消す場合は、削除直前に参照関係を再調査し、`pl_*`テーブルだけでなく専用ビュー・関数・トリガーと旧バケットも対象一覧にする。共有のAuth、publicスキーマ、Supabaseプロジェクト自体、generator側をまとめて削除しない。`DROP ... CASCADE`を無確認で使わない。現在は削除スクリプトを作成・実行していない。

名前・接頭辞・バケットを分けても、計算資源と管理権限は同じプロジェクトで共有される。新しいAPIキー名を作るだけでもテーブル単位の隔離にはならない。旧アプリには引き続き強い接続資格情報が残っており、失効・ローテーションは未実施。今後、再開要否と新環境の動作を確認してから整理する。[Supabaseのキー権限](https://supabase.com/docs/guides/getting-started/api-keys)

## 残件

1. Supabase表示名を`hyoryu-tools`に保存したことの確認。管理画面へのユーザーのサインインが必要。
2. 旧アプリの接続資格情報の整理。旧コード・設定を残しているため、再開要否を決めるまでは削除・ローテーションせず、旧アプリを無断再開しない。
3. Claude側でモバイル版のUIと提供機能を再検討し、合意後に実装する。固定データの`app/generator/uipreview-temp/page.tsx`はその受入完了まで残し、最終公開前に削除する。
4. 再設計後の物理iPhone実機で、日本語IME、写真入力、画面回転、スリープ復帰、連続PNG／ZIPを受入確認する。
5. 物理的に異なる3端末での同時編集と、突然切断後の実時間3分失効を確認する。3 actorを分離した実共有DB／実UIでは、同時保存、他者ロック、同一人物の端末引き継ぎ、旧端末の保存拒否まで確認済み。
6. ProductionでユーザーがGoogleへ再ログインした状態の通しスモークを行う。未ログイン画面と認証要求までは確認済み。
7. Safari／Edge／Braveの最終受入。2026-09-10の実行環境ではSafari／Edgeを操作対象として取得できず、BraveはComputer Useの許可が得られなかった。Chromeの受入は完了済み。
