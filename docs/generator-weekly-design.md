# Weekly（NEW RELEASE WEEK）ジェネレーターの設計

作成日：2026-09-08（Claude Code）／状態：**Weeklyの機能契約、土曜〜金曜のWEEK列取り込み、`#`週番号、表紙・作品面・Other Releasesの描画、統合UI、swap選定、7枚ZIP命名まで実装済み。実Release MasterのW35／W36を確認し、実共有W36文書でswap保存・構成復元・作品保存・作品復元・全7枚ZIPまで完了した。iPhone 17 Pro Simulatorの縦表示と横向き相当のタッチ条件も確認済み。物理iPhone実機だけ未確認。**
実装担当：Codex（機能契約・API・DB・データ整合性）→ そのあとClaude Code（UI・情報設計・描画の見た目）

Monthly／Japanの画像ジェネレーターへ、毎週金曜の新譜紹介「**NEW RELEASE WEEK**」を追加するための設計。
利用者（Kohei）の2026-09-08の決定を前提にしている。決定は次の3点。

1. **データ源**：Release Masterの日付で対象週を絞り、既存の`WEEK`列で**採用＝メイン、掲載＝Other Releases**へ振り分ける。不採用・空欄は取り込まない。画面上のswapは取り込み後の微調整に使う。
2. **枚数**：**表紙を含めて7枚**すべてをツールで作る（Monthly／Japanは表紙を作っていないが、Weeklyは作る）。
3. **担当**：本書で設計を固定し、機能契約（`lib/generator/model.ts`・取り込みAPI）の実装はCodexが行う。

---

## 1. 企画の実体

出典：`漂流音楽/docs/02_コンテンツ企画.md`、`漂流音楽/docs/10_投稿デザインルール.md` §6（🔵実測）、`漂流音楽/docs/11_シリーズ総覧.md`。

- 毎週金曜のInstagramカルーセル。**最も更新頻度が高いシリーズ**で、現役。
- canvas **1200×1200（1:1）**、**7枚**構成。

| 枚 | Figmaのフレーム | 中身 |
| --- | --- | --- |
| 1 | `2026_W-0` | 表紙。`NEW RELEASE` ／ `2026 WEEK 35` の2行＋ジャケ5枚の帯コラージュ＋毛筆ロゴ |
| 2–6 | `2026_W-1`〜`_5` | その週の新譜5枚。1枚1作品 |
| 7 | `2026_W-6` | `Other Releases`。その他20〜30件を文字リストで |

- 選定はRelease Masterの`WEEK`列で人手確定する。運用上の目安は**洋楽4枚＋邦楽1枚**だが、アプリでは強制しない。Other Releasesは約20件（邦楽EPも対象）。
- Other Releasesの並びは**洋楽→邦楽**、EPは `[EP]` プレフィックスを**残す**（Monthly／Japanは作品名から `[EP]` を外すので、ここが逆になる）。
- **評価文（本文）とRECOMMEND帯はWeeklyには無い。** 作品面に載るのは 作品名／アーティスト名／メタ（曲数・総尺・ジャンル・国）だけ。

旧フロー（AOTYスクレイパー→Release Masterへ手貼り→Figmaで制作）は`漂流音楽/docs/04_ツールと自動化.md`。
スクレイパーは403で停止中だが、**企画は毎週動いている**。本設計はスクレイパーに依存しない。

---

## 2. 期間と週番号

- `period.type: "week"`、`start` ＝ **対象週の金曜**、`end` ＝ その7日後（翌金曜）。これは文書の識別と表示に使う。
- Release Masterの抽出範囲は、投稿金曜日までの**土曜〜金曜**（土曜以上、翌土曜未満）。New Music Fridayの運用に合わせ、金曜19時の投稿で直前土曜から当日金曜までの新譜を扱う。
- 表紙の週番号はRelease Masterの**`#`列（H列）**を正本とする。期間内の`WEEK=採用`／`掲載`行にある`#`が空欄・1〜53以外・複数番号の混在なら、黙って除外せず取り込みエラーにする。ISO計算値との一致は要件にしない。

  | 金曜 | Release Master `#` | 実物 |
  | --- | --- | --- |
  | 2026-04-24 | 17 | `weekly_2026_week17.tsv` |
  | 2026-08-28 | 35 | docs/10 §6 の `2026 WEEK 35` |

- 表紙の年は対象金曜のISO週年を使う。週番号そのものは`#`列を文書の`period.weekNumber`へ保存し、表紙・見出し・PNG／ZIP名で共用する。
- 取り込みAPIの引数は **`week=YYYY-MM-DD`（金曜日付）**とする。`月+週番号`にしないのは、年跨ぎ週の解釈をサーバとUIの2箇所に持たせないため。金曜以外の日付は400で弾く。

---

## 3. データ源と取り込み

`app/api/generator/source/route.ts` はWeekly向けに次の形を受理する。

- `GET /api/generator/source?series=weekly&week=YYYY-MM-DD`
- Release Master（`'Release Master'!A1:AZ`）の読み取りと正規化は**現行と同じコードを共用**する。
- 抽出条件：`日付`が「対象金曜の6日前の土曜以上、翌土曜未満」の行。`M/J採用`列は見ず、`WEEK=採用`をfeature、`WEEK=掲載`をothersへ振り分ける。`不採用`・空欄は除外する。対象になった行の`#`は全件同一であることを検証して文書へ保存する。
- 重複除去：`title+artist` の小文字化キー。Monthlyの`selectReleaseMasterAlbums`と同じ規則。
- カバー画像：`画像リンク変換`（Apple Music 2000px）優先 → `spotifyカバー`（640px）フォールバック。Monthlyと同じ。
- 取り込む項目：`Time`（曲数・総尺）、`genre/memo`、`国`、`洋邦`、`UID`、`No.`、`日付`。
  `M Number`／`Track`／`M/J採用（220−300）`は取り込むが**Weeklyでは表示しない**（§4参照）。
- 空の`Time`を最新Release Masterから下書き補完する既存の挙動は、Weeklyでもそのまま効かせる（共有DBは自動更新しない）。
- 0件なら404、200件超は400。Monthlyと同じ。

### 初期の振り分け

1. 対象週の行を`WEEK`列でfeature／othersへ分ける。
2. 各グループを洋邦・日付・アーティスト名の既存規則（`sortAlbums`）で並べる。EPは末尾へ送るが、**作品名から`[EP]`は外さない**。
3. 作品名＋アーティストの正規化キーで重複を除く。
4. featureは最大5件、othersは最大60件。上限超過は曖昧に切り捨てず、入力エラーとして止める。

取り込み後に選定を変える場合は、featureとothersの件数を維持するswapとして行う。

---

## 4. スキーマ拡張案（`lib/generator/model.ts`）

### 変更が要るもの

| 箇所 | 現行 | 変更案 |
| --- | --- | --- |
| `rendererVersion` | weeklyは`null`必須 | weeklyは **`"weekly-v1"`** 必須。`"monthly-japan-v1"`は従来どおり |
| `GeneratorPage["kind"]` | `"adopted" \| "listed"` | **`"cover" \| "feature" \| "others"` を追加** |
| kindとseriesの対応 | 制約なし | monthly／japanは`adopted`／`listed`のみ、weeklyは`cover`／`feature`／`others`のみ。**混在は不正** |
| ページの並び | 「`listed`の後に`adopted`は来ない」 | weeklyは **`cover` → `feature`×N（N≤5） → `others`** の固定順。それ以外は不正 |
| `itemIds`の件数 | 1件以上、`adopted`は1・`listed`は2 | `cover`は**0件**、`feature`は1件、`others`は**0〜60件**。`adopted`／`listed`は現行のまま |
| ページ枚数 | 上限200 | 変更なし。weeklyは`1 + N + 1`（最大7）に固定 |

