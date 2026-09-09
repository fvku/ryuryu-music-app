# 画像ジェネレーター：UI・情報設計の実装記録（Claude Code）

2026-09-07。担当範囲はページ遷移・情報設計・操作導線・レスポンシブ・ビジュアルデザイン。同日、引き継ぎ後のCodexによる機能契約の確認・補修と、初回プレビュー受入の指摘対応を追記した。
**機能契約・API・DB・認証・Supabase・適用済みマイグレーションは変更していない。**
操作仕様の正本は[仕様書](./generator-specification.md)、保存契約は[共有保存の実装状況](./generator-shared-storage.md)。

## 1. 画面構成

利用者の指示により、プレゼンテーション編集ソフトに近い形へ再構成した。主操作は「文章を直す」ではなく「字間・行送りを詰める」である、という前提に合わせている。

```
PC（1280px以上）                              iPad横・iPad縦・iPhone
┌────┬──────────────┬─────────┐   ┌──────────────────┐
│▣ 2 │              │ 画像編集│共通 │   │ 画像 2･3･4 …  [並び順]│ ← 横1行
│▣ 3 │  画像 2 採用  │─────────│   ├──────────────────┤
│▣ 4 │  （大・固定） │ 情報修正│背景  │   │ 画像 2（固定）        │
│▣ 5 │              │═════════│   │                    │
│    │              │ 調整対象:本文│   ├──────────────────┤
│並び │              │ 字間 / 行送り│   │ 画像編集│共通設定       │
│順  │  [PNGを保存] │─────────│   │ 調整対象 / 字間 / 行送り│
│変更 │              │ 文字要素 ↓ │   │ 文字要素 ↓          │
└────┴──────────────┴─────────┘   └──────────────────┘
```

- **1280px以上**：ページ一覧（サムネイル縦列）／大きなプレビュー／編集パネルの3カラム。グリッド全体を画面の高さに収め、各カラムが内部でスクロールする。ページ全体はスクロールしない。
- **1280px未満**：プレビューを `position: sticky` で画面上部に留め、その下を編集パネルがスクロールする。行送りを操作している間もプレビューが見えたままになる。
- ページの切り替えはサムネイルのクリック。並び順は一覧末尾の「並び順を変更」から**モーダル**で行う（編集パネルのタブを増やさないため）。
- 編集パネルは「画像編集」「共通設定」の2タブ。画像編集はさらに「情報修正」「背景設定」。掲載ページでは情報修正に「上段／下段」が出る。

### 情報修正の中身

- 上部に**固定の調整パネル**：調整対象（8項目のセレクト）／範囲／字間(%)／行送り。スクロールせずに主操作が完結する。取り消し・やり直しもここに置いた。
- 下部は**読み取り専用の文字要素リスト**。Release Master由来で修正が稀なため、既定では要素名と現在値だけを並べる。行をクリックすると調整対象になり、「文字を修正」を押したときだけ入力欄が開く。表示チェック（仕様書§2の13px角）は各要素の見出し右に置いた。

## 2. 変更・追加したファイル

Claude CodeによるUI再構成はすべて `app/generator/` 配下。引き継ぎ後、Codexが `app/globals.css` と `tools/generator-lab/model.mjs` を含む機能補修を追加した。`lib/generator/`、`app/api/`、`supabase/`、`lib/auth*`、`app/layout.tsx` は変更していない。

| ファイル | 変更 |
| --- | --- |
| `app/generator/runtime.tsx` | 新規。描画コア・書体・Release Master・画像の読み込みを1か所に集約し、サムネイルと大プレビューで共有する。画像は同一URLをキャッシュする |
| `app/generator/PageNavigator.tsx` | 新規。実際の描画コアで描いたサムネイル一覧と「並び順を変更」 |
| `app/generator/GeneratorPreview.tsx` | 選択中1枚の大きなプレビューとPNG出力。クリック・ドラッグでの調整対象と範囲の指定、選択範囲のオーバーレイ、行送り診断、準備が終わらない状態の検出とやり直し |
| `app/generator/hit-test.ts` | 新規。プレビューの座標 → 編集対象・原稿の文字位置・選択範囲の矩形（§6） |
| `app/generator/StickyScope.tsx` / `layout.tsx` | 当初の画面限定対策。Codex引き継ぎ後に全体の恒久修正へ切り替えたため削除 |
| `app/globals.css` | `body` の `overflow-x` を `hidden` から `clip` に変更し、ルートヘッダーを含む `sticky` を本来の指定どおり有効化 |
| `tools/generator-lab/model.mjs` | `image.decode()` と `load` の早い方を採用し、非表示タブで画像準備が止まる問題を統合画面と同じ方式で修正 |
| `app/generator/ui.tsx` | 新規。Chip／StatusBanner／Panel／SegmentedControl／Modal／入力部品／`useMediaQuery` |
| `app/generator/[id]/GeneratorWorkspace.tsx` | 3カラムの土台、タブ、状態表示、ロック・保存・復元の呼び出し |
| `app/generator/[id]/ItemInspector.tsx` | 新規。固定の調整パネルと読み取り専用の要素リスト |
| `app/generator/[id]/Inspectors.tsx` | 新規。共通の操作列（TargetActions）、背景設定、共通設定、並び順モーダル |
| `app/generator/[id]/workspace-types.ts` | 新規。ロック関連の型 |
| `app/generator/GeneratorHub.tsx` | 一覧・作成を再構成。文書カードに更新日時・更新者を追加 |
| `app/generator/[id]/history/page.tsx` | 対象名の解決、現在版の明示、戻り先の追加 |

> **`app/generator/uipreview-temp/page.tsx` は見た目確認用の一時ファイル**。固定データで実際のワークスペースを描画する。共有DBに触れないが、**コミット前に削除すること**。

## 3. 維持した機能契約

描画・保存・履歴・互換性はいずれも既存の実装をそのまま呼んでいる。UIは値の入れ物と表示だけを変えた。

- レビュー本文は `bodyLeadMode: "auto"` が既定。UIのチェックを外したときだけ `"custom"` にし、`bodyMaxLead` は 28〜84px にクランプする（`model.ts` の検証範囲と同じ）。
- 自動時に `bodyMaxLead` をUIから書き換えない。`bodyLeadMode` を持たない旧文書は `parseItemContent` の既定どおり `auto` として扱う。DB移行は不要のまま。
- 天地25px・先頭行と最終行の整列・1行の天地中央・下限28pxは `layout.mjs` の `bodyLayoutFor` / `bodyFits` がそのまま担当。UIはこれらを**読み取るだけ**で、描画経路には手を入れていない。サムネイルは同じ `drawPage` を座標変換だけで縮小して描く。
- 出力不可の判定は従来どおり `Render.inspectPage` の警告と、文書全体の未保存判定による。UIは理由を並べるだけで条件を緩めていない。
- 保存・ロック・履歴・復元・画像アップロードのリクエスト内容（`requestId` / `expectedVersion` / ロックの `clientId`・`token`・`generation`、30秒heartbeat、離脱時のrelease）は維持した。結果不明の保存を同じ内容で再試行するときは、契約どおり同じ `requestId` を再利用する。
- 作品と背景は画面を開いた時点で編集ロックを自動取得する。通常時の「作品を編集」「背景を編集」は廃止したが、ロック・競合・保存契約は変えず、保存ボタンは従来どおり対象単位で新しいversionを作る。共通設定と並び順は明示的な編集開始を維持する。
- ローカル復旧保存のキー `ryuryu_generator_recovery:v1:<actor>:<documentId>`、`schemaVersion: 1`、600msデバウンス、拒否条件も変更していない。
- 既存versionで `duration` が空の場合、表示時に最新のRelease MasterをUID、No.、タイトル＋アーティストの順で照合し、空欄だけをローカル下書きへ補完する。共有DBは自動更新せず、各作品の保存でversionに確定する。

## 4. 自動行送りとFigma実測の照合（確定事項）

本文セルは `y:616, h:454`、`bodyPad:25`、`bodyAscent:23.25`、`bodyDescent:2.25`。有効帯は `first 664.25 / last 1042.75`、ベースラインに使える幅は 378.5px。自動時の行送りは `378.5 / (n-1)`。

| 行数 | 自動の行送り | Figma実測 | ブロック天地（自動） | ブロック天地（実測） | 差 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 7 | 63.08 | 60 | 404.0 | 385.5 | **+18.5** |
| 8 | 54.07 | 54 | 404.0 | 403.5 | +0.5 |
| 9 | 47.31 | 48 | 404.0 | 409.5 | **−5.5** |
| 14 | 29.12 | — | 404.0 | — | 出力可（下限28px） |
| 15 | 27.04 | — | — | — | 出力不可 |

**保たれている不変条件**：本文ブロックの中心は自動・1行・手動上限の3分岐すべてで厳密に 843（＝セル中心 616+227）。実測の「全14ページで842.75〜843.00」と一致する。左右余白25pxも変更していない。8行は実測とほぼ同一（0.07px/行）。

**乖離**：7行は1行あたり+3.08px（ブロック天地が18.5px広がる）、9行は0.69px/行縮む（Figma版は下側の25px余白を5.5px割っていた）。元のFigma版が単一の規則に従っておらず、天地ぴったりだったのは8行だけ、というのが原因。

**利用者の判断（2026-09-07）**：行数によらず同じ天地マージン25pxを取り、その中で行送りを最大化する。7行が実測60→63.08に広がることは受け入れる。**＝現在の実装のとおりで、コード変更はしていない。**

参考：7行だけ以前の見た目に戻したい場合は、手動（`bodyMaxLead: 60`）にすると lead 60 / 天地385.5 / 中心843 で実測と完全に一致する。9行の実測48は天地25pxを割る値のため、手動上限では再現できない。

## 5. プレビュー上での対象指定と範囲選択

文字要素を既定で読み取り専用にした結果、**評価文の字間を範囲指定で調整する面が画面から消えていた**（ロジックは残っていたが `<textarea>` が「文字を修正」を押すまで存在しなかった）。利用者の指摘で判明し、プレビュー側から指定する方式に組み替えて解消した。

- **セルのクリックで調整対象が切り替わる**。作品名／アーティスト／曲数・総尺・ジャンル・国／おすすめ曲番号・おすすめ曲名／評価文。作品名とアーティストは `titleBaselines`、情報帯とおすすめ曲帯は描画コアの `bandLayout` が返す各文字列の実位置を使い、クリックに最も近い項目を選ぶ。
- **評価文はドラッグで範囲選択**できる。選択範囲は**canvasに重ねたDOMのオーバーレイ**で青く塗る。DOM側なのでPNGにも保存データにも入らず（仕様書§5）、入力欄からフォーカスが外れても消えない。
- 選んだ範囲は**下の入力欄へ同期**する。プレビューから選ばれたときだけ対応する欄が開き、マウス・ペンのときだけフォーカスまで移す（タッチでキーボードを出さないため）。
- **タッチはタップのみ**扱い、ドラッグは奪わない。canvas上でドラッグを取るとページのスクロールが止まるため。タッチで範囲を指定したい場合は入力欄の中で選ぶ。

