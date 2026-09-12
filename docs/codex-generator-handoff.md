# Codex向け：画像ジェネレーター引き継ぎプロンプト

以下をCodexへそのまま入力して使用する。作成日：2026-09-07（Claude CodeでのUI再構成の直後）。

> **続行記録（2026-09-07）**：この引き継ぎに基づくCodexの初回対応は完了。判断待ち8点は[UI実装記録 §8](./generator-ui-implementation.md#8-codexへ確認したいこと)へ決定内容を記録した。stickyの恒久修正、旧ラボの画像読み込み修正、保存再送の`requestId`維持、heartbeat競合防止、並び順を含むローカル復旧、掲載評価文の読み取り専用化、字間の丸め、編集画面の横幅拡張を実装済み。型検査・Lint・267テスト・本番ビルド・固定データ画面のブラウザ確認に成功した。既存Google認証セッションで共有一覧と実Monthly文書9画像の読み取り・描画も確認したが、共有DBを変更するロック・保存・復元は未実行。複数端末・iPhone実機の受入も引き続き未確認。
>
> **プレビュー追記**：Google OAuthのredirect URIを追加せず別ポートで本番モード確認できるよう、localhost・非Vercel・許可メンバーに限定した一時的な認証迂回を追加した。契約と起動条件は[共有保存の実装状況 §3](./generator-shared-storage.md#3-api)を参照。本番環境変数には登録しない。
>
> **初回受入の反映**：Release Masterから空のTimeを下書き補完、字間・行送りを置換しやすい数値入力へ変更、混在字間を`Mixed`表示、作品・背景の編集ロックを自動取得、プレビュー内のおすすめ曲名を描画位置から個別選択できるようにした。保存は対象単位でversionを作る契約を維持。型検査・Lint・270テスト・本番ビルドに成功した。
>
> **統合完了記録（2026-09-08）**：一括ZIP実装と実データ受入を含む`wip/generator-integration`を、最新`origin/main`（Release Master APIのトークン認証・CORS・Time・Apple Music 2000pxカバー対応）と統合し、`main`へfast-forwardしてGitHubへpushした。競合解消時にGenerator取込でもApple Music大画像を優先し、従来カバーへフォールバックする接続とテストを追加した。Time 10件は共有文書のversion 4〜13として保存済み。実Monthly 9枚のZIPはCRC・命名・2400×2400寸法・一覧目視まで確認済み。全画面認証middlewareとの統合でlocalhost専用認証迂回が遮られる回帰も検出し、Generator画面だけ既存の厳格なlocalhost・非Vercel・許可メンバー判定を共有するよう修正した。型検査・Lint・18ファイル293テスト・本番ビルドに成功した。Vercel Productionには`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`GENERATOR_ENABLED=true`を暗号化登録し、再デプロイはReady。Previewには本番DB接続を登録していない。iPhone実機Safariだけは未確認。
>
> **運用整理（2026-09-11）**：旧Vercel `fvkus-projects/prototype`はAPIで`paused:true`を再確認した。残っていた`/api/cron/resolve`（`0 3 * * *`）は管理画面で無効化し、APIでも`disabledAt: 2026-09-10T15:02:09.987Z`を確認した。Supabase表示名`hyoryu-tools`は管理画面がサインインを要求したため未確認。Chromeでの実共有受入は完了しているが、ProductionのGoogle再ログイン後スモーク、Safari／Edge／Brave、物理iPhone、物理的に異なる3端末と突然切断後の実時間3分失効は未確認。詳細な残件は[旧プロトタイプDB再利用記録](./generator-project-reuse.md#残件)を正とする。

---

`ryuryu-music`リポジトリのMonthly／Japan画像ジェネレーターの続きを担当してください。UI・情報設計はClaude Codeが実装済みです。あなたは機能契約・API・DB・認証・Supabase・データ整合性・テストを担当します。

## 作業開始時に順番に確認してください

1. `git status` と既存の未コミット変更
2. `docs/generator-specification.md`（操作仕様の正本）
3. `docs/generator-shared-storage.md`（保存・ロック・履歴の契約）
4. `docs/generator-ui-implementation.md`（**今回のUI実装記録。判断待ち事項もここ**）
5. `docs/generator-project-reuse.md`（環境と未完了事項）
6. `app/generator/`、`lib/generator/`、`tools/generator-lab/` の実コード

> **2026-09-07 追記（Claude Code）：ジェネレーター一式はコミット済みになりました。**
> 消失防止のため、利用者の指示で作業用ブランチ `wip/generator-integration` を作り、
> 当時の未コミット・未追跡ファイル115件をそのまま1コミット（`7453325`）へ退避しました。
> **ファイルの内容・配置は一切変えていません。** `main` は `a9ae701` のままで、統合はしていません。
> したがって、以後は `git status` が空でも「作業が無い」意味にはなりません。
> 現在地の確認は `git log --oneline main..HEAD` と `git show --stat 7453325` で行ってください。
> ブランチ上での通常のcommitは継続して構いませんが、push・デプロイ・共有DBの永続変更は従来どおり依頼まで行いません。

## 現在地

UIは3カラム構成（サムネイル列／大きなプレビュー／編集パネル）。編集パネルのタブは1段で「情報修正／背景設定／共通設定」、その次の行が対象の状態・保存・復元。並び順はモーダル。プレビューをクリック・ドラッグすると調整対象と評価文の範囲が決まり、選択範囲はcanvasに重ねたDOMのオーバーレイで表示される。

> **2026-09-07（第3セッション）の変更**：編集画面の縦を確保するため、利用者の承認のもとで
> `app/layout.tsx` と `components/BottomNav.tsx` にも手を入れた（`/generator/<id>` だけ
> ボトムナビ・フッター・`main` の下余白を出さない。判定は `lib/app-chrome.ts` の1関数）。
> 大プレビューは1440×900で402→522px、ページの縦スクロールは445→0px。
> **`lib/generator/`、`tools/generator-lab/`、`app/api/`、`supabase/`、`lib/auth*`、`app/globals.css` は変更していません。**
> 詳細と維持した契約は[UI実装記録 §11](./generator-ui-implementation.md)。
> 検証のため `.next` を再ビルドしたので、3456で起動中の本番プレビューは起動し直してほしい。

型検査・ESLint（全体）・`npm test`（**16ファイル・276件**）・`npm run build` はすべて成功しています。

`app/generator/uipreview-temp/page.tsx` は固定データでワークスペースを描画する**見た目確認用の一時ファイル**です。共有DBを変更せず確認できます。本番ではほかのジェネレータールートと同じ認証対象です。2026-09-09の利用者指示により、Claude側のモバイル再設計と受入が終わるまでは残し、その後の最終公開前に削除してください。

## 変更しないでほしい確定事項

利用者の判断で確定済みです。UIはこれを表示するだけで、描画・保存の経路には触れていません。

- **本文の自動行送り**：行数によらず天地25pxのマージンを取り、その中で行送りを最大化する。`bodyLayoutFor` の現行実装のとおり。7行=63.08px（Figma実測60から+3.08、ブロック天地が18.5px広がることは受け入れ済み）、8行=54.07、9行=47.31。ブロック中心は自動・1行・手動上限の3分岐すべてで843（セル中心）。14行まで成立、15行以上は出力不可。
- `bodyLeadMode` は `"auto"` 既定、`"custom"` のときだけ `bodyMaxLead` を 28〜84px で使う。`bodyLeadMode` を持たない旧文書は `auto` 扱い。DB移行は不要。
- **iPhoneでは字間の調整UIを出さない**（範囲選択がページのスクロールと両立しないため）。行送りだけ操作できる。判定は `(max-width: 639px)` または `(pointer: coarse) かつ (max-height: 500px)`。**保存済みの `tracking` と文字別 `kerns` はそのまま描画・保存され続けます。** データ側で消したり既定値に戻したりしないでください。
- 保存・ロック・履歴・復元・画像アップロードのリクエスト内容（`requestId` / `expectedVersion` / `clientId`・`token`・`generation`、30秒heartbeat、離脱時のrelease）と、ローカル復旧保存のキー・`schemaVersion: 1`・600msデバウンス・拒否条件は元のままです。

## 新しくできた依存関係（重要）

`app/generator/hit-test.ts` が、プレビューのクリック座標から原稿の文字位置を逆算しています。描画コアを**読むだけ**ですが、次の値に依存します。

- `Render.bodyLines()` が返す行の `clusters`（`at` ＝原稿の文字位置、`adv` ＝送り幅）、`start` / `end` / `paragraphEnd` / `width`
- `Render.titleLinesOf()`、`Layout.titleBaselines()`、`Layout.TEXT.titleLead`
- `Layout.bodyLayoutFor()` の `lead` / `baseline`、`Layout.TEXT.bodyX` / `bodyW` / `bodyAscent` / `bodyDescent`
- `Layout.CELLS` と `Layout.LISTED.cellsOf()` の矩形
- `Pages.toDrawData()`
- `TextLayout.bandLayout()` が返す情報帯・おすすめ曲帯の各partの `key` / `width` / `gap` / `total`。`text-layout.mjs` の帯レイアウトを変更する場合は、おすすめ曲名などのクリック判定も確認する。

さらに、**均等割り付けの加算量 `extra = (bodyW − 行幅) / 文字間の数`（段落の最終行は0）を `drawParagraph` から写して持っています**。`tools/generator-lab/core/textEngine.mjs` の `drawParagraph` や `layoutParagraph`、`wrap`、`prepare` を変更する場合は、`app/generator/hit-test.ts` の `lineExtra` と `bodyIndexAt` / `selectionRects` を必ず同時に直してください。**ずれても例外は出ず、選択位置が静かに狂うだけです。** 型検査でもテストでも落ちません。

## 初回引き継ぎ時の判断事項（対応済み・履歴）

以下は初回引き継ぎ時の判断材料として残す。再実装せず、現在の決定は `docs/generator-ui-implementation.md` の §6・§8を正とする。

1. **`position: sticky` がアプリ全体で効いていない**（要判断）。`app/globals.css` の `body { overflow-x: hidden }` が body をスクロールコンテナにするため、`app/layout.tsx` の `<header className="sticky top-0 z-50">` も含めて配下の sticky が全滅しています（実測：`scrollY=600` でヘッダーの `top` が `-600`）。恒久対応は `body` を `overflow-x: clip` にすること。アプリ全体の見え方が変わる変更なので `globals.css` は触らず、ジェネレーター表示中だけ適用する `app/generator/StickyScope.tsx` を暫定で置いています。恒久対応するなら `StickyScope.tsx` と `app/generator/layout.tsx` は削除できます。
2. **`image.decode()` 依存**。`decode()` の解決だけを待つと、ページが `visibilityState: "hidden"` の間に読み込みが永久に完了しません（画像自体は取得済み）。`app/generator/runtime.tsx` では `decode()` と `load` の早いほうを採る形に直しました。`tools/generator-lab` 側に同じ依存があれば、実機のスリープ・タブ切り替えで同じ症状が出ます。対応要否を判断してください。
3. **PNG出力ゲートの粒度**。現在は文書全体の未保存で全ページの出力を止めています。保存が対象別なのに、別の作品の未保存で無関係なページまで出力できません。「そのページに写る作品・背景・共通設定だけの未保存で判定する」に緩める余地がありますが、仕様書§7の「未反映の変更がある状態では生成しない」の解釈に関わるため実装していません。緩める判断なら、UI側だけで対応できます。
4. **字間・行送りのUI表示単位**。仕様書§4の「−20〜20%」「100〜300%」に合わせ、表示を%へ変更しました（保存値は従来どおり em と倍率）。%小数1桁 → em小数3桁で丸めます。`model.ts` の検証範囲（tracking ±0.2、leading 1〜3）の内側に収まりますが、この丸めでよいか確認してください。
5. **掲載ページの評価文**。読み取り専用リストには残し、掲載画像に描画されない旨を添えています。この扱いでよいか。
6. **復元セレクトの絞り込み**。全versionを出し、その対象を変更した版に ● を付けています。対象で絞る仕様にするならUI側で変更できます。
7. **ワークスペースの横幅**。`app/layout.tsx` の `max-w-6xl` により、3カラムでもキャンバスは約400〜500pxが上限です。全幅にすると作業しやすいのですが、`app/layout.tsx` にあなた側の未コミット変更があるため触っていません。レイアウトの分け方を決めてください。
8. **ロックの残り時間**。3分で失効しますが、UIには「自動延長」としか出していません。カウントダウンを出すかは heartbeat 失敗時の見せ方と合わせて決めてください。

## 依頼：全ページのPNG一括書き出し（ZIPのまとめ役）

> **完了記録（2026-09-07〜08）**：Codexで `getArchivePacker()` を実装した。外部ライブラリを追加せず、ZIP32のstored形式、UTF-8ファイル名、CRC32に対応している。CRC計算はBlobをストリームで読み、完成ZIPもヘッダーと元BlobをBlob partsで結合するため、PNG全体の追加コピーを避ける。旧「未実装」テストは有効なZIPの構造・CRC・UTF-8名を検証するテストへ置き換えた。はみ出し時は全体中止とする判断を承認し、仕様書§7へ追記済み。Mac実機のCodex内ブラウザで2400px・14ページを一括生成し、約6.2〜6.3秒、対象レンダラー約337MBから最大410MB（増分約73MB）で完了した。実Monthly文書ではTime 10件をversion 4〜13として共有保存後、画像2〜10の9枚を4.8秒で書き出した。ZIPは67,754,850バイトでCRC検査に全件成功し、全PNGが2400×2400、一覧目視でも欠落・空白・明らかな文字切れはなかった。iPhone実機Safariは引き続き未確認。

対応前の統合版には全ページの一括書き出しがなかった。旧スタンドアロン版にあった「全部書き出す」と
`editor/js/zip.js` が引き継がれておらず、Monthly 1か月ぶん9〜14枚を1枚ずつ押す状態になっていた。

2026-09-07に、**UI・逐次描画・進捗・中止までをClaude Code側で用意し、同日にCodexがZIPのまとめ役を実装した**。

1. **`app/generator/bulk-export.ts` の `getArchivePacker()`：完了。**
   `(entries: {name, blob}[]) => Promise<Blob>` を返し、既存UIは変更せず動作する。
   旧版 `zip.js`（無圧縮 stored のみ・約120行）の移植で足りる想定で、外部ライブラリは不要。
   参照元は `/Users/koheifukuda/Documents/Claude/Projects/漂流音楽/tools/monthly-generator/editor/js/zip.js`
   （2026-09-04で凍結した旧版フォルダ。参照専用）。
   `lib/generator/__tests__/bulk-export.test.ts` の旧「まとめ役はまだ実装されていない」テストは削除し、ZIP構造を検証するテストへ置き換えた。
2. **はみ出しがあるページの扱い：決定済み。** 「全ページを先に検査し、1枚でも警告があれば
   何も作らずに止め、画像番号と理由をまとめて出す」で実装した。部分的に書き出して
   「9枚のはずが7枚」になる方が危険なため、この解釈を採用して仕様書§7へ追記した。
3. **メモリと所要時間の受入：Mac実機で完了、iPhoneは未確認。** 2400px×14枚の逐次生成は約6.2〜6.3秒で完了し、対象レンダラーは約337MBから最大410MBだった。実Monthly 9枚も4.8秒で完了し、ZIPのCRC、ファイル名、全画像の2400×2400寸法と一覧を確認した。1枚ごとの `releaseCanvas` は維持している（失敗時も `finally` で解放、テストあり）。iPhone実機Safariでの上限確認は別途必要。

出力ゲートは1枚書き出しと同じ条件（文書全体に未保存があれば止める）にしてあり、緩めていない。
詳細は[UI実装記録 §12](./generator-ui-implementation.md)。

## 検証してほしいこと（未確認）

Claude Code側のブラウザに認証セッションが無く、固定データでの描画確認までしかできていません。

- 実Googleログイン下での通し確認：ロック取得 → 編集 → 対象別保存 → 履歴復元 → PNG出力。
- 入力欄の中で範囲を選び直したときに「範囲：◯〜◯文字目」が追従すること。ロックが無いと入力欄が `disabled` になり、`disabled` な要素では選択も `onSelect` も起きないため未確認です。プレビュー側からの範囲指定は確認済み（本文1行目を x=200→620px でドラッグ → 文字位置 5〜20、オーバーレイ1つ、入力欄も `[5,20]`）。
- 実データ（1企画11作品・6ページ程度）でのサムネイル描画の負荷。確認は2ページのみです。サムネイルは実際の `drawPage` を座標変換で縮小して描いており、内容変更から200msのデバウンスで再描画します。
- iPhone実機：横向きでの字間非表示（この環境のエミュレーションが `pointer: coarse` を報告せず未確認）、日本語IME、範囲選択、写真入力、画面回転、スリープ復帰、連続PNG生成。
- `overflow: clip` と `dvh` の実機挙動。`overflow: clip` は Safari 16 以降。未対応環境では固定されないだけでレイアウトは崩れません。
- 3人・別端末での同時編集、ロック失効、本人端末への引き継ぎ。
- Chrome以外（Safari／Edge／Brave）での最終受入。

## 作業上の約束

- **相手側（Claude Code）の未コミット変更を削除・上書きしないでください。** 無関係な差分も変更しないでください。
- UIの都合で `app/generator/` を変更する必要が出た場合は変更して構いませんが、理由と影響範囲を `docs/generator-ui-implementation.md` へ追記してください（逆方向のルールとして、Claude Codeは機能契約・API・DB・認証・Supabaseを独断で変更しません）。
- 機能契約を変更した場合は、画面への影響と確認手順を仕様書へ追記してください。
- 作業後は、変更ファイル・維持した契約・検証結果・未確認事項・次の担当者が行うことを明記してください。会話だけに判断を残さないでください。
- commit、push、デプロイ、共有DBの変更は依頼されるまで行わないでください。

## 依頼：Weekly（NEW RELEASE WEEK）の機能契約

> **2026-09-08（Claude Code）**：利用者の指示でWeeklyの設計を起こした。Codex担当分は同日実装済み（結果は本節末尾）。
> 設計の正本は[Weeklyの設計](./generator-weekly-design.md)。以下はその要点だけ。

利用者の決定は3点。**データ源＝Release Masterの日付でその週を全件読み、メイン5枚は画面で振り分け**（シートに週用の列は追加しない）、
**表紙を含めて7枚すべてツールで作る**、**機能契約の実装はCodex**。

あなたにお願いしたいのは次の3つです。版面の描画とUIはこちらで担当します。

1. **`lib/generator/model.ts` のスキーマ拡張。** ページ種別に `cover`／`feature`／`others` を追加し、
   series別に許容種別・順序・`itemIds`件数を分ける（weeklyは `cover`(0件) → `feature`(1件)×N≤5 → `others`(0〜60件) の固定順）。
   weeklyの `rendererVersion` を `"weekly-v1"` にする。
   **`ItemContent` と `GeneratorTheme` は変更不要**です（評価文は空文字、おすすめ曲は `show.track: false`、波は **`useWave: true`**）。
   ※当初「Weeklyは波を使わない」と書いていましたが、2026-09-08のFigma実測でWeeklyの各面にも`Backwave`が敷かれていることを確認したため訂正しました。
2. **取り込み。** `GET /api/generator/source?series=weekly&week=YYYY-MM-DD`（金曜日付）。
   `M/J採用`列は見ず、対象金曜までの土曜〜金曜にあり、Release Masterの`#`列が対象週番号と一致する行を対象にする。重複除去・カバー画像の優先順・Time補完はMonthlyと同じ規則を共用。
   `WEEK=採用`を`feature`、`WEEK=掲載`を`others`へ振り分け、空欄・不採用は除外する。画面のswapは取り込み後の微調整に使う。
3. **テスト。** weeklyの検証・取り込みと、**既存のMonthly文書が同じ検証を通り続けること**。

### 触らないでほしい箇所（設計上の要点）

**`generator_structure_save` の「各ページの`itemIds`件数が変わらないこと」という不変条件は緩めないでください。**
`others`(30件)から`feature`(1件)へ1件*移す*操作はこの制約で必ず`INVALID_INPUT`になりますが、
**選定を「入れ替え（swap）」として定義すれば件数が動かず、現行APIのまま成立します**（`feature`の1件と`others`の1件を交換）。
UI側も入れ替えとして設計します。したがって**新規マイグレーションは不要**です。
`series`の`check`は既にweeklyを許容し、`unique (series, period_start, period_end)` が同一週の二重作成を防ぎます。

### 実装前に決まっていないこと

表紙の書体 `Alternate Gothic No2 D` が Google Fonts に無い件（現行`fonts.mjs`はOswaldとNoto Sans JPだけを読む）が未決です。
版面の座標は2026-09-08にFigmaで実測し、設計文書 §6.1〜6.3へ入れました（作品面は全数値確定、表紙とOther Releasesは
塗り・書体の細部だけFigmaのレート上限で未取得）。いずれも描画側の宿題なので、あなたの1〜3は先行して進められます。

### 2026-09-08追記（Claude Code）：WEEK列の発見、`selectWeeklyAlbums()`の再修正が必要

Koheiへの確認中に判明。**Release Masterには`WEEK`列（O列）が実在し、`M/J採用`と同じ語彙（採用／掲載／不採用）ですでに手動運用されている。**
設計時点で「Weeklyの採用概念はシートに無い」としていた前提が誤りだった。詳細と修正案は[Weeklyの設計 §12](./generator-weekly-design.md#12-2026-09-08追記week列の発見設計の前提が変わった)。

- 現行の`selectWeeklyAlbums()`（洋4邦1ヒューリスティック）は取り下げ、`selectReleaseMasterAlbums()`と同型の
  「`WEEK`列で`feature`／`others`に振り分け、`不採用`・空は除外」へ差し替えてほしい。
- `SHEET_COL`・`ReleaseMasterAlbum`・`route.ts`のマッパーに`WEEK`列の読み取りが無いので、そこから追加が要る。
- これに伴い「洋4邦1をUIで強制するか」は解消（Koheiの回答：強制不要、選定はRelease Master側で確定済みのため）。
- アプリ内の選定（入れ替え）UIは維持でよい（Release Master確定後の微調整用途）。

### Codex実装結果（2026-09-08）

- `model.ts`へWeekly専用のkind・順序・件数検証と`weekly-v1`を追加。Monthly／Japanとのkind混在を拒否する。
- `source.ts`と取り込みAPIへ、金曜の週境界、ISO週年・週番号、全件抽出、重複除去、洋楽4＋邦楽1の初期配分を追加した（この初期実装の週番号・配分は後続のWEEK／`#`列対応で置換済み）。Weeklyでは`[EP]`を保持し、評価文を空、`show.track`をfalseにする。
- APIと構成保存のswap不変条件を含むWeeklyテストを追加。`npm test -- --reporter=dot`は19ファイル・314件、型検査、ESLint、本番ビルドも成功。
- `generator_structure_save`とマイグレーションは変更していない。既存画面にはWeekly描画を未接続として除外する型ガードだけを追加した。
- Figma実測後の確定指示に合わせ、Weeklyを`useWave: true`へ修正し、作品名の初期書式へ`tracking: -0.02`と暫定`leading: 72 / 54`を追加した。
- 次はClaude Code担当のWeekly UI、`weekly-v1`描画、swap選定、週番号表示、書き出し命名を接続する。

### Codex継続結果（2026-09-08）

- Release Masterの`#`列と`WEEK`列を型・ヘッダー解決・3つのAPIマッパーへ接続し、対象金曜までの土曜〜金曜から`採用`／`掲載`だけを取り込む。対象行の`#`は欠損・不正・混在を拒否し、文書の`period.weekNumber`へ保存する。文書の識別期間は金曜〜翌金曜のまま維持する。
- Claude Codeが実測・実装した表紙、feature、Other Releasesを統合画面へ配線した。未知のページ種別をMonthly掲載面として描くフォールバックは廃止し、明示的にエラーにする。
- ハブの金曜選択、ISO週年と`#`週番号、画像0〜6のナビゲーション、Weekly用PNG／ZIP名、feature↔Othersのswap、ページ種別ごとの編集項目を実装した。表紙のジャケットはfeature順から導出し、重複保存しない。
- 既存の構成保存API、各ページの件数不変条件、DBマイグレーションは変更していない。commit、push、デプロイ、共有DBの永続変更も行っていない。
- 自動テスト、型検査、lint、本番ビルドを通し、固定データの実ブラウザで表紙、feature、Others、並び替えダイアログ、横方向のはみ出しを確認した。2026-09-09に実共有W36文書を作成し、swap保存・構成復元・作品保存・作品復元・7枚ZIPを確認した。iPhone 17 Pro Simulatorの縦表示と横向き相当条件も確認し、日本語UIフォントと狭幅警告帯を補修した。物理iPhone実機は未確認。

### 2026-09-08追記（Claude Code）：`npm test`に1件失敗を確認、週の抽出範囲の記述と実装の食い違い

利用制限からの復帰後、全体の検証（`npx tsc`／`npm run lint`／`node --test tools/generator-lab/test/*.mjs`／`npm test`）をやり直したところ、`npm test`で1件だけ失敗した。私は`lib/generator/`を変更していないので、Codex継続作業の時点から状態が変わったか、当時の確認漏れと思われる。

**失敗**：`lib/generator/__tests__/source.test.ts`「uses exactly the WEEK groups and keeps an empty others page」（86行目）。
`feature`が2件のはずが1件しか作られない。

**原因の特定**：このテストの2件目のアルバムは`date: "2026-08-08"`。対象週は金曜`2026-08-07`。
`weeklyReleaseWindow()`を実際に計算すると、窓は`[2026-08-01（土）, 2026-08-08（土）)`＝**土曜始まり・排他的終了**になる
（`saturday.setUTCDate(...-6)`から機械的に確認済み）。`2026-08-08`はこの窓の**終端と同じ値**なので`date >= period.end`に該当し、
正しく除外されている。**テストのフィクスチャが窓の外の日付を使っているだけ**で、`selectWeeklyAlbums()`自体の不具合ではなさそう。
2件目の日付を`2026-08-01`〜`2026-08-07`の範囲へ直せば通ると思われる（未確認、`lib/generator/`は変更していない）。

**もう1点、ついでに気づいたこと**：この`weeklyReleaseWindow()`は実装上**土曜〜金曜**の7日窓だが、
本書§12「実装結果」および`docs/generator-ui-implementation.md` §16はどちらも「**選択した金曜を含むISO週（月曜〜日曜）**」と書いている。
実装（土曜始まり）と記述（月曜始まり）が一致していない。土曜始まりの窓は、`docs/generator-weekly-design.md` §2が挙げている
「水曜発売のATOMEWと金曜発売の4作を同じ週にまとめる」という目的は実際に満たせている（Sep4金曜を対象週にすると窓は
`[Aug29土, Sep5土)`でSep2水・Sep4金の両方を含む）ので、**実装は目的に沿っているが、説明文だけが実際と違う**という状態に見える。
月曜〜日曜が本来の意図なら実装側の見直しが要るし、土曜〜金曜が正しいなら説明文の訂正で足りる。どちらとも判断できる立場ではないため、
判断も修正もCodex側にお任せしたい。

---

---

## 報告：背景の合成と月別waveを実装した（2026-09-09、Claude Code）

**依頼ではなく報告です。**機能契約・API・DB・マイグレーションは触っていません。

### 決まったこと（Koheiの決定、2026-09-09）

- 背景は「地の色100%の上に、waveをブレンドモード**Luminosity**・不透明度**50%**」。
  Monthly／Japanを含む全シリーズ共通（[Weeklyの設計 §6.5](./generator-weekly-design.md#65-背景の合成-2026-09-09確定)）。
- **waveは月替わりで、Koheiが月ごとに未加工の原版を渡す。** 加工はこちら側で行う。
- Weeklyが使うのは**対象金曜が属する暦月**。週が月をまたいでも金曜基準（`period.start`の月）。
- 地の色（`page.bgColor`）は手動のカラーピッカーのまま。

### 実装（すべて描画・UI側）

| ファイル | 変更 |
| --- | --- |
| `tools/generator-lab/core/layout.mjs` ／ `render.mjs` | Luminosity・不透明度50%。素材にαが焼き込まれていても実効50%になるよう補正 |
| `tools/generator-lab/make-wave.mjs` | 新規。原版を8bitグレースケールへ変換して`assets/waves/wave26MM.png`を作る |
| `tools/generator-lab/assets/waves/` | 新規。2026-08〜12を配置（1か月あたり約2.9MB。原版の約1/3） |
| `app/generator/runtime.tsx` | `BUNDLED_WAVES`と`waveForMonth()`。`period.start`の月から自動選択。`GeneratorRuntimeProvider`に`period`を追加 |
| `app/generator/[id]/GeneratorWorkspace.tsx` | 上記Providerへ`period`を渡す1行 |
| `app/generator/[id]/Inspectors.tsx` | 共通設定に「どの月の波を使っているか」「対象月が未登録」の表示 |
| `.gitignore` ／ `tools/generator-lab/reference/` | 参照画像と波の原版をGit管理外へ（1枚3〜9MB。変換後だけを追跡する） |

`theme`のスキーマ、`generator_check_assets`、マイグレーションは変更していません。
`theme.waveAssetId`（アップロードによる差し替え）は従来どおり優先されます。

2026-09-09に**2026年1〜12月の原版を受領**し、全12か月を変換して配置した（`assets/waves/`で約32MB、原版は約98MB）。
旧`assets/wave.png`は退役させ、標準の波は8月の原版（`waves/wave2608.png`）に差し替えた。
Monthlyの見た目（通常合成→Luminosity）はKoheiが確認済みで、これで確定。

### 依頼（Codex）

1. **実共有文書での通し確認。** 実DBに触れるのはそちらの担当なので、W36のWeekly文書と直近のMonthly文書で
   「対象月の波が出ているか」「保存・履歴復元・7枚ZIPが通るか」を確認してほしい。
   私が確認したのはビルド・型・lint・描画コアのテスト（59件）と、`background-check.html`での画素比較まで。
2. **`npm test`の実行。** `lib/generator/`をそちらが編集中だったため回していない。
3. **コミット時の扱い。** 私の変更は未コミットで、`tools/generator-lab/reference/`（実物投稿と波の原版、64MB）の
   **削除がインデックスに乗っている**。Git管理外にする判断はKoheiのもの（2026-09-09）なので、
   まとめてコミットしてよい。`.gitignore`に`/tools/generator-lab/reference/**/*.png`を追加済み。
   履歴に残っている64MBは当面そのままにする判断（同日）。
4. **既存文書への移行は不要。** `theme`のスキーマも`generator_check_assets`も変更していない。
   `theme.waveAssetId`（アップロードによる差し替え）は従来どおり優先される。
   波の自動選択は文書に何も保存せず、`period.start`から毎回導いている。

### 依頼（2026-09-09・第2弾）：実共有文書での通し確認

この日の後半に、和文書体・Other Releasesの太さ・未登録月のゲートを追加で入れた。
実DBに触れるのはそちらの担当なので、実共有文書での確認をお願いしたい。

1. **和文の見た目。** Weeklyの作品面とMonthly／Japanの採用枠・掲載枠で、和文の作品名・アーティスト名が
   `Noto Sans JP`（作品名400／アーティスト300）で出ていること。実物投稿との照合は画素で済ませてある
   （4か所すべて±4.3%以内）が、実画面は見ていない。
2. **Other Releasesの太さ。** `renderWeight: 350`で、字送り・折り返し・行数が**変わっていない**こと
   （測る太さは400のままなので変わらないはずだが、実データで確認したい）。
3. **未登録月のゲート。** 対象月の波が無い文書で、プレビューに警告が出て**単枚PNGも一括ZIPも作れない**こと。
   いまは2026年の12か月しか登録していないので、2027年の文書を作れば再現する。
   境界の挙動は`lib/generator/__tests__/wave-month.test.ts`で固定してある。
4. **既存文書への影響。** 背景の合成がLuminosityに変わり、和文書体も変わったので、
   既存のMonthly文書を開いたときに保存や履歴が壊れていないこと（データは触っていないので変わらないはず）。

いずれも`theme`のスキーマ・API・DB・マイグレーションは変更していない。

### そちらで判断が要るかもしれない点

- **月別waveを共有Storageへ移すか。** 現状はリポジトリ同梱で、年12か月ぶんで約35MBずつ増えます。
  Supabaseへ移すなら保管とAPIはそちらの領域です。移す場合も、選択ロジック（`waveForMonth`）と
  UIはそのまま使えます。
- **「この文書はこの月の波を使う」を保存したい場合。** いまは対象月から毎回導くだけで、
  文書に保存していません。人が月を選び直して保存したいなら`theme`にフィールドが要ります。

### Codex継続結果（2026-09-09）

- 月別waveは当面リポジトリ同梱を維持する。描画時に必要な対象月の1枚だけを取得でき、認証・共有Storageの
  可用性へ新たに依存しないため。年ごとの容量増加は今後の運用実績を見て再評価する。
- 使用月は文書へ重複保存せず、引き続き`period.start`から導出する。手動で別素材を選ぶ用途は既存の
  `theme.waveAssetId`で表現できるため、スキーマ・DB・マイグレーションは変更していない。
- 実共有W36文書で2026年9月、2026年8月Monthly文書で2026年8月のwaveが選ばれることを実画面で確認した。
  W36は共通設定をversion 7へ一時保存し、version 6からversion 8として復元。Monthlyはversion 14へ一時保存し、
  version 13からversion 15として復元した。どちらも最終値は2400px、未保存0件、ロック0件へ戻した。
- 固定データ画面の対象月を一時的に2027年1月へ変え、未登録月の警告と、単枚PNG・共有・一括ZIPの
  3操作がすべて無効になることを実画面で確認した。確認後は2026年8月へ戻しており、共有DB変更はない。
- 実共有W36文書のOther Releases 30件は、全行が枠内に収まり、折り返し・欠落・行数変化なし。
  実共有2026年8月Japan文書では採用枠・掲載枠の和文作品名とアーティスト名を確認し、
  `一張羅 / 小袋成彬, 5lack`と`°pbdb, 梅井美咲, 北村蕗`を含め正常だった。文書はversion 12、ロック0件のまま。
- `weekly_26_W36.zip`は7枚・47,377,064 bytes、`monthly_26_08.zip`は9枚・59,578,423 bytes。
  全PNGのCRCと2400×2400寸法を検査し、代表画像で対象月のwave、ジャケット、文字の欠落がないことを目視した。
- `npm test -- --reporter=dot`は20ファイル328件、描画コアは59件成功。型検査、lint、本番ビルドも成功した。
  物理iPhone実機の確認はモバイル再設計まで保留。3 actorの接続分離は実共有DBと実UIで確認し、
  物理的に異なる3端末と、突然の切断から実時間3分後に失効することだけが未確認。

## 報告：Weeklyの初期字間を0へ、Release Masterの再取得導線を追加（2026-09-11、Claude Code）

利用者の依頼で、Weeklyの作品名の初期字間を0にし、取り込み後にRelease Master側で直した文字情報を読み直す導線を追加した。UIとローカル下書きだけで完結させてあり、API・DB・保存契約・マイグレーションは変更していない。詳細は[UI実装記録 §26](./generator-ui-implementation.md#26-2026-09-11weeklyの作品名字間を0へrelease-masterの再取得導線を追加)。

### そちらへ確認・判断をお願いしたい3件

1. **`/api/release-master`の60秒キャッシュ。** 再取得は既存のTime補完と同じ`/api/release-master`を使う。このルートは`lib/api-cache.ts`で60秒キャッシュされるため、Release Masterを直した直後に押すと古い値が返りうる。UI側はダイアログに「最大60秒ぶん前の内容になることがある」と書いて逃がしてある。ジェネレーター用に無キャッシュの読み取り口（`/api/generator/source`と同じ直読み）を用意するかは機能側の判断。
2. **`item.source.fields`とカバー画像を更新できない。** 保存APIが受け取るのは`content`だけなので、再取得は`content.fields`しか書き換えない。結果として、一度取り込んだ項目は`source.fields`（取り込み時の原稿）から離れ、次の再取得では「手で修正済み」として既定チェックが外れる。またRelease Master側で`画像リンク変換`／`spotifyカバー`が差し替わっても、`source.coverUrl`は更新できない（現状の逃げ道はジャケット画像の手動アップロード）。`source`の更新を保存契約へ入れるかは機能側の判断。UI側からは提案のみ。
3. **Weekly取り込みの初期字間。** `lib/generator/source.ts`の`typography.title.tracking`を`-0.02`から`0`にした（`leading: 72 / 54`は据え置き）。描画既定の`Layout.WEEKLY.TYPE.title.tracking`は元から0で、`fitWeeklyTitle`の自動詰めは`baseTracking`基準なので挙動は変わらない。テストは`lib/generator/__tests__/source.test.ts`を更新済み。**既に保存済みのWeekly文書は`-0.02`のまま**で、DB移行は行っていない。一括で0へ寄せる必要があるかは利用者判断。

## 依頼：取り込みのやり直し／作品の追加（2026-09-11、Claude Code）

week37（文書 `c3f67801-8f91-4418-8475-802c622d4815`、#37、2026-09-11〜2026-09-18）で、Release Masterの`WEEK`列を`掲載`へ変えた行が画像に出ない、と利用者から報告があった。調べた結果、**取り込みが一度きりのスナップショットである**ことが原因で、取り込みロジックの不具合ではない。詳細は[UI実装記録 §27](./generator-ui-implementation.md)。

- 文書は2026-09-10 17:41 UTCに作成され、version 1のまま。feature 4件・others 7件。
- いまのRelease Masterで同じ週を取り込み直すと`採用`4件・`掲載`19件。差の12件は文書作成後に`掲載`へ変えた行。
- `selectWeeklyAlbums`は19件すべてを拾う。日付範囲・`#`列・重複除去・60件上限のいずれにも掛かっていない。

**アプリ側に回復手段が無い。** 取り込みのやり直しは`unique (series, period_start, period_end)`で弾かれ、削除APIも無い。作品の追加は`generator_structure_save`の「各ページの`itemIds`の件数不変」に阻まれる。§26の「Release Masterから再取得」は既存作品の文字情報を直すだけで、作品を増やせない。

そちらで検討をお願いしたいのは次の2点。UI側からは提案だけで、APIもDBも触っていない。

1. **恒久策**：対象週・対象月を取り込み直して、作品の追加・削除・区分移動をできるようにする経路。
   2026-09-11に利用者から「何度も取り込みできる仕様にできないか」と依頼があり、**実装はCodex担当と決まった**。
   設計は[取り込み直しの設計](./generator-reimport-design.md)へまとめた。新RPC`generator_reimport`、
   取り込み直しAPI、UI要件、未決事項5件（週番号の更新、作品集合をまたぐ復元、`operation`名、
   削除した作品の画像の後始末、作品versionの同時実行）まで書いてある。
   件数が変わるため`generator_structure_save`の不変条件では表せない、というのが出発点。
2. **今週の応急処置**：上の文書は削除して作り直す方針で利用者と合意した（2026-09-11）。
   version 1で編集も画像アップロードも無いため失われるものは無い。削除RPCが無く、
   PostgRESTからも`generator_*`テーブルへ触れない（`revoke all`のため）ので、
   SupabaseのSQL Editorで直接削除する手順を利用者へ渡した。消す前のスナップショットは
   `.local/generator-migration-backups/weekly-w37-1789065934710.json`にある。

なお、この週の文書を作り直すと、同時に修正したOther Releasesの並び（アルバム 洋楽→邦楽 → EP、各区分内はアーティスト名a-z）も反映される。既存文書の並びは`itemIds`に固定されているため変わらない。

## 依頼：制作フローとUIの再定義（v2）に伴う機能側の4件（2026-09-12、Claude Code）

利用者から「下書きと保存のしくみが複雑」「途中変更ができない」という指摘があり、制作フローとUIを再定義した。
仕様案は[制作フローとUIの再定義（v2）](./generator-flow-v2.md)。**UI側はまだ実装していない。**
以下の4件は、UI側だけでは解決できないか、機能側の判断が要るものだけを抜き出したもの。
APIもDBもマイグレーションも触っていない。

### 利用者が2026-09-12に決めたこと（前提）

| 論点 | 決定 |
| --- | --- |
| 背景色 | カバーから自動抽出し、初期値として入れる。人が直せることは変わらない |
| 編集の開始 | 画像ごとの「編集」ボタンを押してから編集する。自動ロックをやめる |
| 保存の粒度 | 画像ごとに1つの保存ボタンへ束ねる。内部は対象別PATCHのまま |
| 並び順 | Monthly／Japanは取り込み規則。Weeklyは**採用が行順、Other Releasesは従来規則** |

**このうち上2件は、既存文書に「変えない」と書いてあった決定を書き換える。** 利用者が明示的に承認済み。
`docs/claude-generator-ui-handoff.md`の「作品と背景は表示時に編集ロックを自動取得する。開始ボタンは置かない」と、
`tools/generator-lab/core/colors.mjs`冒頭および仕様書§7の「自動抽出はしない（2026-09-04、Koheiの指示）」が対象。
書き換えはUI実装と同時に行う。

保存・ロック・履歴・復旧の不変条件（`requestId`、`expectedVersion`、`clientId`／`token`／`generation`、
対象別ロック、対象別復元、ローカル復旧キー）は維持する。描画結果とPNG／ZIPの出力条件も変えない。

### 1.（着手前に必要）`item.source` の更新経路

保存API（`PATCH /:id`、`kind: "item"`）が受け取るのは `content` だけで、`source` を更新できない。
そのため、Release Master側で `画像リンク変換` ／ `spotifyカバー` が差し替わっても `source.coverUrl` が古いままになる。
2026-09-11の申し送り（本書「そちらへ確認・判断をお願いしたい3件」の2番）と同じ問題だが、
v2ではフロー1-1が「カバージャケットを取り込む」を含むため、**この経路が無いとフローが成立しない**。

考えられる形は3つ。どれを採るかは機能側の判断にお任せしたい。

1. `generator_reimport` を拡張し、**既存作品の `source` も更新対象**にする（作品の追加・削除と同じversionで確定）。
2. `PATCH` に `source` を受け取る経路を足す（対象別ロック・`expectedVersion` は現状のまま）。
3. `source.coverUrl` だけを更新する専用の対象種別を足す。

利用者が手でアップロードしたジャケット（`content.jacketAssetId`）を、この更新で消さないことだけは必須。

### 2. 画像ごとの保存の途中失敗

v2では「画像ごとに1つの保存ボタン」にする。内部は、その画像の作品（掲載なら最大2件、Other Releasesなら最大60件）と
背景色に対して、**対象別PATCHを順に呼ぶ**。DB契約は変えない。

複数対象をまとめて確定する経路がAPIに無いため、途中で失敗すると一部だけ確定した状態になる。
UI側の現在の案は「成功した分は確定したまま残し、失敗した対象名を出して再試行させる」。
全体ロールバックはAPIが持っていないので行わない。

- この扱いで問題ないか。
- Other Releasesは1画像に最大60作品ある。連続PATCHの上限・間隔について機能側の目安があれば知りたい。
- まとめて確定するRPCを足す判断があるなら、UI側はそちらへ寄せる。

### 3. Weeklyの並びを区分別に分岐させる

利用者の決定により、Weeklyの並びは**採用（メイン）がRelease Masterの行順、Other Releasesが従来規則**になる。
**初回の取り込みと取り込み直しで同じ規則**にしたい（初回と更新で並びが変わらないようにするため）。

- 現在、採用側は `sortAlbums`（EP区分 → 日付 → アーティスト名）を通っている。これを行順へ変える。
- Other Releasesの `sortWeeklyOthers`（洋楽アルバム → 邦楽アルバム → EP、各区分内はアーティスト名順）は維持する。
- 影響するのは `lib/generator/source.ts` の `selectWeeklyAlbums`（初回）と、
  `lib/generator/reimport.ts` の `resort`（更新）の両方。
- `sortAlbums` はMonthly／Japanの並べ直し専用として残る。
- 既存文書の並びは `itemIds` に固定されているため変わらない。ここは従来どおりでよいと考えている。

### 4. 作品集合をまたぐ並び順の復元の説明

現在、作品の追加・削除をまたぐ `structure` の復元は拒否で確定している
（UI側は `latestReimportVersion` 以降の版しか選択肢に出していない）。

v2では版の表示を画像単位に組み替えるので、「この画像の過去版へ戻せるのに、並び順だけ戻せない版がある」という
見え方になる。この制約の説明の仕方、またはDB側で作品集合の差を扱えるようにするかどうかを相談したい。
現時点のUI側の案は、選択肢から外したうえで「作品の増減より前の版には戻せない」と理由を出すこと。

### こちらで進めること

1〜4の回答を待つ間に、UI側は次を進める。API payloadは変えない。

- 共通設定を編集画面のタブから外し、`/generator/<id>/settings` へ分離する。
- 「Release Masterから再取得」と「Release Masterから取り込み直す」を1つの差分ダイアログへ統合する。
  実行順序は、作品の増減を `reimport` で確定 → スナップショット差し替え → 文字情報を下書きへ、とする。
- 版表示を画像単位へ組み替える。文書の通し番号は履歴画面にだけ残す。
- 保存ボタンを画像ごとに1つへ束ねる（2番の回答が来るまでは、成功分を残す案で実装する）。
- 背景色の自動抽出をブラウザ側で実装する。カバーは既に `crossOrigin = "anonymous"` で読めているのでcanvasから画素を取れる。
  抽出結果は通常の `bgColor` として下書きへ入り、画像の保存で確定する。**サーバー・DB・保存形式は変えない。**
  明度・彩度の寄せ方は `tools/generator-lab/reference/` の実物投稿を画素で測って決める。

### Codex回答・実装記録（2026-09-12）

1. `item.source`は案2を採用した。item PATCHが従来の`content`と、任意のRelease Master由来`source`を同じ
   itemロック・版・requestIdで原子的に保存する。手動ジャケットの`content.jacketAssetId`はsource更新で消えない。
   新規SQLは`202609120001_generator_item_source.sql`。2026-09-12に共有DBへ適用済み（利用者がSQL Editorで実行し、Claude Codeが関数の存在を確認）。
2. 画像保存は部分成功を正式な扱いとし、一括RPCは追加しない。最大60作品＋背景を同時1件・固定待機0msでPATCHする。
   2xxは確定済みにし、通信断・5xxだけは同じrequestIdと本文で結果を確定するまで列を止める。
3. Weekly採用をRelease Master行順へ変更した。初回と`reimport`の`resort: true`で同じ規則を使い、
   Other Releasesの`sortWeeklyOthers`とMonthly／Japanの`sortAlbums`は維持した。
4. 作品集合をまたぐstructure復元は拡張しない。候補から外し、作品数が異なるため選べないことと、
   過去構成へ戻す場合は「Release Masterから更新」を使う旨を説明する。詳細は[制作フローv2 §8](./generator-flow-v2.md#8-codexへ確認依頼する事項)。

---

---

## この文書の位置づけ

`docs/claude-generator-ui-handoff.md`（Claude Code向け）と対になる、Codex向けの引き継ぎプロンプト。役割分担は仕様書§11のとおり、Codexが機能契約・API・認証・Supabase・データ整合性・テスト、Claude Codeがページ遷移・情報設計・UI・ビジュアルデザインを担当する。2026-09-07に利用者がこの領域分担の維持を確認済み。