`cover`が0件なのは、表紙のコラージュに使う5枚を`feature`ページの5件から導出するため。
表紙にも同じitemIdを並べる案は、`placed`（同一itemの二重配置禁止）に抵触するうえ、選定変更のたびに2箇所を直す必要が出るので採らない。

### 変更が要らないもの（重要）

- **`ItemContent`の形は変えない。** Weeklyで使わない評価文・おすすめ曲は、
  `fields.text` ＝ 空文字、`fields.trackNo`／`fields.track` ＝ 取り込み値のまま、`show.track` ＝ `false` で作る。
  `bodyLeadMode`／`bodyMaxLead`／`tracking`／`kerns`／`typography`は既存の検証範囲のまま通る。
  作品名の初期字間もそのまま入る（当初は −2%＝`tracking: -0.02`。2026-09-11に利用者の指示で **0** へ変更）。
  → Monthly側の保存・復元・ローカル復旧の契約に一切触らずに済む。
- **`GeneratorTheme`も変えない。** Weeklyも`useWave: true`で作る（2026-09-08のFigma実測で、Weeklyの各面にも`Backwave`が敷かれていることを確認した）。表紙の背景写真は既存の`backgroundAssetId`（非公開Storage）をそのまま使う。
- **DBのマイグレーションは不要。**
  - `series`の`check`は既に`('monthly','japan','weekly')`を許容している。
  - `unique (series, period_start, period_end)` が「同じ週を二重に作らない」をそのまま担保する。
  - ページ種別を検証しているSQLは無い（`generator_save`は`kind in ('item','page','theme')`＝**ロックの対象種別**であり、ページ種別とは別物）。

---

## 5. 共有保存・ロックへの影響（設計上の要点）

### 5.1 「5枚の選定」は**移動ではなく入れ替え**として実装する

`supabase/migrations/202609050001_generator_completion.sql` の `generator_structure_save` は、
提案されたページ配列に対して**各ページの`itemIds`の件数が現在と一致すること**を要求する。

```
or jsonb_array_length(proposed->'itemIds') <> (select jsonb_array_length(current->'itemIds') ...)
```

したがって「`others`（30件）から`feature`（1件）へ1件**移す**」操作は、既存の構成保存APIでは**必ず`INVALID_INPUT`になる**。

これを新しいマイグレーションで緩めるのではなく、**操作そのものを「入れ替え（swap）」に定義する**ことで解決する。

- `feature`ページの1件と`others`ページの1件を**交換**する → `feature`は1件、`others`はN件のまま。件数が動かない。
- `feature`同士の並べ替え（1件↔1件）も件数が動かない。
- `others`内の並べ替えも同一ページ内なので動かない。

**結果として、新規マイグレーションなしで選定・並べ替えが成立する。** 既存の構成ロック（`structure`）・`expectedVersion`・履歴・復元の契約も無改造で使える。
Codex側は`generator_structure_save`を触らないでほしい。触ると、Monthly側の同数不変条件まで緩むことになる。

### 5.2 そのほか

- ロックの対象種別（`item`／`page`／`theme`／`structure`）はWeeklyでも同じ。`cover`ページも1ページとして`page`ロック（背景色）を持つ。
- 保存単位・`requestId`・`clientId`・`token`・`generation`・30秒heartbeat・ローカル復旧キー（`ryuryu_generator_recovery:v1:<actor>:<documentId>`、`schemaVersion: 1`、600msデバウンス）は**すべて現行のまま**。
- ローカル復旧の拒否条件は「作品ID・ページID・ページ種別が一致しない場合は部分適用せず拒否」。ページ種別が3種に増えても判定式は変わらない。

---

## 6. 版面（`weekly-v1`）

canvas 1200×1200、書き出し1200／2400px、`EXPORT_SUPER_SAMPLE = 4` はMonthlyと共通。
**Monthlyの`Layout.CELLS`（外周50px・罫6px・パネル黒60%）は流用できない。** Weeklyは別の版面論理を持つ。

### 6.1 作品面（`feature`）🔵2026-09-08にFigmaで実測

出典：Figma `Post-images`（`fPJXS1TvmBhHCX9E2zme4i`）の`Weekly`ページ、`2026_W-1`（`9971:637`）。座標は1200基準の絶対値。

| 要素 | 値 |
| --- | --- |
| 背景 | `Color_N`（ページ色）1200×1200 の上に、`Backwave` 1200×1200 を**Luminosity・不透明度50%**（§6.5） |
| 内枠 `Frame 5` | (200, 50) 800×1100 |
| ジャケット `Frame 21` | **(200, 50) 800×800** |
| `title/artist` | (200, 850) 800×300、padding 24px |
| `Album` | (224, 880) **752×240**、縦中央、**gap 44px** |
| 作品名 `#sc_title` | y **904**（cap基準の枠。高さ44）、中央揃え、Oswald **Regular 54px**、**字間 −1.08px（＝−2%）**、**行送り72px**、1行（`whitespace-nowrap`）、影 `10px 10px 40px rgba(0,0,0,.3)` |
| 作品名↔アーティスト | **gap 32px** |
| アーティスト `#sc_artist` | y **980**（高さ40）、中央揃え、Oswald **ExtraLight 42px**、**行送り48px**、字間0 |
| メタ帯 `info` | y **1064**（高さ32）、中央揃え、Oswald **Light 32px**、**`UPPER`**、**要素間 gap 16px**、影 `0 0 40px rgba(0,0,0,.3)` |
| 区切り記号 | **`・`（中黒）**。`•` ではない |
| 曲数・総尺の組版 | `font-feature-settings: "pkna" 1, "palt" 1`（プロポーショナル字形） |
| 罫・パネル塗り | **🔴訂正（2026-09-08）：ある。** 下記参照 |

実例：`I Know Too Much` ／ `Ellie Goulding` ／ `10SONGS, 34MIN 56SEC ・ ALT-POP ・ UK`。

**判明した差分（設計の前提が変わった箇所）**

- **Weeklyも`Backwave`を敷いている。** 当初「Weeklyは波を使わない（`useWave: false`）」と書いていたが誤り。
  取り込み時は**Monthlyと同じく`useWave: true`**で作る。`GeneratorTheme`が無改造で足りる点は変わらない。
- **区切り記号はMonthlyと同じ`・`。** 「Weeklyは`•`かもしれない」という未確定事項は解消。
- **作品名の字間は−2%がテンプレートの値。** docs/10 §6の「回によって−2%と0で揺れている」は、実投稿側の揺れ。
- 作品名は1行前提（`whitespace-nowrap`）。**折り返しはせず、字間を自動で詰める（Koheiの決定、2026-09-08）。**
  下限は`model.ts`のtracking検証範囲と同じ−20%。それでも収まらなければ出力不可（§6.4のはみ出し検出方針のまま）。
- **🔴罫・パネル塗りは「無い」ではなく「ある」。** Figmaのノード検査（`get_design_context`）ではこの2点を
  見落としていた（おそらく親フレームの効果を辿れていなかった）。Koheiから実物投稿7枚
  （2026 WEEK 36、`tools/generator-lab/reference/2026#36/`）を受領し、画素単位で実測して判明した。

