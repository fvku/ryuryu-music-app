# 画像ジェネレーター：共有保存の実装状況

更新日：2026-09-08。**既存プロトタイプのSupabaseへ初期SQLと追加マイグレーションを適用し、非公開バケット、ローカル開発接続、Vercel Production接続を設定済み。ローカル・本番画面ではRelease Master取り込み、共有文書、全項目編集、対象別ロック・保存・履歴復元、画像アップロード、PNG書き出しを利用できる。** Previewには本番DBの接続情報を登録していない。最新の適用状況・保全データ・残件は[DB再利用の記録](./generator-project-reuse.md)を参照。

操作仕様は[仕様書](./generator-specification.md)、従来の設計は[統合計画](./generator-integration-plan.md)を参照。本書は今回のコードと未接続部分を区別する実装記録。

## 1. 実装した範囲

| 対象 | ローカル実装 | 未接続・未実装 |
| --- | --- | --- |
| 保存形式 | 企画・期間、元データと編集内容、ページ、全書式、画像ID、Monthly／Japan／WeeklyのRelease Master取り込み | 確認版下書きからの変換 |
| 認可 | 既存許可リスト＋Google確認済みメールを全APIで検査 | 実アカウントでのログイン統合試験 |
| 保存 | 文書作成・一覧・読込、全項目編集、アルバム／ページ色／共通設定／構成の対象別保存、アカウント別ブラウザ復旧 | 共有DBへの自動保存は採用せず、対象別の明示保存をv1仕様とする |
| ロック | 対象別取得・30秒延長・解放・編集者表示・同じ人の端末引き継ぎUI、3分失効 | 3端末受入 |
| 履歴 | 保存と履歴の同時確定、履歴画面、対象別の過去版復元 | 過去版の独立プレビュー、文書全体の一括復元 |
| 画像 | MIME・マジックバイト・寸法・10MB／40MP検査、非公開Storageへの準備・確定・認可読取 | 実機の写真入力受入 |
| 描画 | Monthly／Japanの採用・掲載、Weeklyの表紙・メイン・Others、即時プレビュー、はみ出し検査、1200／2400px PNG・全ページZIP。実共有W36文書で7枚ZIPまで確認済み | 物理iPhone実機での反復出力負荷試験 |
| 構成 | 構成版、構成ロック、採用／掲載内の並び替え、Weeklyのメイン↔Others swap、対象別復元 | 作品追加・削除・再取り込み |

根拠：[保存型と検証](../lib/generator/model.ts)、[認可](../lib/generator/access.ts)、[HTTP API](../app/api/generator/documents/route.ts)、[SQL](../supabase/migrations/202609040001_generator.sql)。確認版の描画・IndexedDBは今回変更していない。

## 2. 保存と競合の契約

[正式な文書型](../lib/generator/model.ts)の`schemaVersion`は1。確認版の同名の版番号とは別形式で、自動変換しない。Monthly／Japanは月初から翌月初。Weekly文書の識別期間は対象金曜から翌金曜まで、Release Masterの抽出は投稿金曜までの土曜〜金曜で、`#`列を`period.weekNumber`として保持する。`rendererVersion`は`weekly-v1`。

アルバムは文書内IDとRelease Master UIDを区別し、取り込み元の値を`source`、編集値を`content`に保持する。並びは`pages[].itemIds`を正とし、`items`配列の応答順には依存しない。画像実体・一時URL・秘密情報は文書に含めず、画像IDを使う。企画の詳細な抽出条件を保持する項目は未追加で、取り込みアダプター実装時に設計する。

保存は文書全体の置換ではなく、アルバム内容・ページ色・共通デザインごと。対象版と有効なロックが一致した場合だけ更新する。別アルバムや掲載上下、ページ色の変更を古い全体データで上書きしない。DB処理中だけ文書行を短時間ロックするが、利用者が編集中ずっと企画全体を占有する方式ではない。[保存SQL](../supabase/migrations/202609040001_generator.sql)

ロックトークンはクライアントで生成する暗号学的乱数32バイトの小文字16進文字列を想定し、サーバーではSHA-256ハッシュへ変換する。所有者・画面ID・世代・ハッシュ・DB時刻の期限を照合し、失効後の延長や引き継ぎ前の旧端末からの保存を拒否する。[操作検証](../lib/generator/commands.ts)

同一の保存を再送するときは、`requestId`と本文を変えない。一度確定した操作の再送は再度履歴を作らず、同じIDで別内容を送れば409。統合画面も、通信失敗または5xxで結果が不明な保存を同じ内容で再試行するときは同じ`requestId`を再利用する。復元も現在の対象版とロックを必要とし、過去版のその対象だけを新しい版として保存する。[SQL検証](../lib/generator/__tests__/database.test.ts)

