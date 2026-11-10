# アプリ課題調査 — Codex

> **記録について（2026-11-11追記）**: この文書は[調査対象のコミット `64ef156`](https://github.com/fvku/ryuryu-music-app/tree/64ef156)に対する当時の課題と検証結果を保存したもの。修正の結果は[改善プラン冒頭](improvement-plan-2026-11-10.md)を参照。相対リンクは現在のファイルを開くため、根拠をたどる際は調査対象コミットの同じファイルを確認する。「調査時○行」はそのコミットでの行番号。

調査日: 2026-11-10（日本時間）。対象: ローカルcheckoutのコミット `64ef156`。Claudeの調査結果は読まず、独立して調査した。これは課題一覧であり、最終的な改善プラン・実装順序はまだ決めていない。

最も優先して扱うべきなのは、APIの認証漏れ、Spotify接続のXSS、保存した内容が失われる経路である。画面の見た目を変える前に、データの保護と保存結果の信頼性を確認したい。

## 調査範囲と確認の強さ

- 主にホーム、タイムライン、マイページ、レビュー、M/J執筆、認証、Sheets同期、Spotify連携をコードから確認した。Weeklyと画像ジェネレーターはAPI・保存設計・既存テストを中心に確認した。
- **ブラウザ再現**: ローカルサーバーでログイン画面とSpotifyコールバックを確認。XSSはページタイトルを `AUDIT_XSS_PROOF` に変えるだけの無害な入力で再現した。
- **モック再現**: 実際のAPIハンドラーとキャッシュ関数を読み込み、外部サービスをすべて偽データに置き換えた追加テスト8件が成功。実際のSheetsへの並行書き込みや本番攻撃を実施したという意味ではない。
- **コード確認**: 条件と処理の経路がコードに存在することを確認したもの。発生頻度・本番データでの発生有無は別途確認が必要。
- Googleログイン後の主要画面全体、実機のタッチ操作、本番の応答速度、実際の共同編集は未検証。本番データ・外部サービスの設定は変更していない。
- アプリの実装コードは変更していない。追加したのはこの調査資料と再現テストのテキストのみ。

優先度は **P1 = 情報公開・不正操作・データ消失につながるため先に対処を検討**、**P2 = 利用時の誤認や作業の中断につながるため通常の改善対象** とした。全利用者・全条件で常に発生するという評価ではない。

## 課題一覧

| ID | 優先度 | 課題 | 確認方法 |
|---|---|---|---|
| C01 | P1 | Spotifyコールバックで任意のJavaScriptが実行される | ブラウザ再現 |
| C02 | P1 | レビュー・レコメンドの読み取りAPIが未認証 | モック再現 |
| C03 | P1 | 書き込みを行う同期APIを未認証GETで実行できる | モック再現 |
| C04 | P1 | Spotify OAuthにstateによる往復の検証がない | コード確認 |
| C05 | P1 | 新しいレビューがRelease Masterの古い内容へ戻されうる | モック再現＋コード確認 |
| C06 | P1 | 同時追加でアルバムを上書き／レビューを二重登録しうる | モック再現 |
| C07 | P1 | 曲の取得失敗・取得前の保存で既存のおすすめ曲を消せる | コード確認 |
| C08 | P1 | M/J執筆の同時編集で他の人の変更を上書きできる | コード確認 |
| C09 | P2 | ブックマークの保存失敗を成功表示する | コード確認 |
| C10 | P2 | 保存結果が元の一覧や別セクションへ反映されない | コード確認 |
| C11 | P2 | レビュー・M/J原稿を閉じる操作で未保存入力を失う | コード確認 |
| C12 | P2 | フィルター変更後、タイムラインの続きを読み込めなくなる | コード確認 |
| C13 | P2 | KaedeのRelease Masterスコアが直接表示されない | モック再現 |
| C14 | P2 | キャッシュ破棄後も古いデータが復活する | モック再現＋コード確認 |
| C15 | P2 | Release Master同期がホームへの訪問に依存する | コード確認 |
| C16 | P2 | 多曲数・複数枚組のアルバムのトラック処理が不完全 | コード確認 |
| C17 | P2 | 取得失敗が「データなし」として表示される | コード確認 |
| C18 | P2 | キーボード・拡大・読み上げの基本操作に不足がある | コード確認 |
| C19 | P2 | Spotifyの解除・接続キャンセルが最後まで処理されない | コード確認 |
| C20 | P2 | 同期処理でUIDが使われず、改名後に別レビューを作りうる | コード確認 |
| C21 | P2 | 点数もコメントもないレビューを投稿できる | モック再現 |

## 各課題の根拠

### C01 — Spotifyコールバックの反射型XSS

`error` クエリを `JSON.stringify()` して、そのままHTMLのインラインscript内へ埋めている。HTMLのscript終端を防ぐ処理がないため、外から渡した文字列がscript要素を抜け出せる。

ローカルで、scriptを閉じて別scriptでページタイトルだけを変更する入力を送り、実際にタイトルが変わることを確認した。ログインは不要だった。同一オリジンでのスクリプト実行なので、ログイン済み利用者が細工されたURLを開いた場合、セッションを使ったAPI操作やlocalStorageへのアクセスへつながる可能性がある。これらの攻撃連鎖は実行していない。

根拠: [HTML生成（調査時6行）](../app/api/spotify-oauth/callback/route.ts)、[errorの埋め込み（調査時24行）](../app/api/spotify-oauth/callback/route.ts)。改善の論点は、外部入力を実行可能HTMLへ入れない構成と、この入力経路の回帰テスト。

### C02 — ログイン必須の画面と公開APIの不整合

`/api/scores`、`/api/scores/[albumNo]` のGET、`/api/recommendations` の通常GETは認証していない。レビュー本文、投稿者のメール、レコメンド先メールなどを含む行が返る。`forUser=me` の場合だけは認証される。

画面のmiddlewareは `/api` を対象外にしているため、画面のログイン制限ではこれらのAPIは守られない。追加テストではセッションなしでも3つのGETが200を返し、認証関数を呼ばないことを確認した。古い使い方説明にはレコメンドの公開を示す記述もあるため、「何を公開するか」の意図は確認したいが、メールを含む全行の公開は独立して見直す必要がある。

根拠: [scores GET（調査時7行）](../app/api/scores/route.ts)、[個別GET（調査時11行）](../app/api/scores/[albumNo]/route.ts)、[recommendations GET（調査時9行）](../app/api/recommendations/route.ts)、[middleware（調査時24行）](../middleware.ts)。API自身での認可は[Next.js公式のガイド](https://nextjs.org/docs/app/guides/authentication#route-handlers)にも示されている。

### C03 — データを書き換える同期処理が未認証

`/api/cron/sync-release-master` は、認証・CRON_SECRET・Originの確認なしでGETを受け付け、scores更新、UID採番、UID紐付けを実行する。ブラウザからの通常GETで起動できる。`running` と5分の制限は同一プロセス内の変数であり、呼び出す権限の確認にはならない。

追加テストではセッションなしの呼び出しが同期更新処理まで進むことを確認した。外部から任意の本文を直接注入するAPIではないが、第三者が書き込み処理を起動でき、API消費や並走の原因になる。

根拠: [GET入口（調査時44行）](../app/api/cron/sync-release-master/route.ts)、[scores更新（調査時164行）](../app/api/cron/sync-release-master/route.ts)、[UID更新（調査時231行）](../app/api/cron/sync-release-master/route.ts)。同じプロジェクトの[playlist cron（調査時26行）](../app/api/cron/sync-playlist-tags/route.ts)にはCRON_SECRET確認がある。

### C04 — Spotify OAuthのstate未検証

独自のSpotify接続フローは、開始時にstateを作らず、コールバックでも照合していない。開始したブラウザの操作と、返ってきた認可コードを結び付ける確認がない。アカウントの誤接続や認証CSRFへの備えが不足している。

根拠: [認可URL生成（調査時5行）](../app/api/spotify-oauth/route.ts)、[コールバック（調査時17行）](../app/api/spotify-oauth/callback/route.ts)。[Spotify公式](https://developer.spotify.com/documentation/web-api/tutorials/code-flow)はstateの利用と応答時の照合を説明している。実際のアカウント差し替え攻撃は未実施。

### C05 — レビューの二重保存と同期で新しい内容が戻る

scoresへ保存した後にRelease Masterへ書くが、点数がnullならRelease Masterへの書き込みを飛ばす。例えば「8点・旧コメント」を「点数なし・新コメント」に変更しても、Release Masterには8点のまま残る。同期処理はRelease Masterの値を優先し、scoresのほうが新しいかを比べずに上書きする。

追加テストでは、点数をnullにしたPUTが200を返してもRelease Master書き込みが呼ばれないこと、古い値のpendingが待機時間を超えるとscoresへ8点・旧コメントを書き戻すことを別々に再現した。数値のあるレビューでもRelease Masterへの書き込み失敗時には同じ不整合が起きうる。APIはwarningを返すが、フォームはwarningを表示しない。

表示面でもRelease Master優先の集計と、不一致のアプリスコアを隠す処理があるため、「保存できたのに点数・コメントが戻る／消える」という見え方になりうる。

根拠: [PUTの二重保存（調査時133行）](../app/api/scores/[albumNo]/route.ts)、[同期の上書き（調査時124行）](../app/api/cron/sync-release-master/route.ts)、[優先集計（調査時117行）](../lib/score-utils.ts)、[不一致非表示（調査時153行）](../lib/score-utils.ts)、[フォームの成功判定（調査時79行）](../components/review-modal/ReviewForm.tsx)。正本・競合解決・部分成功の扱いを一緒に決める必要がある。

### C06 — 同時書き込みの衝突と二重登録

アルバム追加は「最終行を読む→次の行番号を計算→指定セルへ書く」方式。2人が同じスナップショットを読むと、別アルバムでも同じ行へ書く。追加テストで2リクエストがともに成功を返し、どちらもC3など同じ行を更新することを確認した。Weeklyの追加も同様に次の行番号を計算する。

レビューは2回の事前チェックがあるが、確認とappendが一体ではない。追加テストでは2リクエストが両方201となり、append相当の関数が2回呼ばれた。ブックマークにも重複チェックがなく、複数登録後の解除は最初の1行だけを消す。

根拠: [アルバム追加の行計算（調査時86行）](../app/api/sheets/add-album/route.ts)、[Weekly追加（調査時368行）](../lib/ops/weekly.ts)、[レビューの再チェック（調査時64行）](../app/api/scores/[albumNo]/route.ts)、[ブックマーク追加（調査時282行）](../lib/sheets.ts)、[解除（調査時442行）](../lib/sheets.ts)。保存先を変更するかどうかより先に、同時実行と再送時の保証を定義したい。

### C07 — Spotify取得状態と既存の曲選択が分離されていない

M/J執筆のselectedTrackはnullで初期化され、Spotify取得後に初めて既存の曲を復元する。曲一覧が失敗した場合や読み込み中でも、原稿があれば保存ボタンが有効になる。その状態の保存はtrackNoとtrackNameを空文字で送信するため、原稿だけ直したつもりで既存のおすすめ曲を削除できる。

根拠: [選択の初期化と取得（調査時18行）](../hooks/useMjTracks.ts)、[空文字への変換（調査時85行）](../components/MjWritingModal.tsx)、[保存可否（調査時118行）](../components/MjWritingModal.tsx)。未取得・取得失敗・明示的な選択解除を別の状態として扱う必要がある。

### C08 — M/J執筆の共同編集で変更を消せる

モーダルは開いたときの原稿・開始位置・ジャンル・国を保持し、保存時に一括送信する。API側には版番号の照合や編集ロックがない。例えばAが原稿を保存した後、古い画面のBが国だけ直して保存すると、Bの古い原稿でAの変更も上書きしうる。

根拠: [初期状態（調査時35行）](../components/MjWritingModal.tsx)、[一括送信（調査時74行）](../components/MjWritingModal.tsx)、[PATCH（調査時103行）](../app/api/release-master/[no]/route.ts)。画像ジェネレーターには[版・ロックを含む保存（調査時247行）](../app/generator/[id]/session.ts)があり、アプリ内で保存の保証に差がある。実際の複数アカウントでの再現は未実施。

### C09 — ブックマーク保存失敗でも成功表示

POST／DELETEの応答で `res.ok` を確認せず、完了すればbookmarkedを切り替える。401や500でも保存済みの色になる。通信例外のユーザー向け表示もない。聴くものを保存したつもりで後から見つからない原因になる。

根拠: [toggleBookmark（調査時22行）](../hooks/useBookmark.ts)。保存成功の判定と失敗時の再試行導線が必要。

### C10 — 変更後の一覧・別セクションが古いまま

レビュー更新はモーダル内のscoresだけを取り直し、ホームやマイページのallScores・scoreSummary・レビュー済み集合には通知しない。M/J採用もモーダル内だけ更新する。ブックマーク解除後のSAVED一覧、送信直後のみんなのレコメンド一覧も更新の連携がない。

そのため、閉じた後の点数、未レビュー絞り込み、採用バッジ、保存リストなどが再読み込みまで食い違いうる。レビューのモーダル自身も古いalbum.legacyScoresを使うので、C05の不一致ガードが更新したアプリスコアを隠す場合がある。

根拠: [モーダルの変更通知先（調査時113行）](../components/ReviewModal.tsx)、[ホームの初回取得（調査時51行）](../app/page.tsx)、[採用のローカル更新（調査時27行）](../hooks/useMjAdoption.ts)、[マイページ取得（調査時52行）](../hooks/useMyPageData.ts)、[レコメンド一覧取得（調査時14行）](../components/review-modal/RecommendationList.tsx)。共通の更新通知や再検証の方針が必要。

### C11 — 未保存原稿の保護がない

レビュー・M/J執筆はstateで入力を保持する。背景タップ・Esc・閉じるボタン等がそのままonCloseを呼び、変更確認や下書き復旧がない。スマホでの誤タップ、ブラウザの戻る・再読み込みでも原稿を失いうる。

根拠: [レビューの背景タップ（調査時61行）](../components/ReviewModal.tsx)、[Esc・スワイプ（調査時16行）](../hooks/useModalDismiss.ts)、[M/JのEsc（調査時59行）](../components/MjWritingModal.tsx)、[M/J背景タップ（調査時124行）](../components/MjWritingModal.tsx)。ジェネレーターの[復旧コピー（調査時13行）](../app/generator/[id]/recovery.ts)と同程度の保護を原稿入力にも適用するか検討したい。

### C12 — タイムラインのスクロール監視が再接続されない

IntersectionObserverのeffectはtimeline.lengthに依存する一方、監視対象の要素はフィルター後の件数とdisplayCountで条件付き表示される。20件以下のフィルターでは監視対象がなく、その後20件超のフィルターに変えてもeffectが動かない。続きの位置にスピナーは出ても、読み込みを進める監視がつかない経路がある。

根拠: [監視effect（調査時70行）](../app/recommend/page.tsx)、[フィルター変更（調査時54行）](../app/recommend/page.tsx)、[監視要素（調査時378行）](../app/recommend/page.tsx)。DOMの生成・消滅に対応した監視の付け替えが必要。ログイン後ブラウザでの再現は未実施。

### C13 — KaedeだけRelease Masterのスコアを読み落とす

一覧GETと個別GETのLEGACY_MEMBERSは5人で、Kaedeがない。追加テストでは、ヘッダー・データにKaedeの9点を置いてもlegacyScoresに入らず、Koheiの7点だけが返ることを確認した。アプリscores側に同期済みなら表示を補えるが、直接入力直後や同期前の平均・レビュー済み判定は他のメンバーと差が出る。

根拠: [一覧側（調査時12行）](../app/api/release-master/route.ts)、[個別側（調査時13行）](../app/api/release-master/[no]/route.ts)、[6人の定義（調査時1行）](../lib/members.ts)。メンバー一覧を複数箇所で手書きしていることも原因。

### C14 — キャッシュ無効化の競合

invalidateCacheは保存済み値だけを削除する。古いスナップショットを読んでいるfetcherが実行中だと、無効化後にその古い結果を再びstoreへ保存する。追加テストで「読み取り開始→無効化→古い読み取り完了→次のGET」が古い値を返すことを確認した。

さらに、レビューのRelease Master書き込みより前にキャッシュを無効化するため、その間の読み取りが旧値を再保存する経路もある。プロセス間の無効化は行われず、TTLはscores／Release Masterとも60秒。

根拠: [cached（調査時36行）](../lib/api-cache.ts)、[無効化（調査時56行）](../lib/api-cache.ts)、[書き込み順（調査時136行）](../app/api/scores/[albumNo]/route.ts)。処理世代の管理、完了後の無効化、許容する鮮度を検討したい。共有キャッシュへの移行が必須という結論ではない。

### C15 — 同期がページ訪問に依存

Release Masterの同期はホームの初期化から非同期で起動する。リポジトリのvercel.jsonにはこの同期の定期実行は登録されていない。初回検知→待機→次回呼び出しで反映する構造なので、ホームを一度開いただけでは確定せず、同一インスタンスではさらに5分の実行間隔制限がある。「2分経過すれば自動で同期される」という動作にはならない。

根拠: [起動元（調査時104行）](../app/page.tsx)、[待機・スロットル（調査時14行）](../app/api/cron/sync-release-master/route.ts)、[pending確定（調査時154行）](../app/api/cron/sync-release-master/route.ts)、[Cron設定（調査時1行）](../vercel.json)。外部サービスで別の定期実行が設定されているかは未確認。

### C16 — Spotifyのページングと複数枚組への対応不足

トラックAPIはlimit=50の1ページだけ返し、nextを追わない。アルバム詳細の総尺もtracks.itemsだけを合計するため、次ページがある作品では曲数と総尺が食い違いうる。またdisc_numberを保持せず、画面のkeyと選択判定にtrackNumberだけを使うため、複数枚組の各ディスクにある「1曲目」等が同じ選択として扱われる。

根拠: [トラックAPI（調査時39行）](../app/api/spotify/tracks/route.ts)、[総尺集計（調査時73行）](../app/api/spotify/album/route.ts)、[選択とkey（調査時50行）](../components/mj-writing-modal/TrackSelector.tsx)。[Spotify公式API](https://developer.spotify.com/documentation/web-api/reference/get-an-albums-tracks)にはnext、disc_number、uri等がある。曲の識別にはURI等を使い、全ページの扱いを揃える必要がある。

### C17 — 取得エラーが空の一覧に化ける

タイムラインとマイページはHTTP失敗を空配列に置き換える。個別スコアも失敗時にエラー状態を持たず読み込み終了となる。API障害・セッション切れでも「まだレビューがない」「保存したアルバムがない」と見え、原因も再試行方法も分からない。ネットワーク例外を捕捉しない非同期処理もある。

根拠: [タイムライン（調査時90行）](../app/recommend/page.tsx)、[マイページ（調査時65行）](../hooks/useMyPageData.ts)、[個別スコア（調査時11行）](../hooks/useAlbumScores.ts)。空・未取得・失敗・認証切れを分ける必要がある。

### C18 — キーボード・拡大・読み上げ操作

ホームのAlbumCardはクリック可能なdivで、キーボードから開くためのbutton／link・tabIndex・キー処理がない。ReviewModalとMjWritingModalにはdialogの役割、開いた時のフォーカス移動、フォーカスの閉じ込め・復帰がない。viewportはmaximumScale=1、userScalable=falseを指定している。

根拠: [AlbumCard（調査時33行）](../components/AlbumCard.tsx)、[ReviewModal（調査時57行）](../components/ReviewModal.tsx)、[MjWritingModal（調査時120行）](../components/MjWritingModal.tsx)、[viewport（調査時35行）](../app/layout.tsx)。期待されるモーダル操作は[W3Cのパターン](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)を参照。実機・支援技術による使い勝手の程度は未検証。

### C19 — Spotify接続の終了処理が不完全

「接続を解除する」はlocalStorageのアクセストークンだけ消し、httpOnlyのrefresh Cookieは残る。refresh APIはそのCookieだけで再発行するため、解除が再発行の権限を消す動作になっていない。また、接続ポップアップを手で閉じたときはmessage監視を外すだけでonErrorを呼ばない。ポップアップブロックでnullが返った場合も終端処理がなく、設定画面のconnectingSpotifyがtrueのまま残る経路がある。

根拠: [解除ボタンの処理（調査時41行）](../app/settings/page.tsx)、[トークン削除（調査時28行）](../lib/spotify-token.ts)、[Cookieで再発行（調査時12行）](../app/api/spotify-oauth/refresh/route.ts)、[閉じる監視（調査時80行）](../lib/spotify-token.ts)。解除の意味と、成功・拒否・キャンセル・ブロックの各終了状態を揃えたい。

### C20 — 同期だけUIDではなくタイトルで照合

Release Master同期の入力型にはUIDがなく、appScoreMapもtitle+artist+emailで照合する。アルバムが改名されると、安定UIDが同じでも既存レビューを見つけられず、待機後に新しい行を追加する経路がある。後段のUIDバックフィルは追加済み行を結び直すもので、誤った新規追加の判断自体は防げない。

根拠: [同期入力の型（調査時65行）](../lib/release-master.ts)、[同期マップ（調査時95行）](../app/api/cron/sync-release-master/route.ts)、[新規追加（調査時166行）](../app/api/cron/sync-release-master/route.ts)。通常CRUDのUID優先方針と同期を揃える必要がある。実データでの改名再現は未実施。

### C21 — 空のレビューでも投稿済みになる

フォームは初期状態がスコアなし・空コメントで、そのまま投稿できる。APIにも両方空を拒否する条件がない。追加テストではnull＋空文字の投稿が201で保存処理へ進んだ。レビュー済み判定はレビュー行の存在を見るため、何も記録していないのに未レビュー一覧から外れる。

根拠: [フォーム初期値（調査時21行）](../components/review-modal/ReviewForm.tsx)、[投稿ボタン（調査時190行）](../components/review-modal/ReviewForm.tsx)、[API保存（調査時69行）](../app/api/scores/[albumNo]/route.ts)、[済み判定（調査時179行）](../lib/score-utils.ts)。空投稿を禁止するか、「聴いた」だけの記録を別の操作として認めるかを決めたい。

## 追加で改善候補に挙げたい点（優先度は未確定）

ここは不具合と同列の確定評価ではなく、改善プランを作るときの検証候補。

- **初期表示・画面移動のコスト**: ホーム等はアルバム全件・スコア全件を取得し、クライアントで絞り込み・描画する。下部ナビゲーションもwindow.location.hrefで毎回ページを読み直す。まずスマホ回線で取得量と表示時間を測りたい。6人利用であることだけを理由にDB移行を必須とはしない。根拠: [ホーム取得（調査時51行）](../app/page.tsx)、[全件スコア（調査時67行）](../lib/sheets.ts)、[ナビゲーション（調査時74行）](../components/BottomNav.tsx)。
- **フィルターの意味**: ジャンル・M/Jの選択を全部外すと、空配列を「条件なし」として扱い全件が出る。「すべて」の見た目は非選択となり、選択状態と件数の関係が分かりづらい。Up Nextも「掲載」「J掲載」を除外していないので、対象の定義を確認したい。根拠: [フィルター（調査時213行）](../app/page.tsx)、[Up Next除外値（調査時11行）](../app/page.tsx)。
- **共有・再訪導線**: シェアメニューは名前のコピーとAOTY検索で、アプリ内のアルバム詳細へ戻れるリンクがない。メンバー間で詳細を共有したい頻度を確認したい。根拠: [シェアメニュー（調査時71行）](../components/review-modal/ModalHeader.tsx)。
- **画像の表示方針**: ホームはi.scdn.coを含むカバーだけ表示するが、Next.js設定やジェネレーターは他の配信元も扱う。Spotify外のカバーがある作品で画面ごとの差を確認したい。根拠: [ホームカード（調査時31行）](../components/AlbumCard.tsx)、[画像許可設定（調査時16行）](../next.config.mjs)。
- **通知の鮮度**: 新着確認はセッション変更時が中心で、画面を開いたままの受信や、保存済みのレコメンドタブへ自動復帰した場合の既読処理は実機で確認したい。根拠: [新着確認（調査時23行）](../contexts/NotificationsContext.tsx)、[タブ操作時の既読（調査時139行）](../hooks/useMyPageData.ts)。
- **テストの配分**: ジェネレーターはロック・競合・再送・DBトランザクションまで既存テストがある。一方、今回の主要導線の問題を防ぐテストは不足していた。テスト件数を増やすより「投稿→一覧反映」「保存失敗」「Spotify取得失敗でも既存曲を維持」等の利用者の行動を検証したい。根拠: [DB契約テスト（調査時52行）](../lib/generator/__tests__/database.test.ts)、[既存テスト設定（調査時1行）](../vitest.config.ts)、[追加再現テスト](../docs/audit-evidence/2026-11-10-codex-repro.test.ts.txt)。

## 検証結果

| 検証 | 結果 | 補足 |
|---|---|---|
| 既存 `npm test` | 38ファイル・429テスト成功 | 調査開始時に実行 |
| `npm run lint` | 成功 | 調査開始時に実行 |
| `npm run build` | 成功 | サンドボックスのポート制限で最初は失敗し、制限外で再実行して成功。デプロイはしていない |
| `npx tsc --noEmit --incremental false` | 最終的に成功 | 最初は古い.next生成物が削除済みsaved-tracksを参照して失敗。生成後の再実行で解消。実装の型不具合としては数えていない |
| 追加再現テスト | 8テスト成功 | 全外部呼び出しをモック。下記のテキストを保存 |
| ローカルブラウザ | XSSを再現 | ページタイトルの変更のみ。本番・ログイン済みアカウントでの攻撃は未実施 |

ビルドにはmiddleware→proxyの非推奨警告とBrowserslistデータ更新の警告があった。ビルド失敗とは扱わず、保守時の確認事項とする。

再現用資料: [テスト本体](audit-evidence/2026-11-10-codex-repro.test.ts.txt)、[設定](audit-evidence/2026-11-10-codex-repro.config.mts.txt)。通常のテスト収集に混ざらないよう、拡張子を.txtにしている。2026-11-11、公開用にローカルの絶対パスを除去した。上記の調査対象コミットを一時展開し、現在のcheckoutの依存を共有した状態で8件すべての成功を再確認した。

この8件は**修正前の不具合が起きること**を期待するテストであり、現在のmainに対する回帰テストではない。再実行する場合は、リポジトリのルートから次の手順で調査対象コミットを一時展開する。依存を共有するため、先に通常のcheckoutで `npm ci` を実行しておく。厳密に当時の依存で再現する場合は、リンクの作成の代わりに一時展開先で `npm ci` を行う。

以下はローカル操作のみで、テスト中の外部サービスはモックされる。環境変数ファイルはコピーしない。`.local/` はgitの追跡対象外。

```bash
repo_dir="$PWD"
mkdir -p .local
audit_dir=$(mktemp -d "$repo_dir/.local/audit-repro.XXXXXX")
git archive 64ef156 | tar -x -C "$audit_dir"
ln -s "$repo_dir/node_modules" "$audit_dir/node_modules"
cp docs/audit-evidence/2026-11-10-codex-repro.test.ts.txt "$audit_dir/audit-repro.test.ts"
cp docs/audit-evidence/2026-11-10-codex-repro.config.mts.txt "$audit_dir/audit-repro.config.mts"
(cd "$audit_dir" && ./node_modules/.bin/vitest run --config audit-repro.config.mts)
```

## 改善プランを作る前に残る確認

1. 公開してよいレビュー・レコメンドの範囲。メールアドレスをAPIで返す必要性。
2. scoresとRelease Masterのどちらを正本とするか。手入力・アプリ編集の競合時に何を残すか。
3. 実データに残る重複・UIDなし行・Kaedeの未同期データの件数。調査では本番シートを直接集計していない。
4. 外部の定期実行、Vercelの保護設定、監視、バックアップ・復元手順の運用状況。リポジトリだけでは断定しない。
5. iPhone等での原稿入力、モーダルの誤操作、低速・オフライン・Spotify失敗時の実際の体験。
6. ジェネレーターの実機動画出力、音声の保管・削除、複数人作業の通し確認。既存テスト成功は、この全体の実機検証の代わりではない。

Claudeとの比較では、まずIDごとに「同じ原因の指摘か」「再現やコード根拠があるか」「利用頻度・影響がどの程度か」を照合すると、重複した改善作業を減らせる。