#### 🔴2026-09-08訂正：罫とパネルの実測（実装済み・pixel検証済み）

実物5投稿（`2026_W-1`〜`_5`）を`tools/generator-lab/reference/2026#36/`で実測。**Monthlyとまったく同じ規則**
（各セルの外側6px白罫、黒系60%パネル）が使われていた。パネルの色相は投稿ごとに違う
（背景色に応じて変わる＝Monthlyと同じ「黒を乗算」方式と判断。個別の係数の再検証はしていない）。

| 要素 | 実測値（1200基準） |
| --- | --- |
| ジャケット | (200,50) 800×800（訂正なし） |
| パネル（タイトル・アーティスト・メタをまとめて1枚） | (200,850) 800×300。**罫はこの外側6px**（Monthlyと同じ`strokeRect`の描き方） |
| 罫の実測位置 | x194–200／x1000–1006（左右、全高）、y44–50（ジャケット上）、y850–856（ジャケット/パネル境界）、y1150–1156（パネル下） |
| 作品名ベースライン | **948.5**（5投稿全てで一致。ディセンダ無しの実例のみで検算） |
| アーティスト名ベースライン | **1017.5**（ディセンダ無しの3投稿で一致。Goulding／Tempalayはg/pの下がりで別途確認） |
| メタ帯ベースライン | **1096**（5投稿中3投稿で一致。設計時の予測(1064+32)と一致） |
| メタ帯の要素間ギャップ | **16px**（既存の`bandLayout(cell, typography, gap)`にそのまま渡して実物と1px以内で一致することを確認） |
| 内枠幅（作品名・アーティストの折り返し／字間詰めの基準） | 752px（Album 752×240の実測どおり、パネル800幅から左右24pxずつ） |

実装は`tools/generator-lab/core/layout.mjs`の`Layout.WEEKLY`、`render.mjs`の`Render.drawWeeklyFeature()`・`fitWeeklyTitle()`。
テストは`tools/generator-lab/test/weekly-check.mjs`。実物画像との重ね合わせ検証は
「作業ログ」（`docs/generator-ui-implementation.md`）に記録した。

🔵 **和文の書体は2026-09-09に確定：`Noto Sans JP`（作品名400／アーティスト300）。**
Koheiから和文を含む実物投稿を受領し、`jp-font-check.html`で画素照合した。
**幅はどの候補も±1px以内で一致する**ので、違うのは太さと字形だけ。インクの量（実物比）は次のとおり。

| 候補 | Weekly 作品名<br>「行方不明」 | Weekly アーティスト<br>「川辺素」 | Japan 作品名<br>「死んでも一生」 | Japan アーティスト<br>「野口文」 |
| --- | --- | --- | --- | --- |
| **Noto Sans JP 400** | **+0.4%** | +48.1% | **−4.3%** | — |
| **Noto Sans JP 300** | −32.9% | **−0.8%** | — | **+1.0%** |
| Zen Kaku Gothic New 700（旧・作品名） | +48.1% | +120.8% | −32.9% | — |
| Zen Kaku Gothic New 300（旧・アーティスト） | −51.1% | −25.4% | — | — |
| YuGothic 400（Figmaの旧フォールバック） | −20.1% | +17.9% | −37.6% | +16.0% |
| Hiragino Sans 400 | +2.6% | +56.6% | −1.9% | +24.8% |

**採用した400／300は、WeeklyとJapanの4か所すべてで±4.3%以内に収まる。** 旧指定（Zen Kaku 700／300）は
作品名が+48%、アーティストが−25%と両方向に大きく外れていた。

**この規則はMonthly・Japan・Weeklyの3企画すべてに適用する**（Koheiの決定、2026-09-09）。
Monthly／Japanは`Layout.TYPE.titleJP/artistJP`、Weeklyは`Layout.WEEKLY.TYPE.titleJP/artistJP`にあり、
どちらも同じ値にしてある。

出典：`reference/weekly和文サンプル/2026_W-5.png`（Weekly作品面）、
`reference/Monthly 和文サンプル/Japan_2026_1-2.png`（Japan採用枠）。どちらもGit管理外。

**測り方の注意（実装者向け）**：インクの量は「地に対する明るさの合計」で数えるが、
**地の明るさは切り出しごとに、しかも文字のまわりだけに絞って推定すること**。
パネルの下の写真は場所によって明るさが違うので、広い範囲で1つの値を使うと地そのものをインクとして
数えてしまい、実物の値が2倍近くに膨らむ（実際に一度そうなった）。候補側も本番と同じ4倍描画→縮小を通し、
比較するウェイトはすべて明示的に読み込む（読み込まないとブラウザが近い面や合成ボールドで代用する）。

#### 🔴2026-09-08訂正：罫とパネルの実測（実装済み・pixel検証済み）

実物5投稿（`2026_W-1`〜`_5`）を`tools/generator-lab/reference/2026#36/`で実測。**Monthlyとまったく同じ規則**
（各セルの外側6px白罫、黒系60%パネル）が使われていた。パネルの色相は投稿ごとに違う
（背景色に応じて変わる＝Monthlyと同じ「黒を乗算」方式と判断。個別の係数の再検証はしていない）。

| 要素 | 実測値（1200基準） |
| --- | --- |
| ジャケット | (200,50) 800×800（訂正なし） |
| パネル（タイトル・アーティスト・メタをまとめて1枚） | (200,850) 800×300。**罫はこの外側6px**（Monthlyと同じ`strokeRect`の描き方） |
| 罫の実測位置 | x194–200／x1000–1006（左右、全高）、y44–50（ジャケット上）、y850–856（ジャケット/パネル境界）、y1150–1156（パネル下） |
| 作品名ベースライン | **948.5**（5投稿全てで一致。ディセンダ無しの実例のみで検算） |
| アーティスト名ベースライン | **1017.5**（ディセンダ無しの3投稿で一致。Goulding／Tempalayはg/pの下がりで別途確認） |
| メタ帯ベースライン | **1096**（5投稿中3投稿で一致。設計時の予測(1064+32)と一致） |
| メタ帯の要素間ギャップ | **16px**（既存の`bandLayout(cell, typography, gap)`にそのまま渡して実物と1px以内で一致することを確認） |
| 内枠幅（作品名・アーティストの折り返し／字間詰めの基準） | 752px（Album 752×240の実測どおり、パネル800幅から左右24pxずつ） |

実装は`tools/generator-lab/core/layout.mjs`の`Layout.WEEKLY`、`render.mjs`の`Render.drawWeeklyFeature()`・`fitWeeklyTitle()`。
テストは`tools/generator-lab/test/weekly-check.mjs`。実物画像との重ね合わせ検証は
「作業ログ」（`docs/generator-ui-implementation.md`）に記録した。

🔵 **和文の書体は2026-09-09に確定：`Noto Sans JP`（作品名400／アーティスト300）。**
Koheiから和文タイトルを含む実物投稿（`reference/weekly和文サンプル/2026_W-5.png`、「行方不明」／「川辺素」）を受領し、
`jp-font-check.html`で画素照合した。**幅はどの候補も±1px以内で一致する**ので、違うのは太さと字形だけ。
インクの量（実物比）は次のとおりで、それまでの暫定値（Zen Kaku 700／300）は両方向に大きく外れていた。