## 3. API

すべて`/api/generator/documents`配下。入力型は[モデル](../lib/generator/model.ts)・[操作パーサー](../lib/generator/commands.ts)、サンプル文書は[テストfixture](../lib/generator/__tests__/fixture.ts)を参照する。fixtureは実データではない。

| メソッド・相対パス | 入力／用途 |
| --- | --- |
| GET `/` | 最新100文書の概要 |
| POST `/` | `{requestId, document}`で作成 |
| GET `/:id` | 保存済み文書、対象別版、公開可能なロック情報 |
| PATCH `/:id` | 対象の保存、または`restoreVersion`を指定した復元 |
| POST `/:id/locks` | `action: acquire / heartbeat / release / transfer` |
| GET `/:id/revisions?before=N` | Nより前の履歴メタデータ、最新50件 |
| POST `/:id/assets` | ロックを伴う画像検証・非公開Storage保存・ready確定 |
| GET `/:id/assets/:assetId` | 同じ文書に属するready画像だけを認可取得 |

PATCHには`requestId, kind, targetId, clientId, token, generation, expectedVersion`と、`content`または`restoreVersion`の片方を送る。`kind`は`item / page / theme`。ページ内容は`{bgColor}`のみ。themeとstructureの対象IDには文書IDを使う。ロックAPIは`structure`も受け付け、延長・解放では`generation`が必須。[ルート実装](../app/api/generator/documents/)、[操作検証](../lib/generator/commands.ts)

全APIで毎回許可メンバーを検査し、更新者はセッションから確定する。クライアント指定のメールは受け付けない。書き込みは同一OriginとJSONを必須とし、本文は実際の読み込み量で1MiBまで。レスポンスはキャッシュしない。[HTTP処理](../lib/generator/http.ts)、[認可・入力制限](../lib/generator/access.ts)

ローカルの本番モード確認に限り、`GENERATOR_LOCAL_PREVIEW_AUTH_BYPASS=true`と`GENERATOR_LOCAL_PREVIEW_ACTOR=<許可メンバー>`をプロセスへ一時指定するとGoogle OAuthを迂回できる。`AUTH_URL`または`NEXTAUTH_URL`のホストがlocalhost／loopbackで、Vercel環境ではなく、指定actorが許可リストに含まれる場合だけ有効。本番・Previewデプロイの環境変数には登録しない。この迂回は認証入口だけで、共有DB、対象別ロック、Origin検査、版競合、履歴、Storageの経路は変えない。

- 401：ログインまたはGoogle再ログインが必要。403：現在の許可リスト外、またはOrigin違反。
- 400／413／415：入力形式・サイズ・Content-Typeの不備。
- 409：版・ロック・画像準備状態・期間重複等の競合。最新状態の確認が必要。
- 503 `GENERATOR_NOT_CONFIGURED`：共有保存未設定。ローカル下書き成功とは別。
- 503 `STORAGE_UNAVAILABLE`：外部保存の失敗または結果不明。成功扱いにせず、結果不明時は同じ操作ID・本文で再確認する。

実装根拠：[エラー変換](../lib/generator/repository.ts)、[HTTP検証](../lib/generator/__tests__/http.test.ts)。

## 4. 認証とDBの境界

