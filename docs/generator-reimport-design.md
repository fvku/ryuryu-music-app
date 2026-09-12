# 取り込み直し（再取り込み）の設計

作成日：2026-09-11（Claude Code）／状態：**Codex実装・本番DB適用済み（2026-09-11）。**
発端：week37で`WEEK`列を`掲載`へ変えた12件が画像に出ない、という利用者からの報告。

Monthly／Japan／Weeklyの文書を作ったあとに、Release Masterの`WEEK`列・`M/J採用`列を変えても、
既存の文書には反映されない。取り込みは文書作成時の1回きりのスナップショットで、読み直す経路が無いため。
2026-09-11の利用者の依頼「何度も取り込みできる仕様にできないか」に対する設計。

---

## 1. なぜ既存のAPIでは足りないか

`generator_structure_save`（`supabase/migrations/202609050001_generator_completion.sql`）は**並び替え専用**として書かれている。
提案されたページ配列に対して、次をすべて要求する。

- ページ数が現在と同じで、ページIDの集合も同じ
- **各ページの`itemIds`の件数が現在と同じ**
- `itemIds`の総数・重複なしの数が`generator_items`の件数と一致し、すべて実在する

したがって作品の追加・削除は必ず`INVALID_INPUT`になる。作品を増やす経路はDBに存在しない。
`generator_create`は`unique (series, period_start, period_end)`で同じ期間の作り直しを拒否し、削除RPCも無い。

2026-09-11に追加した「Release Masterから再取得」（[UI実装記録 §26](./generator-ui-implementation.md)）は
**既存作品の文字情報だけ**を直す。作品の数は変えない。ここが今回の対象。

---

## 2. 決めた振る舞い（利用者と合意済み、2026-09-11）

編集画面に「Release Masterから取り込み直す」を置く。押すと対象週・対象月をもう一度読み、
いまの文書と突き合わせた結果を確認ダイアログへ出す。実行は**1つの新しいversion**として確定する。

| 種類 | 扱い |
| --- | --- |
| 追加 | Release Masterで`採用`／`掲載`になったが文書に無い作品を足す |
| 削除 | Release Masterで`採用`／`掲載`を外した、または行が消えた作品を外す |
| 区分の移動 | `採用`↔`掲載`（Weeklyはメイン↔Other Releases）が入れ替わった作品を移す |
| 文字情報 | **ここでは変えない**。§26の「再取得」の担当 |

守ること。

- **既存作品は作品IDごと残す。** 直した文字、ジャケットの差し替え、字間・行送り、その作品のversionと履歴はそのまま。
- **背景色（page）・共通設定（theme）には触らない。**
- 突き合わせはUIDを最優先し、UIDがない行は作品名＋アーティスト、改名時だけNo.へフォールバックする。No.は行移動で別作品へ再利用され得るため、同じNo.だけで既存の別作品へ接続しない。既存作品と採用行は一対一で対応させ、重複作品を残さない。
- 並び順は既存の作品の並びを保ち、増えた作品はその区分の末尾へ足す。
  取り込み時の規則（`sortAlbums`／`sortWeeklyOthers`）で並べ直すかはUIのチェックで選ぶ。既定はOFF。
- 削除の既定は**手を入れていない作品だけON**。何か直した作品は既定OFFで一覧に出す（§26の差分ダイアログと同じ考え方）。
  消した作品の編集内容はversionのスナップショットには残るが、選んで戻す導線は無い。ここは利用者に見せて選ばせる。

---

## 3. SQL（Codex担当）

### 3.1 新しいRPC

```
generator_reimport(p_id uuid, p_actor text, p_request_id uuid, p_change jsonb) returns jsonb
```

`p_change`の形（`generator_structure_save`のロック・版の受け取り方をそのまま踏襲する）。

```jsonc
{
  "kind": "structure",              // ロックは structure を使う。新しいロック種別は増やさない
  "targetId": "<document id>",
  "clientId": "<uuid>",
  "tokenHash": "<sha256>",
  "generation": 3,
  "expectedVersion": 5,             // structure_version
  "pages":   [ { "id": "…", "kind": "others", "itemIds": ["…"], "bgColor": "#475569" } ],  // 変更後の全ページ
  "addItems":      [ { "id": "…", "source": { … }, "content": { … } } ],                    // 新規作品だけ
  "removeItemIds": [ "…" ]
}
```

### 3.2 検査

`generator_structure_save`と同じ順序で、次を確認して拒否する。