| 候補 | 作品名「行方不明」 | アーティスト「川辺素」 |
| --- | --- | --- |
| **Noto Sans JP 400** | **+2.1%** | +29.9% |
| **Noto Sans JP 300** | −31.8% | **−13.0%** |
| Zen Kaku Gothic New 700（旧・作品名） | +50.6% | +93.7% |
| Zen Kaku Gothic New 300（旧・アーティスト） | −50.3% | −34.6% |
| YuGothic 400（Figmaの旧フォールバック） | −18.7% | +3.4% |
| Hiragino Sans 400 | +4.4% | +37.4% |

同条件の欧文で**+20%の系統差**が出る（後述）ので、それを割り引いて読む必要がある。それでも
Zen Kaku 700は明らかに太すぎ、300は細すぎだった。**この規則はMonthly・Japan・Weeklyの3企画すべてに適用する**（Koheiの決定、2026-09-09）。
Monthly／Japanは`Layout.TYPE.titleJP/artistJP`、Weeklyは`Layout.WEEKLY.TYPE.titleJP/artistJP`にあり、
どちらも同じ値にしてある。アーティストは、実物との一致だけを見れば400のほうが近い（300は−13.0%、400は+29.9%）が、
「Oswald ExtraLightの軽さに合わせる」意図を優先して**300で確定**した（`jp-font-check.html`で見比べたうえでの判断）。

**字間−2%をどこに持たせるか（実装上の罠）**

`tools/generator-lab/core/text-layout.mjs` の `linesOf()` は

```js
const spec = { ...base, tracking: style.tracking || 0, kerns: style.kerns || {} };
```

としており、**`Layout.TYPE.*.tracking`（版面側の既定値）は必ず利用者側の値か0で上書きされる**。
Monthlyは版面側も0なので差が出ていないだけで、この定数は実質死んでいる。

したがってWeeklyの作品名の−2%を`layout.mjs`のTYPEに書いても**描画に反映されない**。次のどちらかを採る。

- **(a) 取り込み時のデータに入れる（推奨）。** weeklyのitemを
  `typography.title = { tracking: <初期字間>, kerns: {}, leading: 72/54 }` で作る。
  `model.ts`の検証（tracking ±0.2、leading 1〜3）を通り、UIにもその値が出て編集できる。**取り込み側（Codex）の1行。**
  初期字間は2026-09-08時点で`-0.02`、2026-09-11に利用者の指示で`0`にした。
- (b) `linesOf()` を `style.tracking ?? base.tracking` へ直す。筋は通るが、`app/generator/hit-test.ts` が
  同じ計算を写し持っているため両方を同時に直す必要があり、Monthlyの描画経路にも触ることになる。

行送りは `style.leading ?? defaultLeading(key)` とフォールバックが効くので、**版面側の定数で持てる**（`TEXT.titleLead = 72`）。
上書きされるのは`tracking`だけ。

### 6.2 表紙（`cover`）🔵2026-09-08、実物投稿7枚（2026 WEEK 36）を画素単位で実測して確定

出典：Koheiから受領した実物投稿（`tools/generator-lab/reference/2026#36/2026_W-0.png`、2400×2400）。
FigmaのノードデータではなくPNGを直接実測した（理由は§6.1と同じ。以下、Figmaの`(408,499)`等の座標は実測と食い違ったため使っていない）。

| 要素 | 値 | 状態 |
| --- | --- | --- |
| 帯（縦5本） | **各240×1200**、x=0/240/480/720/960。左から **`4` `2` `1` `3` `5`** 位（1位が中央） | 🔵実測 |
| オーバーレイ | 帯の上に**単色・半透明**が乗る。**`#0040C7` の不透明度60%**（＝`rgba(0,64,199,0.6)`。通常の重ね方で、乗算ではない） | 🔵2026-09-09確定。Koheiが示したFigmaの原本値を実物投稿の画素回帰でも裏付け |
| 毛筆ロゴ | 既存アセット（`hyoryu_logo_brush_1line_white.svg`）を **(450,1023) 300×176.66** に描画。**オーバーレイの影響を受けず白のまま**（インク実測 y1066.5–1164, x473.5–717.5で確認） | 🔵実測 |
| 週タイトル1行目「NEW RELEASE」 | ベースライン**581**、インク幅477.5、**中央揃え（cx≈600）** | 🔵実測 |
| 週タイトル2行目「{年} WEEK {週番号}」 | ベースライン**699**、インク幅508.5、中央揃え | 🔵実測 |
| 行送り | **118**（＝フォントサイズと同じ。字間は行送りに影響しない） | 🔵実測 |
| 書体 | **Alternate Gothic No2 D Regular、118px、字間+1%** | 🔵実測で確定。docs/10 §6の予測（118・+1%）とほぼ一致 |

**🔴訂正：週タイトルは左寄せではなく中央揃え。** Figmaの`(408,499)383×217`という左寄せの箱座標は、
1行目「NEW RELEASE」と2行目「2026 WEEK 36」のインク中心がどちらもx≈600（キャンバス中央）に一致したため、
実測と食い違うと判断して不採用にした（§6.1のパネル・罫と同じ「Figmaノード検査は親の効果や実際の配置を
反映しないことがある」というパターン）。

**帯の並び順**は設計時の想定どおり確定：`feature`ページの並び（1〜5位）から
`RANK_TO_BAND = [2,1,3,0,4]`（何位を何番目の帯に描くか）で導く。`Layout.WEEKLY.COVER`に実装済み。

ロゴの下端0は実測でも裏付けられた（インク下端1164は帯下端1200から36px内側で、これはロゴアセット自体の
内部余白によるもの。アセットの配置枠(450,1023,300×176.66)は変更していない）。

書体ファイルはKoheiが過去にフォントバンドルで入手したもの（権利者表記: URW Software, Copyright 1994 by URW。
使用許可を得て`tools/generator-lab/assets/alternate-gothic-no2-d-regular.ttf`に配置。Google Fontsに無いため
`fonts.mjs`にセルフホスト読み込みを追加した。**Monthly／Japanはこの書体を使わないため、読み込みに失敗しても
影響しない設計**（`loadAll()`は例外を投げず、表紙を描く直前に`coverFontReady()`で個別確認する）。

**2026-09-09にオーバーレイ色を確定した。** KoheiからFigmaの原本値 `#0040C7`・不透明度60% を受け取り、
実物投稿でも独立に裏付けた（当初の逆算 `rgb(0,63,198)` は各成分1ずれていた）。

裏付けの方法：表紙の帯は各ジャケットを240×1200へcover-fitしたものだが、**同じジャケットが作品面
（`2026_W-1`〜`W-5`）のセル(200,50)800×800に無加工のまま写っている**。そこで帯の画素と作品面の画素で
`dst = (1-a)·src + a·C` を立て、最小二乗で `a` と `C` を解いた（週タイトル2行と毛筆ロゴはオーバーレイの
上に描かれるので除外し、再標本化のずれを避けるため原寸側が平坦な画素だけを使った）。

結果は**5本中4本が α=0.599〜0.602、C=(0, 63.5〜64.1, 198.6〜199.2)** で `#0040C7`@60% と一致し、
285,461画素／チャンネルでの平均残差は**1.2階調**だった。残る1本（帯index1＝2位の作品）は縦位置と倍率が
完全一致（v0=0.000、倍率1.000）のまま**横の切り出しだけが中央40%ではなく18.4%**で、実物投稿が手作業で
作られたことによるトリミング差と判断した。オーバーレイの値そのものとは無関係。