既存NextAuthと許可アドレスの完全一致判定を継承した。Googleのログインコールバックで確認済みメールを署名付きJWTに記録し、ジェネレーターだけがこの証明を要求する。既存セッションやSpotifyだけのログインは、ジェネレーターではGoogleへの再ログインが必要。既存アプリ全体の許可条件は変えていない。クライアントのセッション更新内容から認証証明を作らない。[認証変更](../lib/auth.ts)、[証明の設定](../lib/auth-identity.ts)、[許可判定](../lib/member-access.ts)。確認済みメール情報の根拠は[Auth.js公式資料](https://authjs.dev/reference/core/providers/google)。

[マイグレーション](../supabase/migrations/202609040001_generator.sql)は5テーブルのRLSを有効化し、PUBLIC・anon・authenticated・service_roleの直接テーブル権限を取り消す。service_roleに付与するのは外部呼び出し用RPCの実行権だけ。内部ヘルパーは公開しない。RPCは`SECURITY DEFINER`、空の`search_path`と完全修飾名を使う。初期設計のinvoker優先案から、テーブル操作をRPCに限定する方式へ具体化した。実際のSupabaseでも適用後に再検査する。[公式の関数セキュリティ指針](https://supabase.com/docs/guides/database/functions)

これはSupabase Authの利用者別JWTで直接DBへアクセスする設計ではない。NextAuthの利用者認可をNext.jsサーバーが担い、DBは信頼されたRPC引数の更新者を記録する。サーバー秘密キーを持つ主体はこの境界を突破できるので、ブラウザへの配布・公開環境変数への登録を禁止する。[サーバー専用通信](../lib/generator/repository.ts)、[Supabaseのキー区分](https://supabase.com/docs/guides/getting-started/api-keys)

## 5. 接続状況と未確認事項

進捗追記：新規プロジェクトを作る計画はユーザー承認により取りやめ、既存`jmgpepnycyyjujkrrvwy`を共用する。ローカル開発用の接続は`.env.development.local`に登録済み。以下の未登録確認と手順は接続前の履歴であり、最新の状態は[再利用記録](./generator-project-reuse.md)を正とする。

ローカル開発環境とVercel Productionには次の契約に沿った接続を設定済み。Productionの値は暗号化されたサーバー環境変数で、Previewには登録していない。

| サーバー環境変数 | 用途 |
| --- | --- |
| `SUPABASE_URL` | 選択した検証プロジェクトのHTTPS URL。現実装は`*.supabase.co`のみ |
| `SUPABASE_SECRET_KEY` | サーバー用secretキー。こちらを優先 |
| `SUPABASE_SERVICE_ROLE_KEY` | legacyキーを使う場合の代替。両方は不要 |
| `GENERATOR_ENABLED` | `true`のときだけ外部接続。有効化前は未設定エラー |

設定契約は[repository.ts](../lib/generator/repository.ts)が根拠。キー値はチャットに貼らず、ローカルの保護された環境ファイルまたは承認したVercel環境へ登録する。`NEXT_PUBLIC_`は付けない。マイグレーションは適用済みで再適用しない。

機能版以後は次の順序で進める。

1. Supabaseの表示名変更と旧Vercel Cron無効化を管理画面で完了確認する。
2. Claude Codeで画面遷移・情報設計・ビジュアルデザインを仕上げ、機能変更が必要な箇所はCodexへ相談事項として引き継ぐ。保存契約と文書形式は維持する。
3. 別ブラウザ・別端末の3人で同時編集、切断、失効、引き継ぎ、履歴復元を受入確認する。
4. iPhone実機でIME・写真入力・共有・スリープ・連続PNG負荷を確認する。
5. 最新`origin/main`との差分は2026-09-08に統合し、`main`へpush、本番デプロイまで完了した。Previewへ本番DBの秘密鍵を共有する場合は、用途とデータ分離を先に決める。

## 6. 検証記録（2026-09-08）

- `npm test -- --reporter=dot`：Weeklyの土曜〜金曜境界、`#`列の必須性・一意性、WEEK列の抽出・重複除去、文書検証、swapの件数不変、Monthly／Japan回帰を含む。最新件数はUI実装記録§16を正とする。
- `npx --no-install tsc --noEmit --incremental false`：成功。
- 変更した認証・ジェネレーターのTypeScriptとAPIを対象にしたESLint：成功。
- `npm run build`：成功。最初のsandbox実行はポート制約で失敗し、承認された環境で再実行して成功。デプロイではない。

DBテストはdev依存の[PGlite](https://pglite.dev/docs/)による一時的なメモリ内DBに、実際のマイグレーションを適用する。[テストコード](../lib/generator/__tests__/database.test.ts)。3対象の更新、掲載上下と背景色の独立性、期限・世代による拒否、再送、対象別復元、画像不備、履歴書き込み失敗時のロールバック、直接権限の拒否を確認した。単一プロセスのエンジンであり、実Supabaseの複数接続・分散同時実行の証明ではない。

HTTPテストは認証・外部fetchをモックして実ルートを呼び出す。匿名・古いセッション・Spotifyのみ・許可取消しの拒否、サーバー更新者、未設定503、秘密値を返さないことを確認した。実Supabaseではロールバック付き保存・復元とPostgREST読み取りを確認。ローカル画面では実Google OAuth、Release Master読み取り、文書作成・再読込、2026年8月Monthlyの11作品・9画像プレビューまで成功した。3人同時操作と公開環境のE2Eは未実施。[HTTP検証](../lib/generator/__tests__/http.test.ts)

Weeklyの取込APIは実Release Masterを読み取り、`#35`がメイン5件＋Others 26件、`#36`がメイン5件＋Others 30件になり、全66件にジャケットURLがあることを確認した。実共有W36文書を作成し、swap保存・構成復元・作品保存・作品復元をversion 1〜5で確認後、元の内容とロック0件へ戻した。`weekly_26_W36.zip`は全7枚のCRC・2400×2400寸法・代表3面の目視に成功した。iPhone 17 Pro Simulatorの日本語表示と狭幅レイアウトも確認した。