座標の逆算は描画コアを**読むだけ**で行う。`Render.bodyLines()` が返す行の `clusters`（`at` ＝原稿の文字位置、`adv` ＝送り幅）、`Layout.bodyLayoutFor()` の行送りとベースライン、`drawParagraph` と同じ均等割り付けの式 `extra = (bodyW − 行幅) / 文字間の数`（段落の最終行は0）を使う。**描画が使っている値そのものなので、近似ではなく一致する。**

字間・行送りは数値入力として扱う。入力途中の空欄・符号・小数点を許容し、範囲内の有効値は即時プレビュー、Blur／Enter時は許容範囲へ丸める。既存値を選択してそのまま入力すれば置換でき、ダブルクリックでも数値全体を選択できる。選択範囲に複数の字間が混在するときは入力値を空にして `Mixed` を表示する。

### iPhoneでの制限（利用者の指示・2026-09-07）

iPhoneでは**字間の調整を出さない**。範囲選択がページのスクロールと両立しないため。行送りだけ調整できる（本文＝自動／手動px、その他＝%）。行送りは仕様書§4のとおり文字欄全体に効くので、範囲選択の面を必要としない。

- 判定：`(max-width: 639px)` または `(pointer: coarse) かつ (max-height: 500px)`。iPhoneの縦横どちらも対象、iPad（縦834／横1024）とiPad Miniの縦744は対象外。
- **保存済みの `tracking` と文字別 `kerns` はそのまま描画・保存される。** iPhoneでは変えられないだけで、消えたり0になったりしない。パネルにその旨を1行出す。

## 6. 途中で見つけた不具合と対応

### 6-1. `position: sticky` がアプリ全体で効いていない（恒久対応済み）

`app/globals.css` の

```css
html, body { overflow-x: hidden; }
```

のうち **body 側**が body をスクロールコンテナにするため、配下の `position: sticky` が一切機能していない。ルートの `app/layout.tsx` にある `<header className="sticky top-0 z-50">` も**固定されていない**（実測：`scrollY=600` のときヘッダーの `top` が `-600`）。ジェネレーター以外のページにも同じことが起きている。

Codex引き継ぎ後、宣言済みのルートヘッダーの `sticky` も含めて本来の挙動へ戻す不具合修正と判断し、`body` の `overflow-x` を `clip` にした。`html` は横はみ出し防止の `hidden` を維持する。画面限定の `StickyScope.tsx` とジェネレーター用 `layout.tsx` は削除した。対象端末のSafari 16以降では `clip` を利用できる。

### 6-2. 画像の読み込みがタブ非表示中に止まる（対応済み）

`image.decode()` の解決だけを待っていたため、`visibilityState: "hidden"` の間に読み込みが永久に完了せず「描画を準備しています…」から進まない状態を再現した（画像自体は `complete: true` / `naturalWidth: 2400` で取得済み）。`decode()` と `load` イベントのどちらか早いほうを採用するよう変更した。`drawImage` は必要に応じて同期的にデコードするため描画結果は変わらない。併せて15秒で「準備が終わらない」ことを表示し、やり直せるようにした。

Codex引き継ぎ後、`tools/generator-lab/model.mjs` の同じ依存も横展開した。`decode()` が拒否された場合も `load` の結果を待つため、読み込み可能な画像を早期に失敗扱いしない。

## 7. 検証結果

- `npx tsc --noEmit`：成功。
- `npm run lint`（リポジトリ全体）：成功。
- `npm test`：15ファイル・270件成功。情報帯・おすすめ曲帯の項目選択テストを追加した。
- `npm run build`：成功。
- ブラウザ実測（一時ページで実際の `GeneratorWorkspace` を描画）：
  - 本文14行 → 実効行送り 29.1px（下限28px）、PNGボタン有効。
  - 本文15行 → 実効行送り 27px、PNGボタン無効、理由に「評価文が枠に収まりません」を表示。仕様書§4の「14行まで成立、15行以上は不成立」と一致。
  - ロックAPIが401を返す状態で「作品を編集」を押し、エラー配色のステータスに切り替わることを確認。
  - **プレビューの座標逆算**：本文1行目を x=200→620px でドラッグし、原稿の文字位置 5〜20 が選ばれること、青いオーバーレイが1つ出ること、評価文の入力欄が開いて同じ範囲 `[5, 20]` が選択されることを確認。手計算（`bodyX 74.25` ＋ 1文字あたり約27.44px）と一致する。
  - **セル判定**：作品名／アーティスト／曲数・総尺の帯／おすすめ曲の帯／評価文の各領域をクリックし、「調整対象」がそれぞれ `title` / `artist` / `duration` / `trackNo` / `text` に切り替わることを確認。キャレット（範囲なし）ではオーバーレイが出ないことも確認。
  - **入力欄で選び直しても、プレビューから開いた欄が閉じない**ことを確認。
  - **iPhone幅（390×844）で字間欄と「範囲：」行が消え、行送りと注記だけが残る**こと、iPad縦（834×1112）では字間欄が出ることを確認。
  - 4つの画面幅で横スクロール0px、かつ**プレビューと調整パネルが同時に見える位置が存在する**ことを、座標と `elementFromPoint`（前面に出ているか）の両方で確認：

| 幅×高 | 想定 | 段組 | キャンバス | 同時表示 |
| --- | --- | --- | ---: | --- |
| 1440×900 | PC | 3カラム・ページスクロールなし | 402px | 横並び |
| 1024×768 | iPad横 | 2カラム | 344px | 横並び |
| 834×1112 | iPad縦 | 縦積み・プレビュー固定 | 498px | scrollY 450 で両立 |
| 390×844 | iPhone | 縦積み・プレビュー固定 | 322px | scrollY 700 で両立 |

### Codex引き継ぎ後の再検証（2026-09-07）

- `npx next typegen`、`npx tsc --noEmit --incremental false`、`npm run lint`：成功。
- `npm test`：14ファイル・267件成功。
- `npm run build`：成功。サンドボックス内の初回だけTurbopackの内部ポート制約で失敗し、権限付きの同一コマンドで再実行した。コード起因のビルドエラーではない。
- 固定データ画面：掲載ページの調整対象が7項目になり、評価文は読み取り専用・「掲載画像には描画されません。値は保存されます。」の表示になったことを確認。
- 固定データ画面：広幅時の大プレビューは約502px、編集ワークスペースは最大1600px内に収まり、横オーバーフローなし。
- 固定データ画面：ページを約556pxスクロールした状態でもルートヘッダーの `top` は0pxで、`sticky` が有効。ブラウザのconsole警告・エラーなし。
- 既存のGoogle認証セッションで共有企画一覧を読み取り、2026年8月Monthlyの実文書（9画像）を開いた。9サムネイル＋大プレビューの計10 canvasが描画され、横オーバーフローとconsole警告・エラーはなかった。共有DBを変更しない範囲に限定し、ロック取得・保存・復元は実行していない。

### 初回プレビュー指摘対応後の再検証（2026-09-07）

- `npx tsc --noEmit --incremental false`、`npm run lint`、`npm run build`：成功。
- `npm test`：15ファイル・270件成功。
- 数値入力は一時的に未確定な文字列を保持し、選択中の既存値を直接置換できる実装へ変更。`selectedSpacing` の既存テストで、選択範囲に複数の字間があれば `null`（UIでは `Mixed`）になることを再確認した。
- おすすめ曲帯は描画と同じ `bandLayout` を当たり判定にも使い、おすすめ曲番号と曲名を個別に選択できる。固定セグメント・区切りは編集対象にしないテストを追加した。
- localhostの本番モードで実Monthly文書を再確認。空だったTime 11件が補完され、先頭作品に `11songs, 41min 15sec` が表示された。作品と背景はいずれも開始ボタンなしでロックを取得し、入力欄／背景色が操作可能になった。
- プレビュー内の `Canyons` をクリックすると調整対象が「おすすめ曲名」に切り替わった。行送りの既存値 `120` をダブルクリック選択後、そのまま `145` へ置換できた。
- 評価文の先頭5文字だけ字間7%、続く文字を含む1〜8文字目を再選択すると、字間欄が空になりplaceholder `Mixed` を表示した。確認用の変更は保存せず再読込で破棄した。
- 情報修正→背景設定→情報修正と切り替え、次の直接編集ロックを取る際に前の作品／背景ロックを解放すること、背景設定に「背景を編集」ボタンが存在しないことを確認した。

## 8. Codexへ確認したいこと

2026-09-07に確認し、次のとおり決定・反映した。

1. **sticky**：全体で恒久対応した。ルートヘッダーの既存指定も有効になる。
2. **`decode()`**：旧ラボへ横展開した。
3. **PNG出力ゲート**：仕様書§7の安全側の解釈を維持し、文書全体に未保存があれば出力を止める。対象単位には緩めない。
4. **表示単位**：字間は%小数1桁で表示し、保存時はem小数3桁へ丸める。行送りは従来どおり本文px、他項目は整数%。
5. **掲載の評価文**：保存値を失わないため一覧へ読み取り専用で残すが、調整対象・編集欄には出さず、画像にも描画しない。
6. **復元セレクト**：全versionを表示し、対象を変更した版に ● を付ける。変更されなかった版時点への復元も可能なため、対象変更版だけには絞らない。
7. **横幅**：ルートの `app/layout.tsx` は変更せず、編集ワークスペースだけ最大1600pxでビューポート幅へ広げた。一覧・履歴・他画面は従来幅のまま。
8. **ロック残り時間**：カウントダウンは出さない。30秒heartbeatが成功している間は残り時間が利用者の操作判断にならず、失敗時は即座に編集不可とエラー表示へ切り替える現行方針を維持する。

追加で、ローカル復旧時に保存済みだった並び順も戻すよう補修した。現在の共有DBと作品ID・ページID・種別が一致しない復旧データは部分適用せず拒否する。また、遅れて届いたheartbeatの成功・失敗応答が、解放・引き継ぎ後の新しいロック状態を上書きしないよう世代・トークンを照合する。

## 9. 未確認

- 実Googleログイン下での書き込みを伴う通し確認（ロック取得 → 編集 → 保存 → 履歴復元 → PNG出力）。既存セッションで一覧・実文書の読み取りと描画までは確認したが、共有DB変更は許可範囲外のため実行していない。
- **入力欄の中で範囲を選び直したときに「範囲：」表示が追従すること**は未確認。ロックが無いと入力欄が `disabled` になり、`disabled` な要素では選択も `onSelect` も発生しないため、この環境では再現できなかった。実装はCodexの元コードと同じ `onSelect` の配線で、プレビュー側からの範囲指定は上記のとおり確認済み。
- **iPhone横向き（844×390）での字間の非表示**は未確認。この環境のエミュレーションが `pointer: coarse` を報告しないため、幅の条件（639px）から外れて字間が出る。実機のSafariは `coarse` を報告するので非表示になる想定。
- 3人・別端末での同時編集、失効、引き継ぎ。
- iPhone／iPad実機Safariでの日本語IME、範囲選択、写真入力、画面回転、スリープ復帰、連続PNG生成。特に `overflow-x: clip` と `dvh` の実機挙動。
- Chrome以外（Safari／Edge／Brave）での最終受入。`overflow: clip` は Safari 16 以降。未対応環境では固定されないだけで、レイアウトは崩れない。
- 実データ（2026年8月Monthly・9画像）で初回の全サムネイル描画は確認済み。長時間編集・連続更新時の負荷は未確認。
- commit・push・デプロイ・共有DBの変更はしていない。