再検算は `node tools/generator-lab/measure/overlay-of.mjs [参照フォルダ]` で再現できる（引数を省くと
`tools/generator-lab/reference/2026#36` を見る）。実装値は `Layout.WEEKLY.COVER.OVERLAY`、
回帰テストは `tools/generator-lab/test/weekly-check.mjs`。

### 6.3 Other Releases（`others`）🔵2026-09-08、実物投稿（30行）を画素単位で実測して確定

出典：`tools/generator-lab/reference/2026#36/2026_W-6.png`（実データ30行）。

| 要素 | 値 | 状態 |
| --- | --- | --- |
| 内枠 | (200,50) 800×1100。罫・パネルは作品面（§6.1）とまったく同じ規則（外側6px白罫、黒系60%パネル） | 🔵実測 |
| 角丸 | 実測では確認できず（コーナーを拡大しても直角）。半径0として実装 | 🔵実測 |
| 見出し「Other Releases」 | Oswald Regular **71px**、中央揃え、ベースライン**169.5**（インク幅385で実測、docs/10予測72に近い） | 🔵実測 |
| 本文の書式 | `"作品名 / アーティスト名"`の1行（区切りは半角スラッシュ）。`[EP]`は保持（Monthlyと逆） | 🔵実測 |
| 本文フォント | Oswald Regular **29px**（実測。ink幅320.1が実物320.5とほぼ完全一致） | 🔵実測 |
| 行送りの自動調整域 | ボックス(240,222) 720×**870**。ASCENT26.5・DESCENT2.5を引いた841pxを行数−1で均等割り | 🔵実測（30行で行送り29.0、Monthlyの本文と同じ考え方） |

**🔴訂正：行送りはKoheiの指示（2026-09-08）で件数に応じて自動的に詰める／広げる。**
固定の29px前後という当初の想定ではなく、`Layout.WEEKLY.OTHERS.layoutFor(n)`（Monthlyの本文
`bodyLayoutFor`と同型）が、天地の使える範囲841pxを`n-1`で割って行送りを決める。実測30行はちょうど
`841/29=29.0`＝フォントサイズと同じ値になり、これが実質的な最大行数（31行以上は行が重なるため出力不可、
`Layout.WEEKLY.OTHERS.fits(n)`で判定）。件数が少ない週は行送りが広がる。

邦楽が必ず混じるので和文が組める必要がある。Monthlyのメタ帯と同じ `'Oswald", "Noto Sans JP'` のスタックで
実際に解けることを確認済み（実物の「石若駿」「サバシスター」を含む30行で描画・照合した）。

**太さの補正（2026-09-09）**：Koheiから「アーティスト・アルバム名が太く感じる」との指摘を受けて実測した。
実物（30行）と突き合わせると**幅は±0.5pxで一致**する一方、インクの量は**欧文だけの行でも+21.6%**、
和文まじりの行でも同程度（+19.7〜+20.1%）に濃かった。つまり和文だけの問題ではなく、SPEC §9.5の
「ChromeのfillTextはFigmaよりインクが濃く出る」がこの小さい文字で効いている。
本文（`TYPE.body`）と同じ手当てとして`renderWeight: 350`を入れた（**測る太さは400のまま、描く太さだけ下げる**ので
字送り・折り返しは変わらない）。4行で測った結果は、補正前が**+19.7〜+21.6%**、`renderWeight: 350`適用後が**+4.5〜+8.0%**。

🟡未検証：最終行（`[EP] 働くサバたち。 / サバシスター`のような和文混在＋`[EP]`＋句点を含む行）は、
実物よりインク幅が5%ほど広く出た（424.5→447）。29行中28行は1px以内で一致しており実用上の支障は無いが、
和文の句読点や`[EP]`の送り幅に細かい差がある可能性があるため、気になれば別途詰める。

### 6.5 背景の合成 🔵2026-09-09確定

Koheiの説明（Figmaは「地の色100%の上に、waveをブレンドモード**Luminosity**・不透明度**50%**」）を、
実物投稿と同じ月のwaveで検算して確定した。**Monthly／Japanも含めた全シリーズ共通の規則**。

```
out = 0.5 · SetLum(C, Lum(wave)) + 0.5 · C        （W3C Compositing 1 の Luminosity）
Lum(c) = 0.3·R + 0.59·G + 0.11·B
```

実装は`Layout.BACKGROUND = { waveOpacity: 0.5, waveBlend: 'luminosity' }`と`Render.drawBackground()`
（canvasの`globalCompositeOperation = 'luminosity'`）。地の色でキャンバス全面を塗った直後に重ねるので、
合成の相手は必ずその色になる。

**検算**：`tools/generator-lab/background-check.html`（`generator-lab`サーバ、8778番）。実物投稿の
背景しか写っていない帯（1200基準で x6–190）で、`Render.drawBackground()`の出力と実物を画素比較する。
実ブラウザでの結果は作品面5枚が**平均0.66〜0.71階調・最大11**、Other Releasesのみ平均1.96・最大14
（2026-09-09に受領し直した9月の原版での値。最初に受け取った原版では0.24〜0.29だったので、
再書き出しでわずかに変わったとみられる。いずれも目視できる差ではない）。

| ページ | 逆算した地の色 | ページ | 逆算した地の色 |
| --- | --- | --- | --- |
| 2026_W-1 | `#748089` | 2026_W-4 | `#89a2a1` |
| 2026_W-2 | `#7d674f` | 2026_W-5 | `#b9bda6` |
| 2026_W-3 | `#e1ebf9` | 2026_W-6 | `#923f3d` |

🟡 Other Releasesだけ残差が大きい理由は未特定。地の色を総当たりしても`#923f3d`が最適（残差1.89）で動かず、
不透明度も自由にして解き直すと0.57・`#8a3735`で残差1.58までしか下がらない（作品面は0.50・残差0.35で解ける）。
つまり**色でも不透明度でも説明できない差**がこの面だけにある。ClipColorが3.8%の画素で働く飽和した赤なので
その影響かもしれないし、実物側にもう1枚何かが乗っているのかもしれない。目視できる差ではないため保留する。

**❗ waveの素材は月替わり。** Koheiが月ごとに**未加工の原版**を渡す（**2026年1〜12月の全12か月を受領済み**）。
月が違うwaveでは背景が一致しないので、実物との突き合わせでは必ずその月の素材を使う。

受け取ってからの流れ（2026-09-09に実装）：

1. 原版を`tools/generator-lab/reference/`へ置く（**この画像はGit管理外**。1枚3〜9MBあるため）。
2. `node tools/generator-lab/make-wave.mjs tools/generator-lab/reference/wave2701.png`
   → `assets/waves/wave2701.png`（8bitグレースケール、約1/3の容量）。
   合成はLuminosityで**輝度しか使わない**ので、色を落としても出力は変わらない
   （実測：変換後とカラー原版の差は平均0.18階調・最大1）。
3. `app/generator/runtime.tsx`の`BUNDLED_WAVES`へその月を追記する。

変換後は`tools/generator-lab/assets/waves/`に12か月ぶんで約32MB（原版は約98MB）。
**旧`assets/wave.png`は2026-09-09に退役させた。** 8月の原版と比べると別加工版（平均輝度88.4／sd47.5に対し、
原版は112.8／39.6。相関0.9855で同じ絵柄だが暗く高コントラスト）で、正本は原版のほうだと判断した。
標準の波を使う場所（`app.mjs`・`checks.mjs`・`recovery-checks.mjs`）はすべて`waves/wave2608.png`を見る。

