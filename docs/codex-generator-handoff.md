# Codex向け：画像ジェネレーター引き継ぎプロンプト

以下をCodexへそのまま入力して使用する。作成日：2026-09-07（Claude CodeでのUI再構成の直後）。

> **続行記録（2026-09-07）**：この引き継ぎに基づくCodexの初回対応は完了。判断待ち8点は[UI実装記録 §8](./generator-ui-implementation.md#8-codexへ確認したいこと)へ決定内容を記録した。stickyの恒久修正、旧ラボの画像読み込み修正、保存再送の`requestId`維持、heartbeat競合防止、並び順を含むローカル復旧、掲載評価文の読み取り専用化、字間の丸め、編集画面の横幅拡張を実装済み。型検査・Lint・267テスト・本番ビルド・固定データ画面のブラウザ確認に成功した。既存Google認証セッションで共有一覧と実Monthly文書9画像の読み取り・描画も確認したが、共有DBを変更するロック・保存・復元は未実行。複数端末・iPhone実機の受入も引き続き未確認。
>
> **プレビュー追記**：Google OAuthのredirect URIを追加せず別ポートで本番モード確認できるよう、localhost・非Vercel・許可メンバーに限定した一時的な認証迂回を追加した。契約と起動条件は[共有保存の実装状況 §3](./generator-shared-storage.md#3-api)を参照。本番環境変数には登録しない。
>
> **初回受入の反映**：Release Masterから空のTimeを下書き補完、字間・行送りを置換しやすい数値入力へ変更、混在字間を`Mixed`表示、作品・背景の編集ロックを自動取得、プレビュー内のおすすめ曲名を描画位置から個別選択できるようにした。保存は対象単位でversionを作る契約を維持。型検査・Lint・270テスト・本番ビルドに成功した。

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

UIは3カラム構成（サムネイル列／大きなプレビュー／編集パネル）へ再構成済み。編集パネルは「画像編集（情報修正・背景設定）」と「共通設定」の2タブ、並び順はモーダル。プレビューをクリック・ドラッグすると調整対象と評価文の範囲が決まり、選択範囲はcanvasに重ねたDOMのオーバーレイで表示される。

変更はすべて `app/generator/` 配下（2026-09-07に `wip/generator-integration` へ退避済み。上の追記を参照）。**`lib/generator/`、`tools/generator-lab/`、`app/api/`、`supabase/`、`lib/auth*`、`app/layout.tsx`、`app/globals.css` は変更していません。** 型検査・ESLint（全体）・`npm test`（267件）・`npm run build` はすべて成功しています。

`app/generator/uipreview-temp/page.tsx` は固定データでワークスペースを描画する**見た目確認用の一時ファイル**です。ログインなしで画面を見られるので作業中は残して構いませんが、**コミット前に削除してください**。

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

---

## この文書の位置づけ

`docs/claude-generator-ui-handoff.md`（Claude Code向け）と対になる、Codex向けの引き継ぎプロンプト。役割分担は仕様書§11のとおり、Codexが機能契約・API・認証・Supabase・データ整合性・テスト、Claude Codeがページ遷移・情報設計・UI・ビジュアルデザインを担当する。2026-09-07に利用者がこの領域分担の維持を確認済み。