## 10. 2026-09-07（第2セッション）：引き継ぎの整合性確認と作業環境の保全

Claude Code担当。**コードは1行も変更していない。** 文書とGitの状態だけを現在地へ合わせた。

### 10-1. 経緯

漂流音楽ワークスペース（`/Users/koheifukuda/Documents/Claude/Projects/漂流音楽`）側の入口が旧スタンドアロン版を指したままだったため、Claude Codeが `tools/monthly-generator/` を現在地と誤認して着手しかけた。Codexの指摘で判明。誤りの原因は個別の読み違いではなく入口ファイルの記述なので、同じ誤りが再発しないよう入口を修正した。

### 10-2. 実行した検証（Codexの受入報告の再現確認）

| 確認 | 結果 |
| --- | --- |
| `npm test` | 15ファイル・270件成功。報告と一致 |
| `npx tsc --noEmit --incremental false` | 成功 |
| `npm run lint` | 成功 |
| `npm run build` | 成功 |
| `StickyScope.tsx` / `app/generator/layout.tsx` | 記録どおり存在しない（削除済み） |
| `app/generator/uipreview-temp/page.tsx` | 記録どおり残存 |

文書の記載と実装の食い違いは見つからなかった。

### 10-3. Gitの状態を変更した（重要）

ジェネレーター一式が `main` 直上の未コミット・未追跡（変更17＋未追跡98）のまま置かれており、`git checkout .` や `git clean -fd` 一回で消える状態だった。利用者の指示で保全した。

- ブランチ `wip/generator-integration`、コミット `7453325`。115ファイルをそのまま退避。
- **ファイルの内容・配置・動作は変更していない。** `main` は `a9ae701` のまま。統合・push はしていない。
- 秘密情報の混入がないことを、追加対象ファイルのパスと内容の両方で確認した（`.env*`・`.local/`・`.vercel` は `.gitignore` 済み）。
- `uipreview-temp/page.tsx` は作業中に必要なため保全対象に含めた。**`main` へ入れる前に削除すること**は従来どおり。
- 副作用：以後 `git status` が空でも「作業が無い」意味にはならない。現在地は `git log --oneline main..HEAD` と `git show --stat 7453325` で確認する。両引き継ぎ文書へも追記済み。

### 10-4. 認証情報の是正（Codexへの申し送り事項）

`origin` のURLにGitHub Personal Access Token（`ghp_` で始まる値）が平文で埋め込まれており、`git remote -v` を実行するあらゆるAIセッション・ログへ露出する状態だった。利用者の承認を得て是正した。

- `gh auth setup-git` で github.com の credential helper を `gh` に設定（既存の `gh` ログインは `fvku`、scope に `repo` を含む）。
- `git remote set-url origin https://github.com/fvku/ryuryu-music-app.git` へ変更。
- `git ls-remote origin HEAD` が成功し、認証が維持されていることを確認。
- 他リポジトリのGit設定・グローバル設定に同種の埋め込みが無いことも確認した。

> **未完了：旧トークン自体はGitHub上でまだ有効。** URLから外しただけでは失効しない。利用者による失効（revoke）が必要。値はこの文書にも会話にも残していない。

### 10-5. 文書の修正

コードに触れない文書修正のみ。

| ファイル | 変更 |
| --- | --- |
| 漂流音楽 `CLAUDE.md` / `AGENTS.md` | ジェネレーターの正本が別リポジトリであることを明示。旧フォルダから続けない旨を追加 |
| 漂流音楽 `docs/AI_WORKFLOW.md` | 設定表を更新し、「投稿画像ジェネレーターの所在」節（リポジトリ・ローカルパス・デプロイ先・認証の責務・読む順）を追加 |
| 漂流音楽 `tools/monthly-generator/` の `HANDOFF.md` / `SPEC.md` / `README.md` | 冒頭に凍結の告知を追加。「次に行うこと」「レビュー待ち」等が現在地ではないことを明記 |
| `docs/claude-generator-ui-handoff.md` / `docs/codex-generator-handoff.md` | コミット状態の変化を追記し、「未コミット・未追跡」の記述を現在地へ修正 |

### 10-6. 積み残し

- 旧トークンの失効（利用者）。
- ローカル `main` は `origin/main` より**6コミット遅れている**。`wip/generator-integration` は遅れた `main` から分岐しているため、統合時は最新 `main` との差分解消が必要（`docs/generator-shared-storage.md` §5-5 の手順と同じ論点）。
- 文書間でテスト件数が267（09-05時点）と270（09-07時点）で混在している。現在の基準は**270**。
- `docs/generator-specification.md` §1 の「現在の統合画面：localhost:3000/generator」は、実際の起動ポート3456（`.claude/launch.json`）と不一致。仕様書はCodex側と共通の正本のため、こちらでは変更していない。
- UI・情報設計の改善提案はこのセッションでは未着手。実画面（`localhost:3456`）の確認から続ける。

## 11. 2026-09-07（第3セッション）：縦の予算と情報設計の見直し

Claude Code担当。利用者の承認を得て、提示した改善候補1〜6をすべて実装した。
**機能契約・API・DB・認証・Supabase・適用済みマイグレーションは変更していない。**
`app/generator/hit-test.ts` と `tools/generator-lab/core/textEngine.mjs` にも触れていない。

### 11-1. 起点になった実測

主作業は1200px原寸に対する字間・行送りの詰めなので、プレビューの縮尺が判断の精度をそのまま決める。
1440×900で測ったところ、**編集に使えない縦が696px**あり、大プレビューは402×402（＝33.5%縮小）だった。

| 帯 | 高さ | 性質 |
| --- | ---: | --- |
| ルートヘッダー（sticky） | 61 | アプリ共通 |
| タイトル帯（企画名／version／未保存件数／変更履歴・再読込） | 84 | ジェネレーター |
| Time補完のお知らせ（StatusBanner） | 46 | ジェネレーター |
| ロック＋ローカル復旧帯 | 45 | ジェネレーター |
| ボトムナビ（fixed） | 75 | アプリ共通 |
| `main` の下余白（`pb-36`） | 144 | アプリ共通 |
| フッター | 241 | アプリ共通 |

編集UIの実体は y=896 で終わるのに、その下に下余白＋フッターで385pxが続き、**ページが445pxスクロール**していた。
「1280px以上ではページ全体をスクロールしない」という§1の設計意図が、実機では成立していなかった。

### 11-2. 変更したファイルとUI

| ファイル | 変更 |
| --- | --- |
| `lib/app-chrome.ts` | 新規。`isImmersiveRoute()`。`/generator/<id>` だけを対象にする1関数 |
| `components/AppFrame.tsx` | 新規。`main` とフッター。編集画面ではフッターと `pb-36` を外し、上下余白を `py-4` にする |
| `components/BottomNav.tsx` | 編集画面では描画しない（フックをすべて呼んだあとに `return null`） |
| `app/layout.tsx` | `main` とフッターを `AppFrame` へ移した。ヘッダー・幅・その他の画面の見え方は変えていない |
| `app/generator/GeneratorPreview.tsx` | キャンバスの高さ予算を実測に合わせ直した。案内・状態・背景色の断りを1行へ。出力できない理由を出力ボタンと同じ行へ |
| `app/generator/PageNavigator.tsx` | サムネイルに画像ごとの状態（未保存／他が編集中／背景なし）を出す |
| `app/generator/[id]/GeneratorWorkspace.tsx` | 見出しを1行へ。状態・編集者・復旧保存を1本の帯へ。タブを1段（情報修正／背景設定／共通設定）へ。対象の操作列をタブの次の行へ集約 |
| `app/generator/[id]/Inspectors.tsx` | `TargetActions` を `TargetStatus` と `RestoreControl` に分割。`TargetStatus` に `trailing`、`RestoreControl` に `compact` を追加 |
| `app/generator/[id]/ItemInspector.tsx` | 操作列を上位へ移した。文字要素の1行あたりの操作面を3つから2つへ（見出しと現在値を1つの選択面に、「文字を修正」を✎の小ボタンに） |
| `app/generator/[id]/workspace-types.ts` | 新規 `derivePageBadges()`。画像ごとの状態を画面から切り離した純関数 |
| `app/generator/ui.tsx` | `StatusBanner` に `dense`、`Panel` に `padding="tight"` |
| `lib/generator/__tests__/page-badges.test.ts` | 新規。`derivePageBadges` の6件 |
| `.claude/launch.json` | 検証用に `generator-ui-check-3457`（`npx next start -p 3457`）を追加 |

### 11-3. 結果（実測）

| 画面幅 | 大プレビュー（前） | 大プレビュー（後） | 変化 |
| --- | ---: | ---: | ---: |
| 1440×900 | 402 | **522** | +30% |
| 1024×768（iPad横） | 344 | **397** | +15% |
| 834×1112（iPad縦） | 498 | **576** | +16% |
| 390×844（iPhone） | 322 | **330** | +2%（この幅では横が制約） |

「前」は§7の実測値。1440×900では**ページの縦スクロールが445px→0**になり、横スクロールは0のまま。
主操作（調整対象）までの段は、右パネルで**4段→2段**（1段目＝編集する対象、2段目＝その対象の状態・保存・復元）。

編集画面以外（`/`、`/generator`、`/generator/<id>/history`）では、ボトムナビ・フッター・`pb-36` が
従来どおり出ることを実測で確認した。判定は `isImmersiveRoute()` の1か所だけ。

### 11-4. 維持した機能契約

UIの入れ物と配置だけを変えた。次はいずれも変更していない。

- 本文の自動行送り（天地25px・最大化・下限28px・14行まで成立）と `bodyLeadMode` / `bodyMaxLead` の保存契約。
- PNG出力ゲートは従来どおり文書全体の未保存で止める。**理由の表示位置を変えただけで、条件は緩めていない。**
- 保存・ロック・履歴・復元・画像アップロードのリクエスト内容、30秒heartbeat、離脱時のrelease、`requestId` の再利用。
- 作品・背景の自動ロック取得。**取得の範囲も変えていない**（表示中の対象の分だけ走る）。「作品を編集」「背景を編集」の開始ボタンは再追加していない。
- 対象切替時に以前の自動取得ロックを解放する挙動。
- ローカル復旧のキー・`schemaVersion: 1`・600msデバウンス・拒否条件。表示文は短くしたが、「共有保存なし」の併記は仕様書§9のとおり残した。
- iPhoneでの字間非表示（判定式そのまま）。保存済みの `tracking` / `kerns` は描画・保存され続ける。
- 掲載ページの評価文は読み取り専用のまま。調整対象にも画像にも出さない。
- プレビューからの対象選択（作品名・アーティスト・情報帯・おすすめ曲番号／曲名・評価文）と範囲選択。

### 11-5. 検証