アプリは**文書の`period.start`が属する暦月**の波を自動で選ぶ。Weeklyの`period.start`は投稿金曜なので、
週が月をまたいでも金曜側の月になる。個別に差し替えたいときは従来どおり共通設定から画像を
アップロードできる（`theme.waveAssetId`が優先される）。

**対象月の波が無いときは書き出しを止める**（2026-09-09）。直近の登録済みの月で描いたうえで、
プレビューの警告欄に出し、単枚PNGも一括ZIPも作れないようにする。
**別の月の波で描いた画像は見た目が破綻しないので、言われないと気づけない**ためで、
作品名のはみ出しや行数超過と同じ「おかしい状態のままPNGを作らせない」扱いに揃えた。
選び方と警告文は`app/generator/wave-month.ts`（画像を持たない純粋なロジック、
`lib/generator/__tests__/wave-month.test.ts`で境界を固定）にあり、`runtime.tsx`が実ファイルと結び付ける。

素材には2世代ある。**どちらでも実効50%になるよう、`Render.drawBackground()`が素材のαを測って
掛ける不透明度を補正する**（`waveAlphaOf()`。1×1へ縮めてαの平均を1回だけ測り、画像ごとに覚える）。

| 世代 | α | 掛ける不透明度 | 例 |
| --- | --- | --- | --- |
| カラー原版 | 255 | 0.5 | `reference/wave26MM.png`（2026-09以降） |
| 旧方式（グレー化＋α焼き込み） | 128 | 1.0 | 2026-09-09に同梱をやめた旧`assets/wave.png`。アップロードで来る可能性は残る |

旧方式の素材はすでにグレー化されているが、**Luminosityは輝度しか使わない**ので結果は同じになる
（グレー画素は`Lum(g,g,g) = g`）。したがって8月のカラー原版を別途もらう必要はない。
実ブラウザでの確認では、両世代とも実効50%との差は平均0.27階調（`background-check.html`）。

**🟡 Monthly／Japanの見た目はこの修正で変わる。** これまでは通常合成だったため、地の色が波の側へ寄って
彩度が半分に薄まっていた。Luminosityでは地の色の彩度が保たれる。**くすんだ色ではほぼ差が無く、
鮮やかな色ほど差が大きい**（波の明度100のとき、`#475569`は`#565d67`→`#505e72`だが、
`#B21555`は`#8b3d5d`→`#be2161`）。Figmaの版面としてはLuminosityが正だが、
Monthlyの実物と見比べての最終確認はKoheiに残っている。

---

### 6.4 はみ出し検出

Monthlyと同じ方針を持ち込む。**警告が出ている間はPNGを作らない。**

- 作品名が内枠幅752pxに入らない → **折り返さず字間を自動で詰める**（下限−20%、Koheiの決定・§6.1。実装済み: `Render.fitWeeklyTitle`）。下限でも収まらなければ出力不可。
- メタ帯が幅に入らない → 区切りの間隔を自動で詰め、0pxでも足りなければ出力不可（Monthlyと同じ`bandLayout`をそのまま使用）。
- Other Releasesは**行送りを自動で詰める／広げる**（Koheiの決定・§6.3。実装済み: `Layout.WEEKLY.OTHERS.layoutFor`）。
  行送りがフォントサイズ29pxを下回る（実測の箱では31行以上）→ 出力不可（`Layout.WEEKLY.OTHERS.fits(n)`）。

---

## 7. 書き出しとファイル名

`app/generator/bulk-export.ts` の`seriesSlug`は既に`weekly`を返すが、名前が `weekly_26_08_02.png` になり、
**同じ月の4〜5週が全部同じ接頭辞になって区別できない。** 次を提案する。

| 対象 | 現行の規則で出る名前 | 提案 |
| --- | --- | --- |
| 1枚 | `weekly_26_08_02.png` | **`weekly_26_W35_00.png`** |
| ZIP | `weekly_26_08.zip` | **`weekly_26_W35.zip`** |

- 連番は**表紙を含むので`00`始まり**。`00`＝表紙、`01`〜`05`＝新譜、`06`＝Other Releases。
  Monthly／Japanは表紙を作らないので`02`始まりのまま。**Monthly側の命名は変えない。**
- 年はISO週年の下2桁。
- `lib/generator/canvas-preview.ts` の `no: pageIndex + 2` は、weeklyだけ **`pageIndex + 0`** にする必要がある。
  ここはMonthlyの「表紙は別で作るので2枚目から」という前提が数値に焼き込まれている箇所なので、series分岐を入れる。

一括ZIPの「1枚でも警告があれば全体を中止」と「文書全体に未保存があれば開始しない」は現行どおり維持する。

---

## 8. UI設計（Claude Code担当・仕様確定後）

実装はしていない。方針だけ置く。

- **ハブ（`/generator`）**：企画セレクトに`Weekly Review`を追加。weekly選択時は「対象月」の`type="month"`を
  **「対象週（金曜日）」の`type="date"`**へ差し替え、直近の金曜を既定値にする。金曜以外を選んだら送信前に警告する。
- **サムネイル列**：`表紙` / `新譜1`〜`5` / `Other` のラベル。`derivePageBadges()`（未保存・他の人が編集中・背景未設定）はページ種別に依存していないのでそのまま使える。
- **選定UI**：既存の並び順モーダルを拡張し、`feature`5枠と`others`一覧の**入れ替え**として操作させる（§5.1）。
  ドラッグで「移動」に見せると同数制約に引っかかるので、**UIの見た目も入れ替えとして設計する**（枠へドロップ＝その枠にいた作品がリストへ戻る）。
- **編集パネル**：weeklyでは評価文とおすすめ曲の欄を出さない。「情報修正／背景設定／共通設定」の1段タブ構成は維持する。
- **表紙ページ**：作品の編集欄は出さず、背景画像と（必要なら）週番号の手動上書きだけを持つ。
- 編集画面だけボトムナビ・フッターを出さない`isImmersiveRoute()`、3カラム／1280px未満のsticky、iPhoneで字間UIを出さない判定は**すべて現行のまま**。

---

## 9. 未確定・Koheiへの確認事項

2026-09-08にFigmaで実測し、当初の未確定7点のうち**3点が解消**した（区切り記号は`・`、ロゴは下端0、版面の座標）。
同日、Koheiへの確認で**さらに2点が解消**した（洋4邦1の強制不要、長い作品名は字間自動詰め）。
残りを影響の大きい順に並べる。

1. ~~表紙の書体をどうするか。~~ **解消（2026-09-08）**：セルフホスト実装済み。Koheiからフォントファイルを受領し、
   `tools/generator-lab/assets/alternate-gothic-no2-d-regular.ttf`に配置（`public/fonts/`からここへ移設。
   wave.png・jacket_2000.webpと同じ、スタンドアロン版・Next.jsアプリの両方から相対解決できる場所）。
   `fonts.mjs`にセルフホスト読み込みを追加し、実測（サイズ118px・字間+1%）でインク幅が実物と1px未満で一致することを確認した。
   権利者は`URW Software, Copyright 1994 by URW`（Font Bureauの原版ではなく互換クローンと思われる）で、
   ライセンス記述は無いが、**Koheiが過去に入手したフォントバンドルのファイルであることを確認し、使用の許可を得た。**
   Monthly／Japanはこの書体を使わないため、読み込みに失敗しても他シリーズへ影響しない設計にしてある。
