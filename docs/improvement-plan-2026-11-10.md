# アプリ改善プラン（統合版）

> **結果（2026-11-11追記）**: 第1〜5段階はすべて本番へ反映済み。第1段階＝[PR #20](https://github.com/fvku/ryuryu-music-app/pull/20)、第2段階＝[PR #25](https://github.com/fvku/ryuryu-music-app/pull/25)（Apps Script の編集履歴は 2026-11-10 に本番の Release Master へ設置。見出し対応は [PR #27](https://github.com/fvku/ryuryu-music-app/pull/27)）、第3段階＝[PR #22](https://github.com/fvku/ryuryu-music-app/pull/22)、第4段階＝[PR #23](https://github.com/fvku/ryuryu-music-app/pull/23)、第5段階＝[PR #24](https://github.com/fvku/ryuryu-music-app/pull/24)。途中で見つかった albumUid の食い違い34件は [PR #26](https://github.com/fvku/ryuryu-music-app/pull/26) のスクリプトで修復した。#21 は #25 に取り込んで閉じた。以下の本文は計画時点の記録で、チェック欄や「今回お願いする確認」は当時のまま。運用は [運用ガイド](operations.md) を参照。

2026-11-10。対象は [Claudeの調査](../docs/review-2026-11-10-claude.md) と [Codexの調査](../docs/review-2026-11-10-codex.md)。修正ブランチは `codex/oauth-security-update`。認証対策は [Draft PR #20](https://github.com/fvku/ryuryu-music-app/pull/20)（最新 `13baa9d`）で確認中。最初の修正は最新の `origin/main`（`4dc0e54`）を起点とする。

## 合意した方針

- レビューが競合した場合は、ユーザー指定により **記録時刻が新しい方を採用**する。
- Googleの確認済みメールと現在の許可メンバー一覧で、アプリの利用者を識別する。Spotifyは再生用の接続として使う。[Spotifyのemailは本人確認済みではない](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile)ため、ログイン許可の根拠にしない。
- 一度に本番の保存構造を大きく変えず、認証→記録保護→表示・操作→運用の順に、検証できる単位で反映する。
- 本番シートのデータ整理・削除・移行は、対象・バックアップ・dry-run結果を先に用意する。

## 1. 認証と依存関係の修正

対応: Claude A1〜A5・D1、Codex C01〜C04。

- [x] SpotifyコールバックのXSS対策とstateの発行・照合・終了処理。
- [x] Next.js 16.4.6、next-auth beta.32と関連依存の更新。
- [x] Googleの確認済みメールでのみアプリへログインできるよう変更。
- [x] 古いSpotifyセッション・本人確認情報のない旧セッション・許可リストから外れたセッションを、画面と通常APIの両方で拒否。
- [x] レビュー、レコメンド、設定、Sheets照会、Spotify取得APIの読み取りを保護。
- [x] 通常の書き込みAPIに同一オリジン確認を追加。外部ツールのRelease Master読み取り用Bearerトークンは維持。
- [x] 同期APIのGETはCRON_SECRET、ブラウザ利用はメンバー認証付きPOSTに限定。
- [x] 主要な外部エラー本文をクライアントへ直接返す処理を縮小。
- [x] PRでLint・テスト・本番ビルドを実行するGitHub Actionsを追加。
- [x] 最初のセキュリティ修正コミットでGitHub ActionsのChecks成功、Vercelプレビュー成功。
- [x] 実アカウントでのGoogleログイン・Spotify接続を確認。2026-11-10、127.0.0.1の設定画面からSpotify接続成功をユーザーが確認。
- [x] 最新コミット13baa9dのGitHub Actions ChecksとVercelプレビュー成功。
- [x] ホーム・タイムライン・マイページの既存一覧、M/J曲一覧と再生の実操作確認。2026-11-10、ユーザーが成功を確認。
- [ ] 本番反映後の確認。

実装の主な根拠: [ログイン設定](../lib/auth.ts)、[セッション判定](../lib/member-access.ts)、[通常APIガード](../lib/member-auth.ts)、[OAuthテスト](../lib/spotify-oauth.test.ts)、[API認可テスト](../lib/member-auth.test.ts)、[CI](../.github/workflows/checks.yml)。

ローカル検証は全489テスト・Lint・本番ビルドが成功。本番依存の `npm audit --omit=dev` は0件となった。`googleapis-common` が固定するgaxios 7.1.3を、同じメジャーの7.3.1へoverrideして古いglob系の依存を除いた。実際のRelease Masterのヘッダー1行を読み取り、Google APIへの接続も成功した。overrideは上流の依存更新後に除去を検討する。開発依存には型解析ツールに連なるModerate 7件が残り、第5段階で扱う。

CIを必須にしてマージを制限するリポジトリ設定は、ワークフロー追加とは別作業。実際のChecksが成功してから設定する。[GitHub公式のCI手順](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)を参照。

## 2. 新しいレビューを失わない同期へ変更

編集履歴の準備は別ブランチ `codex/review-edit-journal` の [Draft PR #21](https://github.com/fvku/ryuryu-music-app/pull/21)。導入する[Apps Script](../apps-script/ReviewJournal.gs)と[空のテストファイルでの確認手順](../docs/review-edit-journal.md)を用意した。30件の追加テストが成功。テスト専用ファイルでの設置・実ランタイム確認（変更・削除・0点・一括貼り付け・設置再実行）は完了。本番設置・アプリの履歴取り込みはまだ行っていない。記録時刻はハンドラー起動時刻であり、厳密な編集発生時刻とは区別する。

対応: Claude B1〜B3、Codex C05・C06・C14・C15・C20・C21。

受入条件:

1. 比較単位を `albumUid × member` に統一する。タイトル変更で新規レビューを作らない。
2. アプリのsubmittedAtとRelease Masterのレビュー編集日時を、UTCの記録時刻として比較する。
3. **Release Masterの現状には編集日時がないため、検出時刻を編集時刻として代用しない。** 履歴のない既存セルは時刻不明として退避し、アプリの既存レビューを無条件に上書きしない。
4. 以降の手入力の編集時刻を残すため、Release Masterに紐付くApps Script等の記録処理を用意する。APIによる書き込みはonEditが動くことを前提にせず、アプリ側でも同じ記録形式を保存する。
5. 同時刻で内容が違う場合、または時刻を確認できない場合は両方を残して確認対象にする。
6. 点数を「なし」にする変更、コメントだけの変更、削除をそれぞれ表現する。空値を「未取得」と混同しない。
7. 両方の保存先への反映の片方が失敗した場合は、画面に部分成功を伝え、安全に再送できるようにする。
8. 同時投稿・再送に同じ操作IDを使い、重複追加を防ぐ。アルバム追加も行番号の衝突を防ぐ。
9. キャッシュ無効化の最中に完了した古い読み取りで、旧データを再保存しない。
10. ブラウザ訪問依存の同期を減らし、単一実行・再試行・実行結果を確認できる形にする。

この段階でお願いする作業: 用意した時刻記録処理をRelease Masterへ設置し、テスト用セルで記録されることを確認する。**スクリプトと手順の実装・テストが完了してから依頼するため、現時点ではシート設定の作業は不要。** 過去データの日時を現在時刻で埋める作業は行わない。

現行の問題箇所: [二重保存](../app/api/scores/[albumNo]/route.ts)、[同期](../app/api/cron/sync-release-master/route.ts)、[キャッシュ](../lib/api-cache.ts)。

## 3. 執筆・保存操作でデータを失わないようにする

対応: Codex C07〜C11・C19。

- Spotifyの曲が読み込み中・取得失敗でも、保存済みのおすすめ曲を維持する。明示的な解除だけを削除として送る。
- M/J執筆に版の確認と競合通知を加え、他の人の保存を上書きしない。
- レビューとM/J原稿に未保存確認・復旧用下書きを用意する。
- ブックマークのHTTP失敗を成功表示しない。
- 投稿・採用変更・保存解除・レコメンド後に、一覧と詳細を同じ内容へ更新する。
- Spotify解除時のrefresh Cookieを削除する。接続ポップアップのキャンセル・ブロック・タイムアウト時の終了処理は第1段階で対応済み。

現行の問題箇所: [M/J保存](../components/MjWritingModal.tsx)、[曲選択](../hooks/useMjTracks.ts)、[ブックマーク](../hooks/useBookmark.ts)、[Spotify接続](../lib/spotify-token.ts)。

## 4. 一覧・Spotify・アクセシビリティの修正

対応: Claude C1・C2、Codex C12・C13・C16〜C18、および追加の使い勝手候補。

- フィルター変更時のタイムライン監視を付け直す。
- Kaedeを含むメンバー定義を一元化する。
- Spotifyの全ページを読み、複数枚組のトラックはURI等で識別する。
- 取得失敗・空一覧・未取得を区別し、再ログインや再試行へ進めるようにする。
- アルバムカードとモーダルをキーボードで操作できるようにし、拡大制限を見直す。
- 画面移動での全再読み込みを減らす。スマホ回線で表示時間を測り、必要なら取得・描画を段階化する。
- フィルター全解除、Up Nextの対象、アプリ内の詳細共有、新着通知、Spotify外画像は、実際の利用頻度を確認して改善する。

現行の問題箇所: [タイムライン](../app/recommend/page.tsx)、[メンバー読取](../app/api/release-master/route.ts)、[トラックAPI](../app/api/spotify/tracks/route.ts)、[カード](../components/AlbumCard.tsx)。

## 5. 運用と保守

対応: Claude B4・B5・D2〜D6。

- 本番ログ・Cron失敗通知・バックアップと復元手順を確認する。外部での監視の有無はリポジトリだけでは判断しない。
- データの保管先が複数あること自体を問題とせず、休止・削除・障害時の復旧方法と担当を明確にする。
- テストは利用者の操作と失敗時の結果を重視する。ジェネレーターには既存のAPI・DBテストがあるため、「すべてライブラリ単体テスト」というClaude D3の記述は訂正して扱う。
- 一時プレビュー画面、巨大ファイル、古いドキュメント、列位置コメント、不要ブランチを整理する。
- 空行の整理は安定IDと参照を壊さない方法を選ぶ。先に削除はしない。
- 開発依存に残る監査指摘は、修正版の互換性を確認して更新する。無理なメジャー置き換えで監査件数だけを下げない。
- 本番Nodeバージョン、未マージ通知ブランチ、重複Vercelプロジェクトの状態を確認する。

既存API・DBテストの根拠: [HTTP契約テスト](../lib/generator/__tests__/http.test.ts)、[DBトランザクションテスト](../lib/generator/__tests__/database.test.ts)。

## 今回お願いする確認

ローカル確認用サーバーを起動して案内した後、同じMacのブラウザで実施する。ローカル版も現在のGoogle Sheetsに接続する。

事前設定: [Spotify公式要件](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)ではlocalhostが許可されないため、開発用のAUTH_URLとNEXTAUTH_URLを `http://127.0.0.1:3000` に揃えた。Spotify Dashboardの対象アプリには `http://127.0.0.1:3000/api/spotify-oauth/callback`、Google Cloudの対象OAuthクライアントには `http://127.0.0.1:3000/api/auth/callback/google` を、既存のリダイレクトURIへ追加する。

1. `http://127.0.0.1:3000/login` を開き、許可メンバーのGoogleアカウントでログインする。以前のセッションで戻される場合も、この画面からGoogleへ再ログインする。
2. ホーム・タイムライン・マイページに既存データが表示されることを確認する。
3. マイページの設定からSpotifyを接続する。認可後にアプリへ戻り、「接続済み」になることを確認する。
4. M/J文章の既存アルバムを開いて、トラック一覧を確認する。Premiumを使っていれば再生も確認する。
5. このチャットに `Google: OK/NG、一覧: OK/NG、Spotify接続: OK/NG、曲一覧/再生: OK/NG` と返す。NGなら表示されたエラー文を添える。

本番反映の判断は、この確認とCI結果を揃えてから行う。ブランチ保護や時刻記録処理など、追加の設定が必要な段階では、その時点で具体的な操作手順を渡す。