- `npx tsc --noEmit --incremental false`：成功。
- `npm run lint`（リポジトリ全体）：成功。
- `npm test`：**16ファイル・276件成功**（`page-badges.test.ts` の6件を追加）。
- `npm run build`：成功。
- ブラウザ実測（`npx next start -p 3457` の本番モード、固定データ画面 `/generator/uipreview-temp`）：
  - 1440×900：大プレビュー522px、ページ縦スクロール0、横スクロール0、ボトムナビ・フッターなし。
  - プレビューのクリックで調整対象が `artist` / `text` / `track` へ切り替わることを確認（おすすめ曲名の個別選択は維持）。
  - 文字要素リストの行クリックで調整対象が `artist` になることを確認（見出しと現在値を1つの選択面にした後も同じ）。
  - タブ3つ（情報修正／背景設定／共通設定）がそれぞれ正しい内容を出すことを確認。
  - 390×844で読み込むと、字間欄と「範囲：」行が消え、注記だけが残ることを確認。
  - 編集画面以外の3経路でボトムナビ・フッター・`pb-36` が残ることを確認。

### 11-6. 未確認

- **実Googleログイン下の実データでの通し確認。** ロックを取得した状態でしか出ない要素（文字要素の✎ボタン、`TargetStatus` の保存ボタン、サムネイルの「未保存」「他が編集中」バッジ）は、固定データ画面では描画されない。`derivePageBadges` は単体テストで6件確認したが、画面での見え方は未確認。
- 検証用のローカル本番プレビューを認証迂回つきで起動する設定は、この環境の安全確認で拒否されたため使えていない。実データでの確認には、利用者のブラウザか、Codex側で起動しているプレビューが要る。
- iPhone／iPad実機Safari、複数端末での同時編集、Chrome以外のブラウザ。
- consoleには認証由来のエラー（AuthError／401／500）が出るが、これは3457のプレビューにセッションが無いことによるもの。UI由来のエラーは出ていない。**セッションのある状態でのconsole確認は未実施。**

### 11-7. Codexへの申し送り

- **`.next` を再ビルドした。** 3456で動いている本番プレビューは別プロセス（Codex側の起動）で、そのプロセスの `.next` を差し替えている。3456の画面が古い／不安定に見える場合は、再ビルド後に起動し直してほしい。**プロセスは止めていない。**
- `components/BottomNav.tsx` と `app/layout.tsx` に手を入れた。UIの担当範囲の外に見えるが、編集画面の縦を確保するために必要だった変更で、**利用者の承認を得ている**（2026-09-07）。影響は `isImmersiveRoute()` が真になる `/generator/<id>` だけに閉じている。
- `TargetActions` は残してあるが、使っているのは `StructureDialog`（並び順モーダル）だけになった。編集画面は `TargetStatus` ＋ `RestoreControl` を直接使う。

## 12. 2026-09-07（第3セッション・続き）：全ページのPNG一括書き出し

### 12-1. 見つかった抜け

**統合版には全ページの一括書き出しがない。** 書き出しの入口は `GeneratorPreview` の「PNGを保存」「共有」だけで、
どちらも表示中の1枚が対象。`app/generator/`・`lib/generator/`・`tools/generator-lab/` のどこにも
ZIP生成のコードがなく、仕様書§7にも複数枚をまとめる記述がない。

**旧スタンドアロン版からの後退。** 旧版には「全部書き出す」ボタン（`tools/monthly-generator/editor/index.html:237`）と
`editor/js/zip.js`（無圧縮stored のみ）があった。統合時にこの機能だけが引き継がれていない。
現状ではMonthly 1か月ぶん9〜14枚を、サムネイルで選び直して9〜14回押すことになる。

利用者の指示により、**UI・逐次描画・進捗・中止までをClaude Code側で用意し、ZIPのまとめ役をCodexが実装した。**

### 12-2. 用意したもの

| ファイル | 内容 |
| --- | --- |
| `app/generator/bulk-export.ts` | 新規。`buildArchiveEntries()`（検査→描画の2段、1枚ごとに `releaseCanvas`、中止対応）、`pngFileName()` / `archiveFileName()`、`BulkExportBlocked` / `BulkExportAborted`、`getArchivePacker()`（ZIP32・stored・UTF-8名・CRC32） |
| `app/generator/BulkExportButton.tsx` | 新規。見出し行の「全ページを書き出す」。進捗と結果は既存の状態帯へ流し、実行中は同じボタンが「書き出しを中止」になる |
| `app/generator/[id]/GeneratorWorkspace.tsx` | 見出し行へボタンを追加（文書単位の操作なので、ページ単位の出力ボタンとは分けた） |
| `app/generator/GeneratorPreview.tsx` | 1枚書き出しのファイル名を `pngFileName()` に寄せ、一括と規則を1か所にした |
| `lib/generator/__tests__/bulk-export.test.ts` | 新規7件 |

`buildArchiveEntries()` は描画コアを直接持たず、`prepare` / `inspect` / `render` / `toBlob` / `release` を
呼び出し側から受け取る。画面なしでテストできるようにするためで、`app/generator/` の外は変更していない。

### 12-3. 決めたこと・守ったこと

- **出力ゲートは1枚書き出しと同じ。** 文書全体に未保存があればボタンを押せない（§8-3の判断を一括にも同じく適用）。
- **はみ出しがあるページの扱い**：全ページを先に検査し、**1枚でも警告があれば何も作らずに止め、対象の画像番号と理由をまとめて出す**。
  部分的に書き出して「9枚のはずが7枚」になる方が危険なため、この判断を採用し、仕様書§7へ明記した。
- **メモリ**：2400pxのキャンバスを持ち続けると落ちるため、1枚ごとに `releaseCanvas` する。失敗時も `finally` で解放する（テストで確認）。
- **中止**は各段の区切りで効く。描画中の1枚は最後まで進む。中止した場合はファイルを作らない。
- ファイル名は1枚書き出しと同じ規則（`monthly_26_08_02.png`）。まとめたものは `monthly_26_08.zip`。

### 12-4. 現在の見え方

見出し行の右端、「最新版を再読込」の隣に置く。文書単位の操作なので、ページ単位の
「PNGを保存」「共有」とは列を分ける。

**色は「PNGを保存」と同じ紫（violet-600）**にして、出力の操作だと分かるようにした。
大きさと形は見出し行のほかのボタンに合わせる（`min-h-9` / `px-3` / `text-xs` / 角丸12px）。

`getArchivePacker()` が `null` の間は押せない状態にし、理由を `title` に出す。
**このとき `opacity` で薄くしない。** 当初は無効時に不透明度0.4にしていたが、暗い背景では
ボタンの存在ごと見えなくなり、利用者が見つけられなかった。背景色だけを45%へ落として文字は読める
濃さを残し、「準備中」を隣の小さなラベルで添える形に直した。ラベル自体は常に「全ページを書き出す」で変えない。

まとめ役の実装後は値が返るため、「準備中」は消えて既存ボタンがそのまま動く。

### 12-5. Codexでの完了内容

1. **`getArchivePacker()` を実装。** 外部ライブラリなしで、ZIP32のstored形式、UTF-8ファイル名、CRC32に対応した。CRC計算は各Blobをストリームで読み、完成ZIPもヘッダーと元BlobをBlob partsで結合するため、PNG全体の追加コピーを避ける。
2. **はみ出しページは全体中止に決定。** 欠けたページを含むZIPを正常な一式と誤認させないことを優先し、仕様書§7へ追記した。
3. **Mac実機で2400px×14枚を受入。** Codex内ブラウザで約6.2〜6.3秒、対象レンダラー約337MBから最大410MB（増分約73MB）で完了し、クラッシュ・停止はなかった。iPhone実機Safariでの上限は引き続き未確認。

### 12-6. 検証

- `npx tsc --noEmit --incremental false`、`npm run lint`：成功。
- `npm test`：**17ファイル・283件成功**（`bulk-export.test.ts` の7件を追加）。命名規則、描画順、1枚ごとの解放、
  失敗時の解放、はみ出し時に何も描かずに止まること、中止、進捗の段階を確認した。
- ブラウザ実測（`/generator/uipreview-temp`、localhost:3457の本番モード）：

| 画面幅 | 見出し行 | 大プレビュー | ボタンのはみ出し | 横スクロール |
| --- | ---: | ---: | --- | ---: |
| 1440×900 | 36px（1行） | 522px | なし | 0 |
| 1280×800 | 36px（1行） | 422px | なし | 0 |
| 1024×768 | 72px（2行） | 397px | なし | 0 |
| 390×844 | 137px（3行） | 330px | なし | 0 |

  ボタンは押せない状態で、`title` に理由が出ること、背景色が「PNGを保存」と同じ色相
  （`rgb(124,58,237)` の45%）で `opacity` が1のまま読めること、隣に「準備中」ラベルが出ることを確認した。
  高さ36px・文字12px・角丸12pxで、見出し行のほかのボタンと揃っている。

- **途中で見つけて直した不具合**：ボタン群に `shrink-0` が付いていたため、3つ目を足した時点で
  390px幅ではボタンが画面外へはみ出し、押せなくなっていた（`overflow-x: clip` のため横スクロールも出ず、
  気づきにくい）。`shrink-0` を外して折り返すようにした。1440／1280では1行のままで変化はない。
- Codex内ブラウザの固定データで、2400px×2枚と最大想定の14枚を実際に一括書き出しし、いずれも完了表示を確認した。14枚は3回計測して約6.1〜6.3秒。OS側で特定した対象レンダラーを実行中に1秒間隔で採取し、約337MBから最大410MB（増分約73MB）だった。逐次解放後もクラッシュ・停止はない。これはMac実機上のChromium系ブラウザでの結果で、iPhone実機Safariの確認を代替するものではない。
- 実Monthly文書のRelease Master由来Time 10件をversion 4〜13として共有保存し、画像2〜10の9枚を4.8秒で一括書き出しした。ダウンロードされたZIPは67,754,850バイト。`unzip -t`で全9件のCRCが正常、ファイル名は`monthly_26_08_02.png`〜`monthly_26_08_10.png`、全画像が2400×2400だった。3×3一覧の目視でも欠落・空白・明らかな文字切れはなかった。
- `bulk-export.test.ts` は7件のまま、旧「未実装」テストをstored形式、CRC32、UTF-8名、中央ディレクトリを確認するテストへ置き換えた。

---

## 13. 2026-09-08：Weekly（NEW RELEASE WEEK）の設計

利用者の依頼で、毎週金曜の新譜紹介をジェネレーターに載せるための設計を起こした。**コードは1行も変えていない。**
追加したのは `docs/generator-weekly-design.md`（設計の正本）と、`docs/codex-generator-handoff.md` への依頼1節のみ。

### 利用者の決定（2026-09-08）

1. データ源は**Release Masterの日付でその週を全件読み、メイン5枚とその他は画面で振り分ける**。シートに週用の列は追加しない。
2. **表紙を含めて7枚**すべてツールで作る（Monthly／Japanは表紙を作っていないが、Weeklyは作る）。
3. 機能契約（`model.ts`・取り込みAPI）の実装は**Codex**。UI・描画はそのあとClaude Code。

### 設計上の要点

- **DBのマイグレーションは不要。** `series`の`check`は既にweeklyを許容し、`unique (series, period_start, period_end)`が
  同一週の二重作成を防ぐ。ページ種別を検証しているSQLは無い。