2. ~~Figmaから取り残した細部。~~ **解消（2026-09-08）**：Figmaのレート上限回復を待たず、
   Koheiから実物投稿7枚（`tools/generator-lab/reference/2026#36/`）を受領し、画素単位の実測で代替した。
   週タイトルの文字・書体、Other Releasesの
   塗り・見出し書体・本文書体・行送りはすべて確定した（§6.2・§6.3）。
3. ~~表紙の背景写真の運用。~~ **解消（2026-09-09）**：設問そのものが誤りだった。
   **表紙に背景は出ない**（帯5本が各240×1200＝キャンバス全面を覆うため、見えるのはジャケットが欠けた帯だけ）。
   実際に決めるべきだったのは「waveをどう供給するか」で、Koheiの決定は次のとおり。

   - **waveは月替わりで、Koheiが月ごとに提供する。** 対象は**金曜日が属する暦月**（週の窓は土曜〜金曜なので
     月をまたぐ週があるが、金曜基準でよい。例：`2026-10-02(金)`の週＝`9/26(土)〜10/2(金)`は**10月**のwave）。
   - **月ごとのwaveをアプリ側に保存し、年月で識別して自動で選ぶ**（2026-09-09に実装。§6.5）。
     毎回アップロードする運用にはしない。保管はリポジトリ内の`tools/generator-lab/assets/waves/`で、
     グレースケール変換により1か月あたり約2.9MB。
   - **ページごとの地の色は、現行の手動カラーピッカーのまま。** 実測でも作品ごとに違い、
     ジャケットの平均色とも一致しない（人が選んでいる）ため、自動抽出はしない。
   - 合成規則そのものは§6.5で確定（Luminosity・不透明度50%）。
4. ~~洋楽4＋邦楽1をUIで強制するか。~~ **解消（2026-09-08）**：強制しない。理由は次項のWEEK列の発見。
5. ~~Other Releasesの件数上限。~~ **解消（2026-09-08）**：固定上限は設けず、行送りを自動で詰める／広げる
   （Koheiの決定）。実測の箱（720×870）では30行がちょうど行送り=フォントサイズ(29px)の境界で、
   31行以上は`Layout.WEEKLY.OTHERS.fits(n)`がfalseを返し出力不可になる（§6.3・§6.4）。
6. ~~表紙の帯とジャケットの対応。~~ **解消（2026-09-08）**：実物投稿で確認済み。`[4,2,1,3,5]`（1位が中央）で確定、
   `Layout.WEEKLY.COVER.RANK_TO_BAND`に実装済み（§6.2）。
7. ~~長い作品名の扱い。~~ **解消（2026-09-08）**：字間を自動で詰める。実装済み（`Render.fitWeeklyTitle`、§6.1・§12）。

### 8. 2026-09-08追加で判明：Release Masterに`WEEK`列が実在した（対応済み）

項目4への回答（「release masterで該当週にWEEK列が採用となっているものです」）から発覚。詳細は§12。
「Weeklyの採用概念はシートに無い」という当初の前提が誤りだったため、`selectWeeklyAlbums()`の
洋4邦1ヒューリスティックを廃止し、`WEEK=採用／掲載`を反映する実装へ差し替えた（§12）。

## 10. 影響ファイル一覧（実装時）

| ファイル | 変更内容 | 担当 |
| --- | --- | --- |
| `lib/generator/model.ts` | ページ種別3種の追加、series別のkind・順序・件数検証、weeklyの`rendererVersion` | Codex |
| `lib/generator/source.ts` | `importWeeklyDocument()`、週の抽出・初期配分。`sortAlbums`は共用 | Codex |
| `app/api/generator/source/route.ts` | `series=weekly`＋`week=YYYY-MM-DD`の受理 | Codex |
| `lib/generator/__tests__/model.test.ts` ／ `source.test.ts` | weeklyの検証・取り込みのテスト | Codex |
| `lib/generator/canvas-preview.ts` | ページ種別の型拡張、`no`のseries分岐 | Codex |
| `tools/generator-lab/core/layout.mjs` ／ `render.mjs` ／ `pages.mjs` | `weekly-v1`の版面と描画 | Claude Code（実測値確定後） |
| `tools/generator-lab/core/fonts.mjs` | 表紙書体の追加（§9-1の結論次第） | Claude Code |
| `app/generator/GeneratorHub.tsx` ／ `PageNavigator.tsx` ／ `Inspectors.tsx` ／ `ItemInspector.tsx` | 週選択、ページ種別ラベル、選定（入れ替え）UI、weeklyで出さない欄 | Claude Code |
| `app/generator/bulk-export.ts` | weeklyの命名規則 | Claude Code |
| `app/generator/hit-test.ts` | weekly版面のクリック判定 | Claude Code |
| `supabase/migrations/` | **変更なし**（§4・§5.1） | — |

---

## 11. 実装順の提案

1. **§9の1と2を先に片づける**（書体の決定と実測）。ここが埋まらないまま描画に入ると、版面を二度作ることになる。
2. Codex：`model.ts`のスキーマ拡張＋テスト。既存のMonthly文書が同じテストを通り続けることを確認する。
3. Codex：取り込みAPIとimport。実Release Masterで直近の金曜を読み、件数と洋邦の内訳を目視確認する。
4. Claude Code：`weekly-v1`の版面と描画（表紙・作品面・Other Releases）、はみ出し検出。
5. Claude Code：ハブの週選択、選定（入れ替え）UI、ページ種別ラベル、書き出し命名。
6. 実データ1週ぶんで通し受入（作成→選定→編集→対象別保存→履歴復元→7枚ZIP）。

各段階で`npx tsc --noEmit --incremental false` ／ `npm run lint` ／ `npm test` ／ `npm run build` を通す。
現在の基準は**19テストファイル・320件成功**、描画コア59件成功、型検査、lint、本番ビルド成功。

---

## 12. 2026-09-08追記：WEEK列の発見（設計の前提が変わった）

利用者への確認中に判明。**Release Masterには`WEEK`列（O列、index 14）が実在し、Monthlyの`M/J採用`と全く同じ語彙（`採用`／`掲載`／`不採用`）ですでに手動運用されている。**
`scripts/check-headers.ts`のヘッダー一覧、および該当列の実データ（`不採用`を含む1218行）で確認済み。

これは本書§3・§9-4の前提を覆す。

- **誤っていた前提**：「Weeklyの採用概念はシートに無い」「洋楽4＋邦楽1の初期配分は機械的に決める」。
- **正しい前提**：メイン5枚・Other Releasesの選定は**すでにRelease Master上で人手により確定している**。
  `WEEK=採用`→`feature`、`WEEK=掲載`→`others`、`WEEK=不採用`（または空）→**取り込み対象外**。
  Monthlyの`selectReleaseMasterAlbums()`と同じ形の関数で解ける。

### 発見時点の実装との差分

`lib/generator/source.ts`の`selectWeeklyAlbums()`は、この列の存在を知らずに書かれている。

- `ReleaseMasterAlbum`型に`weekAdoption`相当のフィールドが無く、`app/api/generator/source/route.ts`のマッパーも
  `SHEET_COL`にWEEK列を持たないため、**この列の値をどこでも読んでいない**。