1. 文書が存在する（`for update`）。無ければ`NOT_FOUND`。
2. `p_actor`・`p_request_id`があり、`kind = 'structure'`、`targetId = p_id`。違えば`INVALID_INPUT`。
3. 同じ`request_id`の再送は、`actor`と`request`が一致し`operation = 'reimport'`なら保存済みsnapshotを返す。
   違えば`REQUEST_CONFLICT`。**`generator_save`／`generator_structure_save`の再送判定は
   `operation in ('save','restore')`なので、新しい`operation`名を足す場合はそちらの条件も見直すこと。**
4. `structure`ロックが有効で、`owner_email`・`client_id`・`token_hash`・`generation`が一致する。違えば`LOCK_LOST`。
5. `structure_version = expectedVersion`。違えば`VERSION_CONFLICT`。
6. **消す作品・消すページに他者のロックが残っていれば`LOCK_CONFLICT`。** 編集中のものを黙って消さない。
7. `addItems`のIDが未使用、`removeItemIds`が実在、
   `pages`の`itemIds`の集合が「（現在の作品 ∪ 追加）− 削除」とちょうど一致し、重複が無い。
8. 追加作品の`content`は`generator_check_assets`を通す（`generator_create`と同じ）。

ページ種別・順序・件数の上限（Weeklyの`cover → feature×N(≤5) → others`、Monthlyの`adopted`／`listed`）は
SQLでは見ない。TS側の`parseDocument`が正本なので、**APIが呼び出し前に検証する**（`generator_create`と同じ分担）。

### 3.3 書き込み

- `addItems`を`generator_items`へ挿入（`version`は既定の1）。
- `removeItemIds`の行と、それに紐づく`generator_locks`を削除する。
- `data.pages`を差し替える。既存ページIDの`bgColor`は現在の値を残し、提案側の値では上書きしない
  （背景色は`page`保存の担当）。
- `page_versions`は、増えたページIDに`1`を足し、消えたページIDのキーを落とす。
- `structure_version + 1`、`version + 1`、`updated_by`・`updated_at`を更新。
- `generator_snapshot`を作り、`generator_revisions`へ`operation = 'reimport'`で1行書く。

### 3.4 権限

末尾の`revoke all` / `grant execute ... to service_role`へ新しい関数を足す。
テーブルへの直接権限は増やさない。

### 3.5 履歴と復元への影響

- `generator_history`は`operation`をそのまま返すので、`GeneratorHistoryEntry["operation"]`（`lib/generator/client-types.ts`）に
  `"reimport"`を足す必要がある。UIの復元セレクタは`targetKind`で対象を絞っているので、
  `reimport`の版を`structure`扱いにするか、復元対象から外すかを決めること。
- 作品の集合が変わった前後をまたぐ`structure`の復元は、現在の`generator_structure_save`の検査
  （件数・集合が現在と一致）に必ず引っかかる。**これは仕様として明示し、UIで理由を出す**か、
  復元側も作品集合の差を扱えるようにするかの判断が要る。今回の設計は前者（明示して拒否）を前提にしている。

---

## 4. API（Codex担当）

### 4.1 差分の取得

```
GET /api/generator/documents/<id>/reimport
```

- 文書の`series`と`period`から対象期間を決める（Weeklyは`period.start`の金曜、Monthly／Japanは`period.start`の先頭7文字）。
- Release Masterを直読みする（`app/api/generator/source/route.ts`と同じ読み取り・正規化を共用する）。
- `selectWeeklyAlbums` / `selectReleaseMasterAlbums`で対象行を出し、現在の作品と突き合わせる。
- 返す形（案）。UIはこれをそのまま確認ダイアログに出す。

```jsonc
{
  "added":   [ { "key": "…", "title": "…", "artist": "…", "group": "feature" } ],
  "removed": [ { "itemId": "…", "title": "…", "artist": "…", "group": "others", "edited": true } ],
  "moved":   [ { "itemId": "…", "title": "…", "from": "others", "to": "feature" } ],
  "limits":  { "featureMax": 5, "othersMax": 60, "featureAfter": 5, "othersAfter": 19 }
}
```

- `edited`は「取り込み時の`source.fields`から`content.fields`が変わっているか」。§26の`importedValue`と同じ判定。
- 件数の上限を超える結果になる場合は、ここで理由つきの`INVALID_INPUT`にする（黙って切り捨てない）。

### 4.2 適用

```
POST /api/generator/documents/<id>/reimport
```

- body：`{ requestId, clientId, token, generation, expectedVersion, addKeys[], removeItemIds[], resort: boolean }`
- サーバ側でもう一度Release Masterを読み、選ばれた分だけを反映した**完全なページ配列と追加作品**を組み立てる。
  クライアントから作品の中身を受け取らない（取り込み規則をサーバに集約する）。