- **`generator_structure_save` は「各ページの`itemIds`件数が変わらない」ことを要求している。**
  そのため「その他→メイン5枚へ**移す**」操作は現行APIでは必ず`INVALID_INPUT`になる。
  選定を**入れ替え（swap）**として定義すれば件数が動かず、**APIもマイグレーションも無改造で成立する**。
  UI側も「枠へドロップ＝その枠にいた作品がリストへ戻る」という見た目にする。
- `ItemContent`・`GeneratorTheme`は**変更不要**。評価文は空文字、おすすめ曲は`show.track: false`、波は`useWave: false`で作る。
  → Monthly側の保存・復元・ローカル復旧の契約に触らずに済む。
- `canvas-preview.ts` の `no: pageIndex + 2` はMonthlyの「表紙を作らない」前提が焼き込まれた箇所で、weeklyでは`+0`にする必要がある。
- 書き出し名は `weekly_26_W35_00.png` ／ `weekly_26_W35.zip` を提案（現行規則だと同じ月の各週が区別できない）。**Monthly側の命名は変えない。**

### 維持した機能契約

コードを変更していないため、本文の自動行送り、`bodyLeadMode`の互換、iPhoneの字間UI非表示、
保存・ロック・履歴・復元・ローカル復旧の不変条件はすべて現行のまま。

### 未確認・止まっている点

- **表紙の書体`Alternate Gothic No2 D`がGoogle Fontsに無い。** 現行`fonts.mjs`はOswaldとNoto Sans JPだけを読み、
  Oswaldが当たらなければ例外で描画を止める設計。セルフホストか代替書体かの判断が要る。
- **版面の実測値が足りない。** ジャケットのy・各行のベースライン・表紙の`Strip_1`〜`_5`の座標・
  Other Releasesの段組が未実測。Figma接続の認証がこのセッションになく、実測できなかった。
- 自動テスト・ビルドは実行していない（コード変更が無いため）。

### 2026-09-08 追記：Figmaで版面を実測

`Post-images`（`fPJXS1TvmBhHCX9E2zme4i`）の`Weekly`ページを実測し、設計文書 §6.1〜6.3を推測から実測値へ差し替えた。

- **作品面（`2026_W-1`）は全数値が確定。** 内枠(200,50)800×1100／ジャケ(200,50)800×800／
  `Album`(224,880)752×240・gap44／作品名 Oswald Regular 54・字間−1.08px(−2%)・行送り72・y904／
  アーティスト Oswald ExtraLight 42・行送り48・y980／メタ帯 Oswald Light 32・UPPER・要素間16px・y1064。
  区切りは **`・`（中黒）**で、Monthlyと同じだった。罫・パネル塗りは無い。
- **表紙（`2026_W-0`）の構成が確定。** 縦帯は各240×1200が5本で、左から `4 2 1 3 5`（1位が中央）。
  ロゴは(450,1023)300×176.66＝**下端0**で、docs/10の「下端0」を裏付けた。週タイトルの枠は(408,499)383×217。
- **Other Releases（`2026_W-6`）は1段組。** 内枠は作品面と同じ(200,50)800×1100、見出し枠(200,50)800×172、
  本文枠(240,222)**720×897**に1テキスト。2段組ではない。
- **前提の訂正：Weeklyも`Backwave`を敷いている。** 当初「波は使わない（`useWave: false`）」と書いたのは誤りで、
  取り込みは`useWave: true`にする。設計文書と`docs/codex-generator-handoff.md`の該当箇所を直した。
- **未取得：** 表紙`overlay`の塗り、週タイトルの実書体指定、Other Releasesの`Rectangle 12`の塗り・角丸、
  見出しと本文の行送り。FigmaのStarterプランのツール呼び出し上限に当たったため。上限回復後に4回ほどで埋まる。

## 14. 2026-09-08：Weekly UI実装の着手、WEEK列の発見、実装方針の確認

Koheiの依頼でWeekly UI実装に着手。着手直後にFigma MCPを試したがStarterプランのレート上限は未回復（Codexが§13で当たったのと同じ）。

### Koheiに確認・回答した4点

1. **表紙書体 `Alternate Gothic No2 D`**：セルフホスト方針で合意。Koheiから「自分で所有しているフォントファイルを使う形か」と質問があり、そのとおりと回答。ただし商用書体のためWeb埋め込み権がデスクトップ用ライセンスに含まれるとは限らない旨を伝え、Figma側の提供元（Adobe Fonts経由なら別解あり）の確認を依頼中。**フォントファイルの到着待ち。**
2. **洋楽4＋邦楽1の強制**：不要と決定。理由はKoheiの回答から後述のWEEK列発見につながった。
3. **長い作品名（内枠800pxに入らない場合）**：**字間を自動で詰める**で決定。実装時は下限を設け、それでも収まらない場合ははみ出し警告でPNG生成を止める（§6.4の方針を踏襲）。
4. **表紙背景写真の運用**：Koheiの回答から「その週の金曜日が属する暦月の背景を使う」と解釈して進める（未確定なら要修正）。

### 重要な発見：Release Masterに`WEEK`列が実在した

「洋4邦1を強制するか」への回答（「release masterで該当週にWEEK列が採用となっているものです」）から判明。`scripts/check-headers.ts`でO列（index 14）が`"WEEK"`であることを確認し、実データ1218行を確認したところ値は`採用`／`掲載`／`不採用`の3種（`M/J採用`と同じ語彙）。

設計文書（`generator-weekly-design.md` §3・§9-4）の「Weeklyの採用概念はシートに無い」という前提が誤りだった。現行の`lib/generator/source.ts`の`selectWeeklyAlbums()`（洋4邦1ヒューリスティック、Codex未コミット）はこの列を知らずに書かれており、`不採用`の除外もしていない。