- 現行の`selectWeeklyAlbums()`は日付範囲の全件から機械的に洋楽4＋邦楽1を選ぶヒューリスティックで、
  **`不採用`の除外もしていない**（日付が合えば不採用の作品もOther Releasesに紛れ込む）。

### 必要だった修正（2026-09-08に実装済み）

1. `lib/sheet-headers.ts`の`SHEET_COL`へ`WEEK_ADOPTION: "WEEK"`を追加。
2. `lib/types.ts`の`ReleaseMasterAlbum`へ`weekAdoption: string`を追加、
   `app/api/generator/source/route.ts`のマッパーへ`weekAdoption: value(row, SHEET_COL.WEEK_ADOPTION)`を追加。
3. `selectWeeklyAlbums()`を洋4邦1ヒューリスティックから、`selectReleaseMasterAlbums()`と同型の
   「日付範囲でフィルタ→`weekAdoption`で`feature`／`others`に振り分け（`不採用`・空は除外）→重複除去→`sortAlbums`」へ差し替える。
4. これに伴い、本書§3・§9-4（洋4邦1をUIで強制するか）は**解消**。選定はRelease Master側の手動運用のまま、
   ツールは`WEEK`列をそのまま反映するだけでよい（Koheiの2026-09-08回答：強制不要、根拠はこの列の存在）。
5. アプリ内の「選定（入れ替え）UI」（§5.1・§8）は維持する。Release Master側の判定を後からアプリ内で
   微調整する用途として引き続き有効（Monthlyでも`M/J採用`確定後に多少の入れ替えが起きるのと同じ位置づけ）。

### 実装結果

- `SHEET_COL.WEEK_ADOPTION`、`ReleaseMasterAlbum.weekAdoption`、Release Master APIの各マッパーを追加した。
- `selectWeeklyAlbums()`は対象金曜までの土曜〜金曜を抽出し、`#`列の週番号を照合してから`WEEK=採用`を`feature`、`WEEK=掲載`を`others`へ振り分ける。空欄・`不採用`は除外し、作品名＋アーティストで重複除去してから既存規則で整列する。
- Weekly作成画面は投稿金曜日を入力し、Release Masterの`#`列を見出し、表紙、PNG／ZIP名へ共通利用する。年だけは対象金曜のISO週年を使う。
- 表紙はfeatureの並びからジャケット5枚を導出する。featureとOthersの選定変更は件数を維持するswapで、既存の構成保存契約とDBを変更していない。
- `cover`／`feature`／`others`をプレビュー、サムネイル、クリック判定、警告検査、単枚PNG、全7枚ZIPへ接続した。

## 13. この文書の位置づけ

`docs/generator-specification.md` §1のWeekly実装状況と、§10の残件を具体化する設計にあたる。
2026-09-08に機能契約、WEEK列取り込み、全3種の描画、統合UI、書き出し命名とテストを実装し、仕様書と引き継ぎ文書へ反映した。
実Release Masterの読み取りでは、W35がfeature 5件＋Others 26件、W36がfeature 5件＋Others 30件で、全件にジャケットURLがあることを確認した。実共有W36文書はversion 1〜5でswap保存・構成復元・作品保存・作品復元を確認し、2026-09-09の月別wave受入ではversion 7への共通設定保存とversion 8への復元も確認した。最終値は2400px、未保存0件、ロック0件。月別wave版のZIPは47,377,064 bytesで、7枚すべてCRC正常・2400×2400。featureとOthersを目視し、9月のwave、ジャケット、文字に欠落がないことを確認した。物理iPhone実機のスリープ復帰・反復出力負荷だけが残る。

### 更新履歴

- 2026-09-08 初版（設計）
- 2026-09-08 Figma `Post-images` の`Weekly`ページを実測し、§6.1〜6.3を実測値へ差し替え。
  あわせて「Weeklyは波を使わない」という当初の想定を`useWave: true`へ訂正した。
- 2026-09-08 Codexが機能契約・取り込みAPI・テストを実装。Figma実測後の確定指示により`useWave: true`へ揃え、作品名の初期字間`-0.02em`と暫定行送り`72 / 54`も取り込みデータへ追加した。（初期字間は2026-09-11に`0`へ変更）
- 2026-09-08 Koheiへの確認中、Release Masterに`WEEK`列（採用／掲載／不採用）が実在すると判明。§3・§9-4の「洋4邦1を機械的に決める」前提を取り下げ、§12へ修正内容を記録した。取り込みロジックの修正はCodexへ差し戻し。
- 2026-09-08 CodexがWEEK列取り込みを修正し、表紙・作品面・Other Releasesを統合画面へ接続。ISO週表示、feature↔Othersのswap、ページ別編集項目、Weekly用ZIP名、描画警告と回帰テストを追加した。固定データの実ブラウザで全7ページと並び替えダイアログを確認した。
- 2026-09-09 Koheiの説明により、New Music Fridayの週境界を土曜〜金曜と確定。Release Masterの`#`列を週番号の正本として型・取り込み・文書・表紙・ファイル名へ接続した。文書の`period.start`は投稿金曜のまま維持する。
- 2026-09-09 実共有W36文書を作成し、HTTP入力検証に残っていたMonthly専用の1〜2件制限をWeekly表紙0件／Others最大60件へ対応。swap保存・復元・作品保存・復元・全7枚ZIPを通し確認した。iPhone 17 Pro Simulatorで日本語UIフォントと狭幅ステータス帯を補修した。
- 2026-09-09 表紙のオーバーレイ色を確定（Figmaの原本値 `#0040C7`@60%。実物投稿の画素回帰で裏付け、`rgba(0,64,199,0.6)`へ修正）。検算スクリプト `tools/generator-lab/measure/overlay-of.mjs` と回帰テストを追加した。
- 2026-09-09 背景の合成規則をLuminosity・不透明度50%へ確定（§6.5）。Koheiの説明を実物投稿で検算し、
  実ブラウザで平均0.24〜0.26階調の一致を確認した。あわせて**waveが月替わりの素材**であること、
  Weeklyは金曜が属する暦月のwaveを使うこと、月別waveをアプリで管理することを§9-3へ記録した。

- 2026-09-09 月別waveの保管と自動適用を実装。原版をグレースケール化する`make-wave.mjs`、
  `assets/waves/wave26MM.png`、`runtime.tsx`の`BUNDLED_WAVES`と対象月からの自動選択、
  未登録月の注意表示まで。参照画像と原版はGit管理外にした。

- 2026-09-09 2026年1〜12月の波の原版を受領し、全12か月を変換して`assets/waves/`へ配置。
  旧`assets/wave.png`を退役させ、標準の波を8月の原版へ差し替えた。

- 2026-09-09 Codexが実共有W36文書で9月waveの自動選択、共通設定の保存・履歴復元、月別wave版の
  全7枚ZIPを確認。CRC・寸法・代表画像の目視に成功し、最終値とロックを元に戻した。

月別wave変更のpush・デプロイは行っていない。

- 2026-09-11 利用者の指示で、Weekly取り込みの作品名の初期字間を`-0.02`から`0`へ変更（`leading: 72 / 54`は据え置き）。
  描画既定の`Layout.WEEKLY.TYPE.title.tracking`は元から0で、`fitWeeklyTitle`の自動詰めも`baseTracking`基準なので挙動は変わらない。
  **保存済みのWeekly文書は`-0.02`のまま**で、DB移行は行っていない。