- `parseDocument`で全体を検証してから`generator_reimport`を呼ぶ。
- 追加作品の`content`は新規取り込みと同じ（`generatorItem()`を再利用）。Weeklyの作品名字間0、`[EP]`の扱いもそのまま従う。
- `resort`がtrueなら、そのページ種別の全作品を取り込み時の規則で並べ直す（`sortAlbums`／`sortWeeklyOthers`）。
  falseなら既存の並びを保ち、追加分だけ末尾へ足す。

---

## 5. UI（Claude Code担当。実装は機能側が入ってから）

- 編集画面のヘッダーに「Release Masterから取り込み直す」。「最新版を再読込」「Release Masterから再取得」と並べる。
  3つの違いが分かる文言にすること（共有DBの再読込／文字情報の更新／作品の増減）。
- 確認ダイアログ：追加・削除・区分移動を画像ごとに並べ、削除は編集済みだけ既定OFF。並べ直しのチェック。実行後の枚数を出す。
- 実行には`structure`ロックが要る。並び順モーダルと同じく明示的な編集開始を使う。
- 未保存の下書きがある状態での実行は止める（作品が消えると下書きの行き先が無くなるため）。
- 実行後は`snapshot`で全体を差し替え、下書き・ページ色・並びの一時状態を作り直す。

---

## 6. 未決事項（Codexの判断が要る）

1. `#`週番号（`period.weekNumber`）がRelease Master側で変わっていた場合、取り込み直しで更新するか。
   更新するなら`data.period`を書き換えることになる。表紙とファイル名に効く。
2. 作品集合をまたぐ`structure`復元の扱い（§3.5）。拒否で確定してよいか。
3. `operation = 'reimport'`を増やすか、`operation = 'save'`＋`target_kind = 'structure'`で表すか。
   前者は履歴が読みやすく、後者は既存の再送判定・型に触らずに済む。
4. 削除した作品の`generator_assets`（ジャケット差し替え画像）の後始末。行を消すとStorageの実体が孤児になる。
5. 同時実行：取り込み直しの最中に他者が作品を保存した場合、`structure_version`だけでは検出できない。
   作品側の`version`も`expectedVersion`として送るかどうか。

---

## 7. 今回の経緯（参考）

- week37文書 `c3f67801-8f91-4418-8475-802c622d4815`（#37、2026-09-11〜2026-09-18）は2026-09-10 17:41 UTC作成、version 1。
  中身は feature 4件・others 7件。
- 同じ週をいま取り込み直すと`採用`4件・`掲載`19件。差の12件は文書作成後に`掲載`へ変えた2026-09-11発売の洋楽。
- 取り込みロジックの不具合ではない。`selectWeeklyAlbums`は19件すべてを拾う。
- 今週の投稿は、この機能を待たずに文書を削除して作り直す方針で利用者と合意した（2026-09-11）。

---

## 8. Codex実装時の決定（2026-09-11）

- `period.weekNumber`は取り込み直しでは更新しない。作品構成だけを対象にし、表紙・出力ファイル名の変更を混ぜない。
- 履歴は`operation = 'reimport'`、`target_kind = 'structure'`として記録する。
- 作品構成が変わる前のversionは、編集画面の並び順復元候補から外す。DB側も従来どおり集合不一致を拒否する。
- 削除作品が参照していた`generator_assets`とStorage実体は自動削除しない。履歴の参照と誤削除防止を優先する。
- APIが読み取った全既存作品のversionをRPCへ渡し、保存直前にDBで照合する。差分確認中に作品保存が入った場合は`VERSION_CONFLICT`で全体を拒否する。
- 既存作品が残るページはIDと背景色を保持する。削除・区分移動で不要になったページは落とし、追加で必要なページは新しいID・背景色未設定で作る。
- `202609110001_generator_reimport.sql`を本番Supabaseへ適用済み。既存の`pl_*`／`generator_*`行のハッシュ不変、service role限定の実行権限、合成データによる取り込み直しと全ロールバックを確認した。

### v2追記（2026-09-12）

- 既存作品の`source`更新は`generator_reimport`へ混ぜず、画像の保存時にitem PATCHの`content`と一緒に確定する。
  これにより、構成だけが先に確定し、文字情報とカバーは下書きから画像単位で保存するv2の順序を保つ。
- Weeklyの`resort: true`はfeatureをRelease Masterの行順、othersを`sortWeeklyOthers`の従来規則にした。
  初回取り込みの`selectWeeklyAlbums`も同じ規則を使う。
- 作品集合より前のstructure復元は引き続き拒否する。候補から外したうえで、作品数が異なるため戻せない旨を表示する。