詳細・修正案は[Weeklyの設計 §12](./generator-weekly-design.md#12-2026-09-08追記week列の発見設計の前提が変わった)、Codexへの依頼は`docs/codex-generator-handoff.md`へ記録した。**Koheiの指示で、この修正はCodexへ差し戻す（従来の分担どおり）。**

### 実装したもの（安全に確定できる範囲のみ）

- `tools/generator-lab/core/pages.mjs`：`toWeeklyDrawData(slot)`を追加。Weeklyの作品面には評価文・RECOMMEND帯が無い（設計書§1・§6.1）ため、既存`toDrawData`から`body`／`rec`／`bodyLeadMode`／`bodyMaxLead`を落とした最小形。`meta`はMonthlyの`metaBand()`をそのまま流用（曲数・総尺・ジャンル・国、区切り「・」、UPPER、要素別show/typography対応まで同一と設計書§6.1で確認済み）。`[EP]`は落とさない（取り込み時点で保持済みの前提）。
- テスト4件を`tools/generator-lab/test/pages-check.mjs`へ追加（body/rec不在の形、metaBand共用、EP保持、show非表示時の空文字化）。`node --test tools/generator-lab/test/*.mjs`は全件成功。

### あえて実装しなかったもの・理由

- **`Layout`への`weekly-v1`のセル・書体定数、`Render.drawWeeklyFeature()`は未実装。** 設計書§6.1のy座標（作品名904・アーティスト980・メタ帯1064）はFigma上の「箱の上端＋高さ」の生データで、キャンバスの`fillText`ベースラインへ変換するには縦方向トリム設定（cap-height基準か等）の確認が要る。参照画像なしで変換式を推測して実装すると、Monthly／掲載枠のときに実施した「figma.pngを実測してベースラインを確定する」方法（`measure/layout_of.js`）を経ずに版面を作ることになり、必須条件（画面と書き出しの一致）を満たせないまま進むリスクが高い。**Koheiに`2026_W-1`の2倍PNG書き出しを依頼済み**（`tools/generator-lab/reference/weekly-feature.png`を想定）。到着後、同じ実測方法で確定させる。
- `lib/generator/canvas-preview.ts`のweekly対応も見送った。Codexの現行スタブ（weekly kindはnullを返す）は、`Render.drawWeeklyFeature()`が無い状態で`feature`/`cover`/`others`を通してしまうと、`render.mjs`の`drawPage()`が未知kindを`drawListed`（Monthlyの掲載枠2面レイアウト）として誤描画してしまう安全弁になっている。描画関数ができるまでこのスタブは維持する。

### 未確認・次の担当者が行うこと

- `Layout.WEEKLY`のセル・書体定数と`Render.drawWeeklyFeature()`：参照画像到着後、`measure/layout_of.js`と同じ方法で実測してから実装する。
- 表紙・Other Releasesの実装：Figmaレート上限の回復待ち（overlay塗り、週タイトル書体、Other Releasesの塗り・角丸・行送り）。フォントファイルの到着も必要。
- `lib/generator/source.ts`のWEEK列対応：Codexへ依頼済み（`codex-generator-handoff.md`参照）。この修正が終わるまで、実データでのWeekly取り込み・選定UIの実装は本格着手しない（データの前提が変わるため）。
- 本ターンでは`npx tsc --noEmit --incremental false`／`npm run lint`／`node --test tools/generator-lab/test/*.mjs`（全件成功）／`npm test -- --reporter=dot`（19ファイル・314件成功）／`npm run build`（成功）を実行。

## 15. 2026-09-08（続き）：実物投稿7枚を受領、feature版面をpixel検証で確定・実装

Koheiから実物投稿7枚（2026 WEEK 36、`tools/generator-lab/reference/2026#36/2026_W-0.png`〜`_6.png`、
すべて2400×2400）と、表紙書体`Alternate Gothic No2 D`のフォントファイルを受領した。

### 重要な訂正：罫・パネル塗りは「無い」ではなく「ある」

設計文書§6.1は「罫・パネル塗りは無い」としていたが、実物5枚（`W-1`〜`_5`）を画素単位で実測すると、
**Monthlyとまったく同じ規則**（各セルの外側6px白罫、黒系60%パネル。パネル色は投稿ごとに色相が違う＝
背景に応じた「黒を乗算」方式）が使われていた。原因はFigmaのノード検査が親フレームの効果を辿れていなかったと見られる。
実測値は`generator-weekly-design.md` §6.1・§12に記録した。

### 実装したもの

- `tools/generator-lab/core/layout.mjs`：`Layout.WEEKLY`を追加（セル・ベースライン・字体・シャドウの実測値一式）。
- `tools/generator-lab/core/render.mjs`：`Render.drawWeeklyFeature()`（作品面の描画）と`Render.fitWeeklyTitle()`
  （内枠752pxに収まらない作品名を字間で自動的に詰める。Koheiの決定）を追加。
- `tools/generator-lab/test/weekly-check.mjs`（新規）：8件。`Layout.WEEKLY`の値、`fitWeeklyTitle`の3分岐
  （収まる／詰めて収める／下限でも収まらずoverflow）、`toWeeklyDrawData`の形を検証。

### 検証方法と結果

Ellie Goulding／I Know Too Muchのデータで`Render.drawWeeklyFeature()`を実際に描画し、実物`2026_W-1.png`と
同じ手法（白インクの画素プロファイル）で測定・比較した。

- インク位置は1px以内で一致（作品名y948→950、アーティストy1025→1026、メタ帯x335→335など）。
- 赤＝実物／緑＝自作の重ね合わせで、罫・タイトル・アーティスト・メタ帯がほぼ完全に一致（縁の色滲みのみ、通常のアンチエイリアス差）。

### 実装中に見つけて直した不具合

`fitWeeklyTitle`の二分探索が逆向きだった（収まる側に収束すべきところ、baseTrackingに向かって収束していた）。
最初のテストで「明らかに752pxを超える53文字のタイトルが字間据え置きで“収まる”」と出たため発覚。
`lo`（収まる側）と`hi`（収まらない側）の更新方向を入れ替え、返り値も`hi`から`lo`へ修正した。
修正後、テストで「返ってきたtrackingで実際に収まり、それより少し緩めると収まらない」という境界性まで検算している
（この検算が無いと同種の回帰は再発しても気づけない）。

### あえて実装しなかったもの・理由

- **`lib/generator/canvas-preview.ts`のweekly対応は見送った。** `drawWeeklyFeature`は動くが、これをアプリの
  プレビュー・サムネイル・一括書き出し（`GeneratorPreview.tsx`／`PageNavigator.tsx`／`BulkExportButton.tsx`／
  `runtime.tsx`の4箇所）へ配線する作業がまだ残っている。`cover`／`others`の描画が無い状態で配線すると、
  weekly文書の一部ページだけ描画できて一部できない、という中途半端な状態を作り込むことになるため、
  表紙・Other Releasesの目処が立ってからまとめて配線する方が事故が少ないと判断した。
- 表紙・Other Releasesの実装は引き続き保留。表紙はフォントの入手経路確認待ち（`generator-weekly-design.md` §9-1）、
  Other Releasesは行送り等の書体詳細がFigmaレート上限で未取得（§9-2）。

### 検証コマンド

`node --test tools/generator-lab/test/*.mjs`（44件成功）／`npx eslint tools/generator-lab`（成功）／
`npx tsc --noEmit --incremental false`（成功）。`npm run build`は今回の変更が`.mjs`のみのため未実行
（前回セッションで成功確認済み、コード変更なし）。

### 次の担当者が行うこと

1. `lib/generator/canvas-preview.ts`の`feature`対応（`no: pageIndex`のweekly分岐含む）と、上記4ファイルへの配線。
2. 表紙の書体：入手経路の確認結果を受けて`fonts.mjs`の読み込み経路を拡張するか、Adobe Fonts埋め込みへ切り替える。
3. 表紙・Other Releasesの実測（Figmaレート上限の回復を待つか、実物投稿PNGでの実測を試す。今回の`feature`と同じ方法が使える見込み）。
4. `lib/generator/source.ts`のWEEK列対応（Codexへ依頼済み、`docs/codex-generator-handoff.md`参照）が終わるまで、
   実データでの通し受入（作成→取り込み→編集→保存→書き出し）は本格着手しない。

## 16. 2026-09-08（Codex継続）：Weeklyを統合画面へ接続

週間上限で中断したClaude Codeの作業を引き継ぎ、Weeklyを取り込みから7枚書き出しまで統合画面へ接続した。

### 実装したもの

- Release Masterの`#`列を週番号の正本として読み、対象金曜までの土曜〜金曜にある`WEEK=採用`をfeature、`WEEK=掲載`をOthersへ取り込む。空欄・`不採用`は除外し、対象行の`#`が欠損・不正・複数番号の混在なら取り込みエラーにする。文書の識別期間は選択金曜〜翌金曜のまま保持する。
- `cover`／`feature`／`others`をプレビュー、サムネイル、クリック判定、はみ出し検査、単枚PNG、全ページZIPへ接続した。未知kindのMonthly掲載面フォールバックは廃止した。
- 表紙の5ジャケットはfeatureページ順から導出し、選定・並び順の変更へ自動追従させた。Release Masterの`#`列を見出し・表紙・PNG／ZIP名に使い、年だけは対象金曜のISO週年を使う。
- ハブへWeeklyと金曜入力を追加し、`weekly_YY_Www_00.png`／`weekly_YY_Www.zip`の名前で書き出す。
- 情報修正はfeatureで作品名・アーティスト・曲数／総尺・ジャンル・国、Othersで作品名・アーティストだけを表示する。Othersは最大30タブを並べず作品選択ドロップダウンにした。
- 並び替え画面でfeatureの順序変更、Othersの順序変更、featureとOthersのswapを行える。ページごとの件数は変えず、既存の`generator_structure_save`契約を維持する。
- カバー画像は文書に保存されたURLを正本として読み、Release Master再取得は旧文書の補完に限定した。再取得に失敗しても文書内URLで描画を継続する。

### 検証

- 固定Weekly文書を一時プレビュールートで開き、表紙、feature 5枚、Others、ページ番号0〜6、ページ別編集項目、swap候補を実ブラウザで確認した。横スクロールとbrowser consoleのwarning／errorは無かった。一時ルートは確認後に削除した。
- 共有DBを変更する操作はしていない。固定文書のためロックAPIの404表示は想定内で、編集操作と保存は実行していない。
- 自動テストではWEEK列の振り分け、空欄・不採用除外、`#`の欠損・不正・混在拒否、重複除去、上限、ISO週年、表紙とfeatureの連動、swapの件数不変、Weekly描画と警告、ZIP名を追加確認した。
- 2026-09-09に週境界をNew Music Fridayの運用どおり土曜〜金曜へ確定し、`#`列を型・API・文書の`period.weekNumber`・表紙・見出し・ファイル名へ接続した。境界テストは直前金曜と翌土曜を除外し、土曜と対象金曜を含む。
- 同日の実Release Master読み取りではW35がfeature 5件＋Others 26件、W36がfeature 5件＋Others 30件で、全件のジャケットURLを取得できた。最新検証はアプリ19ファイル319件、描画コア58件、型検査、lint、本番ビルドが成功した。
- 実共有W36文書を作成し、swap保存・構成復元・作品保存・作品復元をversion 1〜5として確認した。並び順のHTTP入力検証をWeeklyの表紙0件／Others最大60件へ対応し、DB側の「ページ件数不変」検証は維持した。
- `weekly_26_W36.zip`（48,342,938 bytes）を実ブラウザで生成し、全7枚のCRCと2400×2400寸法を確認した。表紙・メイン・Othersも目視した。
- iPhone 17 Pro／iOS 26.3 Simulatorで縦画面を確認し、日本語システムフォントが無い環境向けに描画用Noto Sans JPを編集UIでも使用した。狭幅で警告帯が1文字ずつ折り返す問題も縦積みへ補修した。横向き相当844×390・coarse pointerでは字間UI非表示と横オーバーフローなしを確認した。
- 最新検証はアプリ19ファイル320件、描画コア59件、型検査、lint、本番ビルドが成功した。

### 残件

- 接続された物理iPhoneが無かったため、実機Safariでのスリープ復帰、連続PNG／ZIP、メモリ負荷は未確認。Simulatorとタッチ対応ブラウザエミュレーションは確認済み。
- commit、push、デプロイを行い、公開環境でGoogleログイン後にW36文書を開けることを確認する。

## 17. 2026-09-08（利用制限からの復帰）：表紙・Other Releasesの実測を完了、Codexの統合作業を検証

§15の続き。中断中にCodexが週間上限で止まった作業を引き継ぎ、統合（`canvas-preview.ts`・`runtime.tsx`・ハブ・プレビュー・ナビゲーション・一括書き出し）まで完了させていた（`docs/generator-ui-implementation.md` §16「Codex継続」）。復帰後、自分の担当だった表紙・Other Releasesの実測を完了させ、Codexの統合結果を検証した。

### 完了させたもの（自分の担当分）

- 表紙・Other Releasesを実物投稿（`tools/generator-lab/reference/2026#36/2026_W-0.png`・`_6.png`）で画素単位実測し、`Layout.WEEKLY.COVER`・`Layout.WEEKLY.OTHERS`・`Render.drawWeeklyCover`・`Render.drawWeeklyOthers`を実装（中断前に着手済みだったものを完成）。
  - 表紙: 帯オーバーレイの色（🟡単一投稿からの推定）以外はすべて実測値。週タイトルは中央揃え（設計時の左寄せ座標は誤り、§12参照）。ロゴは既存アセットを画像として描画。
  - Other Releases: 見出し・本文フォントサイズを実測（71px／29px）。**行送りをKoheiの指示どおり件数に応じて自動的に詰める／広げる**実装（`Layout.WEEKLY.OTHERS.layoutFor`、Monthlyの本文と同型）。
  - 表紙書体`Alternate Gothic No2 D`をセルフホストで統合（`tools/generator-lab/assets/`、`fonts.mjs`にMonthly/Japanを巻き込まない設計で追加）。
- テスト21件を`tools/generator-lab/test/weekly-check.mjs`へ追加。
- `docs/generator-weekly-design.md` §6.2・§6.3・§9を実測値で更新。

### Codexの統合結果の検証

- `npx tsc --noEmit`／`npm run lint`／`node --test tools/generator-lab/test/*.mjs`（58件）／`npm run build`：すべて成功。
- `render.mjs`の`drawPage()`が`cover`／`feature`／`others`を自分の担当した各関数へ正しく振り分けていること、未知kindは例外を投げる（Monthlyの掲載枠へ誤フォールバックしない）ことを確認した。
- `runtime.tsx`がロゴアセットを正しく読み込み、`images.logo`として渡していることを確認した。

### 見つけた不具合（2026-09-09にCodexで解消）

- `source.test.ts`の境界fixtureを土曜〜金曜へ揃え、失敗を解消した。
- Koheiの説明に基づき、週の抽出窓をNew Music Fridayの土曜〜金曜へ確定した。Release Masterの`#`列を週番号の正本として取り込み・保存・表示・命名へ接続し、説明文も統一した。

いずれも`lib/generator/`は変更していない（担当領域の外のため）。

### 検証コマンド

復帰時点の検証は`npx tsc --noEmit --incremental false`／`npm run lint`／`node --test tools/generator-lab/test/*.mjs`（58件成功）／`npm run build`（成功）。その後のCodex修正を含む最新結果は§16の検証追記を正とする。

## 18. 2026-09-09：表紙オーバーレイ色の確定（Codexと並行、描画側のみ）

Codexが機能側（取り込み・テスト）を進めている間に、干渉しない描画側の残件を1つ片づけた。
変更したのは`tools/generator-lab/`だけで、`lib/generator/`・`app/`・API・DBには触れていない。

### 背景

`docs/generator-weekly-design.md` §6.2のオーバーレイ色は、実物投稿1枚の白背景部分からの逆算で
`rgba(0,63,198,0.6)`とし「🟡他週の実物で検算要」のまま残っていた。

### 確定した値

**`#0040C7` の不透明度60%（＝`rgba(0,64,199,0.6)`、通常の重ね方で乗算ではない）。** KoheiからFigmaの原本値を受け取り、
実物投稿でも独立に裏付けた。当初の逆算値は各成分が1ずれていた。

裏付けは画素回帰による。表紙の帯は各ジャケットを240×1200へcover-fitしたものだが、同じジャケットが
作品面（`2026_W-1`〜`W-5`）のセル(200,50)800×800に無加工で写っているため、両者で`dst = (1-a)·src + a·C`を
立てて最小二乗で解ける。週タイトル2行と毛筆ロゴはオーバーレイの上に描かれるので除外し、再標本化のずれを
避けるため原寸側が平坦な画素だけを使った。

- 5本中4本が**α=0.599〜0.602、C=(0, 63.5〜64.1, 198.6〜199.2)**＝`#0040C7`@60%に一致。
  285,461画素／チャンネルでの平均残差**1.2階調**。
- 残る1本（帯index1＝2位の作品）は縦位置`v0=0.000`・倍率`1.000`と完全一致のまま、**横の切り出しだけ中央40%ではなく18.4%**。
  実物投稿が手作業で作られたことによるトリミング差で、オーバーレイの値とは無関係と判断した。

### 変更したファイル

| ファイル | 変更 |
| --- | --- |
| `tools/generator-lab/core/layout.mjs` | `WEEKLY.COVER.OVERLAY.color`を`rgba(0,64,199,0.6)`へ。出典と裏付けをコメントに記録 |
| `tools/generator-lab/measure/overlay-of.mjs` | 新規。検算スクリプト（PNGデコード＋画素回帰）。`node tools/generator-lab/measure/overlay-of.mjs [参照フォルダ]` |
| `tools/generator-lab/test/weekly-check.mjs` | 定数の回帰テストを1件追加（58→59件） |
| `tools/generator-lab/reference/README.md` | 受領済みファイルの一覧と、存在しないスクリプトを指していた実測手順を差し替え |
| `docs/generator-weekly-design.md` | §6.2の表と🟡注記、§9-2、更新履歴 |

`app/generator/runtime.tsx`は`layout.mjs`を直接importしているため、アプリ側の描画にも追加変更なしで反映される
（オーバーレイ色の定義はこの1か所だけで、複製は無い）。

### 検証

`node --test tools/generator-lab/test/*.mjs`（59件成功）、`npx tsc --noEmit --incremental false`、`npm run lint`：いずれも成功。
`node tools/generator-lab/measure/overlay-of.mjs`で上記の回帰結果を再現できる。

### 未確認・Codexへの引き継ぎ

- 実ブラウザでの表紙の目視確認は未実施（1階調の色差なので画面での識別は困難、数値と回帰テストで担保している）。
- `npm test`／`npm run build`は、Codexが`lib/generator/`を編集中のため実行していない。区切りのついた時点で通してほしい。
- 設計文書§9-3「表紙の背景写真は金曜日が属する暦月の背景を使う」は**Koheiの最終確認待ちのまま**。

## 19. 2026-09-09：背景の合成をLuminosity・不透明度50%へ（実物一致を確認）

Weeklyのwaveが実物投稿と合わない件を追い、**waveが月替わりの素材**であること（同梱`wave.png`は2026年8月版、
参照画像は9月版）と、**合成がLuminosity・不透明度50%**であることをKoheiの説明で確定し、実測で裏付けた。

### 経緯と根拠

1. 参照画像7枚の背景の明暗パターンは互いに相関1.00だが、同梱`wave.png`とは0.13しかなかった。
2. Koheiから9〜12月のwaveを受領。9月版で解き直すと相関0.9994へ。ただし**チャンネルごとの実効不透明度が
   0.25/0.68/0.45とばらけ**、「色のまま50%」では説明できなかった。
3. Rec.601の重み（0.3/0.59/0.11＝W3CのLum）でグレー化すると3チャンネルとも**0.497〜0.500**。
   Koheiの回答「waveにLuminosityがかかっている」と一致した。
4. W3C Compositing 1のLuminosityで合成し直すと、作品面5枚は残差**平均0.34階調・最大2**。

### 変更したファイル

| ファイル | 変更 |
| --- | --- |
| `tools/generator-lab/core/layout.mjs` | `BACKGROUND`を`{ waveOpacity: 0.5, waveBlend: 'luminosity' }`へ。旧コメント（「50%は波PNGのαに焼き込み済み」）を差し替え、月替わり素材であることを明記 |
| `tools/generator-lab/core/render.mjs` | `drawBackground()`で`globalCompositeOperation`を設定。素材のαを測って不透明度を補正する`waveAlphaOf()`を追加。表紙のオーバーレイに残っていた🟡コメントも解消済みへ更新 |
| `tools/generator-lab/background-check.html` | 新規。実物投稿と`Render.drawBackground()`の出力を画素比較する検証ページ |
| `tools/generator-lab/test/layout-check.mjs` | 定数の期待値を更新 |
| `docs/generator-weekly-design.md` | §6.1の背景行、§6.5（新規）、§9-3の書き換え、更新履歴 |
| `docs/codex-generator-handoff.md` | 月別waveの管理・自動適用の依頼を追加 |

### 検証

- 実ブラウザ（`generator-lab`サーバ8778、`background-check.html`）で作品面5枚**平均0.24〜0.26階調・最大2〜4**、
  Other Releasesのみ平均1.85・最大11。
- `node --test tools/generator-lab/test/*.mjs`（59件成功）、`npx tsc --noEmit --incremental false`、`npm run lint`。

### 未確認・引き継ぎ

- 素材の世代差（カラー原版α=255／旧方式α=128焼き込み）は`Render.drawBackground()`のα補正で吸収した。
  実ブラウザで両世代とも実効50%との差は平均0.27階調。8月のカラー原版をもらう必要はなくなった。
- **🟡 Monthly／Japanの見た目は変わる。** 通常合成では地の色の彩度が半分に薄まっていたのが、
  Luminosityでは保たれる。くすんだ色はほぼ同じ、鮮やかな色ほど差が大きい
  （波の明度100で`#475569`→わずか、`#B21555`は`#8b3d5d`→`#be2161`）。Monthly実物との見比べはKoheiの確認待ち。
- Other Releases面の残差1.85は、地の色でも不透明度でも説明できない差が残っている（§6.5の🟡）。
- 月別waveの保管・自動適用は機能側の設計。`docs/codex-generator-handoff.md`へ依頼を書いた。
- `npm test`／`npm run build`は、Codexが`lib/generator/`を編集中のため未実行。

## 20. 2026-09-09：月別waveの保管と自動適用

Koheiの決定（waveは月替わり、原版は未加工で渡す、投稿に応じて正しい波が出るようにする）を実装した。

### 決めた形

**原版は加工せずに受け取り、こちら側でグレースケールへ変換してリポジトリに置く。**
背景の合成はLuminosityで波の輝度しか使わないため、色を落としても出力は変わらない
（実測：変換後とカラー原版の差は平均0.18階調・最大1）。容量は約1/3（9.1MB→2.86MB）になる。
半分の解像度も試したが、背景に平均1.4階調の差が出るため2400pxのまま維持した。

| ファイル | 変更 |
| --- | --- |
| `tools/generator-lab/make-wave.mjs` | 新規。原版→8bitグレースケールPNG（`assets/waves/wave26MM.png`）。PNGの読み書きは自前（依存を増やさない） |
| `tools/generator-lab/assets/waves/` | 新規。2026-08〜12。8月は同梱の旧`wave.png`から変換した |
| `app/generator/runtime.tsx` | `BUNDLED_WAVES`／`waveForMonth()`。`period.start`の月で自動選択。未登録月は直近の月へ寄せて`runtime.wave.exact=false`を返す |
| `app/generator/[id]/GeneratorWorkspace.tsx` | `GeneratorRuntimeProvider`へ`period`を渡す |
| `app/generator/[id]/Inspectors.tsx` | 共通設定に使用中の月を表示。未登録月は警告色で知らせる |
| `.gitignore` ／ `reference/README.md` | 参照画像と原版をGit管理外へ。READMEだけ追跡し、受け取ってからの手順を書いた |
| `tools/generator-lab/background-check.html` | 新規。実物との一致・素材のα吸収・変換前後の同一性を1ページで検証 |
| `tools/generator-lab/wave-blend-compare.html` | 新規。通常合成とLuminosityを並べて見るページ（Monthlyの見た目確認用） |

### 維持した機能契約

- `theme`のスキーマ、`generator_check_assets`、マイグレーションは変更していない。
- `theme.waveAssetId`（アップロードによる差し替え）は従来どおり優先される。
- 波を出すかどうかの`useWave`、合成済み背景画像`backgroundAssetId`の優先順も変えていない。

### 検証

- 実ブラウザ（8778番、`background-check.html`）：実物投稿との差は作品面5枚が平均0.24〜0.29階調、
  素材のα吸収は旧方式・変換後・カラー原版のいずれも実効50%との差0.26〜0.27階調、
  グレースケール変換の前後で平均0.18階調。
- `node --test tools/generator-lab/test/*.mjs`（59件成功）、`npx tsc --noEmit --incremental false`、
  `npm run lint`、`npm run build`：すべて成功。

### 未確認・引き継ぎ

- **Monthly／Japanの見た目の最終確認はKoheiが実施予定**（通常合成→Luminosityで地の色の彩度が保たれる）。
  `wave-blend-compare.html`で並べて見られるようにした。
- 実アプリでの月別自動選択の目視確認は未実施（共有文書が要るため）。ビルドと型検査は通っている。
- 月別waveをSupabaseへ移すか、「この文書はこの月」を保存できるようにするかは`docs/codex-generator-handoff.md`へ。
- `npm test`はCodexが`lib/generator/`を編集中のため未実行。

### 20-2. 同日追記：2026年1〜12月の原版を受領

- 全12か月を変換して`assets/waves/`へ（約32MB。原版は約98MB）。`BUNDLED_WAVES`も12か月ぶんに。
- **旧`assets/wave.png`を退役。** 8月の原版と比べると別加工版（平均輝度88.4／sd47.5、原版は112.8／39.6、
  相関0.9855）だったため、原版を正本とした。標準の波を使う`app.mjs`・`checks.mjs`・`recovery-checks.mjs`と
  検証ページはすべて`waves/wave2608.png`を見る。**8月のMonthlyは背景がわずかに明るく・柔らかくなる。**
- 9月の原版も受領し直したもので、実物投稿との残差は0.24〜0.29→**0.66〜0.71階調**に変わった（再書き出しの差）。
- αを焼き込んだ旧方式の素材は同梱をやめたので、`background-check.html`は検証用にその場で作って補正を試す。
- 再検証：テスト59件、`tsc`、`lint`、`npm run build`、`background-check.html`すべて成功。

## 21. 2026-09-09（Codex継続）：月別waveの実共有受入

Claude Codeの§19〜20を、実共有DBと統合画面で通し確認した。機能契約・スキーマ・API・DB・マイグレーションは
変更していない。

### 実共有文書

- W36 Weekly（`e5f18e71-e2c0-4d2c-98fb-d32f65292582`）は共通設定に
  「2026年09月の波を使っています」と表示された。出力サイズを一時的に1200pxへ変更してversion 7へ保存し、
  version 6の共通設定をversion 8として復元した。最終値は2400px、未保存0件、ロック0件。
- 2026年8月Monthly（`93df6cb5-6c42-41fb-9a53-07dff061aafa`）は
  「2026年08月の波を使っています」と表示された。同じ手順でversion 14へ保存し、version 13からversion 15として
  復元した。最終値は2400px、未保存0件、ロック0件。
- ブラウザの一時的な復旧コピーは両文書とも破棄し、検証用ロックも明示的に解放した。

### PNG／ZIP

- `weekly_26_W36.zip`：7枚、47,377,064 bytes。`00`〜`06`のCRCはすべて正常、全画像2400×2400。
  featureとOther Releasesを目視し、9月のwave、ジャケット、文字に欠落や明らかな切れがないことを確認した。
- `monthly_26_08.zip`：9枚、59,578,423 bytes。`02`〜`10`のCRCはすべて正常、全画像2400×2400。
  代表の採用面を目視し、8月のwave、ジャケット、本文、日本語に欠落や明らかな切れがないことを確認した。

### 設計判断と検証

- 月別waveは当面リポジトリ同梱を維持する。対象月の1枚だけをブラウザが取得でき、認証・共有Storage障害へ
  新たに依存しない。容量増加は今後の年次運用を見て再評価する。
- 使用月は`period.start`から導出する現行設計を維持する。意図的な別素材は既存の`theme.waveAssetId`で
  差し替えられるため、文書へ月を重複保存しない。
- `npm test -- --reporter=dot`：19ファイル320件成功。
- `node --test tools/generator-lab/test/*.mjs`：59件成功。
- `npx tsc --noEmit --incremental false`、`npm run lint`、`npm run build`：成功。
- 物理iPhone実機のスリープ復帰・反復PNG／ZIP負荷、3人・別端末の同時編集は未確認のまま。

## 21. 2026-09-09：和文書体をNoto Sans JPへ、Other Releasesの太さを補正

Koheiの2つの依頼（①Zen Kaku→Noto Sansの再吟味、②Other Releasesが太く感じる）に対して、
和文タイトルを含む実物投稿を受領して画素で照合し、両方を実装した。

### 「Oswaldで和文を打つと何が出るのか」への答え

- **このツール**：`family`が`'Oswald", "Noto Sans JP'`というスタックなので、和文グリフは**Noto Sans JP**が出る
  （メタ帯・RECOMMEND帯は300、Other Releases本文は400）。ただし作品名とアーティスト名だけは
  `TextEngine.isMixed`／`prepareMixed`で別指定（`titleJP`／`artistJP`）に切り替わる経路がある。
- **Figma**：Oswaldに和文グリフが無いのでOS側がフォールバックする。過去の検証では**YuGothic Bold**だった
  （`layout.mjs`の`TYPE.titleJP`コメント、docs/08 §4）。誰かが選んだものではない。
  今回の実測でも、実物のアーティスト名はYuGothic 400が+3.4%と最も近く、この記録と整合している。

### 測ったこと

`jp-font-check.html`（新規、`generator-lab`サーバ8778番）。実物の行を切り出し、候補で組んだものと
**インクの幅**と**塗りの量**で比べる。候補は本番と同じ4倍描画→縮小を通し、比較するウェイトは
すべて明示的に読み込む（読み込まないとブラウザが近い面や合成ボールドで代用し、測定が無意味になる）。

- **幅はどの候補も±1px以内で一致**。つまり版面・サイズは正しく、違うのは太さと字形だけ。
- 作品名：Noto Sans JP 400が**+0.4%**（Weekly）、**−4.3%**（Japan）。旧`Zen Kaku 700`は**+48.1%**（太すぎ）。
- アーティスト：Noto Sans JP 300が**−0.8%**（Weekly）、**+1.0%**（Japan）。旧`Zen Kaku 300`は**−25.4%**（細すぎ）。
- Other Releases：**欧文だけの行でも+21.6%**濃い。和文まじりの行も+19.7〜20.1%と同程度。
  → 和文固有の問題ではなく、SPEC §9.5のChrome由来のインクの濃さ。

**測り方でつまずいた点（次に測る人向け）**：インクの量は「地に対する明るさの合計」で数えるが、
地の明るさを切り出し全体で1つの値にすると、パネルの下の写真の明暗差で**地そのものをインクとして数えてしまう**。
Monthlyのサンプルでは実物の値が2倍近くに膨らみ、どの候補も−50%という嘘の結果になった。
**文字のまわりだけに絞ってから地を推定する**（`measureTight`）ようにして解決した。
候補側の箱を小さく取って和文の上下が切れているのにも同じ症状が出る。

### 変更したファイル

| ファイル | 変更 |
| --- | --- |
| `tools/generator-lab/core/layout.mjs` | `TYPE.titleJP/artistJP`と`WEEKLY.TYPE.titleJP/artistJP`を`Noto Sans JP` 400／300へ。`WEEKLY.OTHERS.TYPE.body`に`renderWeight: 350` |
| `tools/generator-lab/core/fonts.mjs` | `withRenderWeights()`が**Weeklyの書体指定も見る**ように。フォールバックスタックの**すべての書体**に、測る太さと描く太さの両方を要求する。和文の適用確認をZen Kaku→`TYPE.titleJP`基準へ |
| `tools/generator-lab/jp-font-check.html` | 新規。数値の照合と、実物と候補を並べた見た目の比較 |

`fonts.mjs`の修正がないと`renderWeight: 350`のNoto Sans JPが読み込まれず、ブラウザが近い面で
代用したまま静かに違う太さで描かれる（Weeklyの指定はもともと`withRenderWeights()`の対象外だった）。

### 維持した機能契約

- `renderWeight`は**描く太さだけ**を変える。字送り・折り返し・はみ出し判定は`weight`の測定のままで変わらない。
- 版面の座標、サイズ、字間、textCaseはいずれも変更していない。

### 検証

- `jp-font-check.html`で、Other Releasesの4行が補正前**+19.7〜+21.6%**→`renderWeight: 350`適用後**+4.5〜+8.0%**。
- 同じページで、Weeklyの作品面（`2026_W-5.png`）とJapanの採用枠（`Japan_2026_1-2.png`）の
  作品名・アーティストが**4か所すべて±4.3%以内**に収まることを確認。
- `checks.html`（`Fonts.loadAll()`を通る）が「比較できます」まで到達することを確認。
- `node --test tools/generator-lab/test/*.mjs`（59件）、`npx tsc --noEmit`、`npm run lint`、`npm run build`：すべて成功。

### 未確認・Koheiへの確認事項

- ウェイトは**作品名400／アーティスト300でKoheiが確定**（2026-09-09）。Monthlyの和文サンプルも受領し、
  Weekly・Japanの両方で裏付けが取れた（当初は「300か400か」を残していたが解消）。
- 実アプリでの和文の目視は未実施（共有文書が要る）。数値と見た目の比較は`jp-font-check.html`で確認済み。
- Monthly／Japanの**掲載枠**の和文（`Japan_2026_2-2.png`の`°pbdb, 梅井美咲, 北村蕗`）はまだ測っていない。
  採用枠と同じ`TYPE.artistJP`を使うので同じ結果になるはずだが、サイズが違うので気になれば別途。

## 22. 2026-09-09：対象月の波が無いときは書き出しを止める

レビューで挙げた指摘（未登録月の波でも黙ってPNGが出る）をKoheiの了承のうえ修正した。

### なぜ直したか

`BUNDLED_WAVES`は2026年の12か月だけで、2027年ぶんはまだ無い。この状態で2027年1月の文書を作ると、
`waveForMonth()`が直近の2026年12月の波を返して描く。**作品名もジャケットも正しく、背景の波だけが違う**ので、
出来上がりを見ても破綻していない。知らせていたのは共通設定タブの1行だけで、サムネイルのバッジにも
書き出しのゲートにも出ていなかった。この企画では作品名のはみ出し・行数超過・未保存はいずれも
「PNGを作らせない」で揃っているのに、ここだけ例外だった。毎年12月末が実質の期限になる構造でもある。

### 変更したファイル

| ファイル | 変更 |
| --- | --- |
| `app/generator/wave-month.ts` | 新規。`pickWaveMonth()`／`waveMonthWarning()`／`waveMonthLabel()`。**画像を持たない純粋なロジック**にして自動テストできるようにした |
| `app/generator/runtime.tsx` | `waveForMonth()`を`wave-month.ts`の薄い包みへ。`runtime.wave`に「本来使うべき月」を追加し、`waveWarnings()`を公開 |
| `app/generator/GeneratorPreview.tsx` | 警告一覧の先頭へ追加。既存の`blocked = !canExport || warnings.length > 0`にそのまま乗るので、**単枚PNGも止まる** |
| `app/generator/BulkExportButton.tsx` | 書き出しボタンの`reason`に追加。押せなくなり、理由がそのままtitleに出る |
| `lib/generator/__tests__/wave-month.test.ts` | 新規8件。対象月あり／未登録は直近の月／登録済みより前ならいちばん古い月／一覧が空／並び順が崩れた一覧／警告文の中身 |

警告文は「2027年1月の波がまだ登録されていません（いまは2026年12月の波で描いています）。
その月の原版を受け取って登録するまで書き出せません。」

### 維持した機能契約

- `theme.waveAssetId`（アップロードによる差し替え）があるときは警告を出さない。人が明示的に選んだ画像なので対象外。
- 既存のゲート（未保存・描画準備・ページ0件・描画警告）はそのまま。順序も変えていない。
- 波を出さない設定（`useWave: false`）のときも対象外。

### 検証

- `npm test`：**20ファイル・328件成功**（wave-month の8件を追加）。`npx tsc --noEmit`、`npm run lint`、`npm run build`すべて成功。
- 実画面での確認は未実施（共有文書が要る）。境界の挙動は単体テストで固定してある。

## 23. 2026-09-09：レビューで残っていた3件を修正

いずれも「黙って違う絵が出る」類だったため、Koheiの了承のうえ3件とも直した。

| 直したもの | 何が起きていたか | どう直したか |
| --- | --- | --- |
| `render.mjs` の`waveAlphaOf()` | 画像全体を1×1へ縮めてαの平均を取っていたため、**一部だけ透明な波**（周囲を抜いた素材など）でも平均が下がり、その分だけ不透明度を上げてしまう＝全体が仕様より濃く出る | 8×8で見て、**全画素が同じαのときだけ**焼き込みαとして補正する。均一でなければ素材の透明をそのまま活かす意図とみなし、0.5をそのまま掛ける |
| `render.mjs` の`drawBackground()` | `globalCompositeOperation`は未対応の値を代入しても例外にならず黙って通常合成へ落ちる。エラーも警告も出ないまま、彩度の薄い旧来の見た目でPNGが出る | 代入後に読み返して、違っていたら日本語のエラーで止める |
| `make-wave.mjs` | アルファを読まずRGBだけをグレー化していたため、**透明部分を持つ原版**は透明だった場所が輝度0の黒い面になる。警告も出ない | αの最小・最大を見て、**場所によって違えば変換を中止**して書き出し直しを促す。全画素同じα（旧方式の焼き込み）なら、これまでどおり落として続行し、その旨を出す |

### 検証

- `background-check.html`：実物との一致（0.66〜0.71階調）、αの吸収（旧方式を模した素材で0.25階調）、
  グレースケール変換の前後（0.181階調）のいずれも修正前と同じ結果。合成モードの検査でも止まらない。
- `make-wave.mjs`を実データで再実行し、これまでどおり変換できることを確認。
- `npm test` 20ファイル・328件、`npx tsc --noEmit`、`npm run lint`、`npm run build`：すべて成功。

