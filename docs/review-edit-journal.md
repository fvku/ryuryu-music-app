# レビュー編集履歴の導入と確認

Release Masterの手入力を同じスプレッドシートの `_review_edit_log` へ追記する。アプリの同期（`lib/ops/review-sync.ts`、2026-11-10〜）はこの履歴の記録時刻でアプリより新しいと確かめられた手入力だけを反映し、それ以外は管理画面の確認待ちに回す。**設置するまでは、シートの手入力はすべて確認待ちになる**（自動では反映しない）。アプリからの書き込みは `lib/review-journal.ts` が同じ形式で記録する（履歴シートが無ければ記録しない）。

コード: [ReviewJournal.gs](../apps-script/ReviewJournal.gs)。ローカル検証は、この実ファイルをVMで実行する [review-journal.test.ts](../apps-script/review-journal.test.ts)。

## まずテスト専用の空ファイルで試す

担当は管理者1人。所要時間の目安は5〜10分。アプリ用シートや実際のRelease Masterへテスト値を書き込まない。

1. [Googleスプレッドシート](https://sheets.google.com/)で新しい空のファイルを作り、名前を「レビュー履歴テスト」にする。シート名（画面下のタブ）を `Release Master` にする。
2. 下のタブ区切りデータをコピーしてA1へ貼り付ける。1行目がA〜J列に分かれることを確認する。

   ```text
   No.	Title	Artist	UID	Kohei	Meri	Hanawa	Eddie	Kwisoo	Kaede
   test-1	Review journal test	Test artist	test0001	7 before
   ```

3. この**テストファイル**の「拡張機能 → Apps Script」を開く。「ファイル」の「＋ → スクリプト」から `ReviewJournal` を追加し、[ReviewJournal.gs](../apps-script/ReviewJournal.gs)の中身を丸ごと貼り付けて保存する。既存ファイルや既存関数がある場合は削除しない。
4. 上部の関数選択で `installRyuryuReviewJournal` を選び、「実行」。Googleの権限確認では自分のアカウント・対象プロジェクト・要求された権限を確認する。このコードは対象ファイルの読み書きと編集トリガーを使う。外部送信やWebアプリ公開の機能はない。権限や警告の内容が想定と違う場合は、その文面をチャットへ伝える。`@OnlyCurrentDoc` は対象ファイルへのアクセス制限を意図しているが、同じプロジェクト内の他のコードによって要求範囲が広がることがある。[Googleの認可仕様](https://developers.google.com/apps-script/guides/services/authorization#limit_scope_to_the_current_document)
5. テストファイルに `_review_edit_log` タブが増え、1行目に見出しだけがあることを確認する。既存の `7 before` の履歴は作られない。
6. `Release Master` タブへ戻り、**KoheiのE2だけ**を `8 after` に変更してEnterを押す。履歴タブに新しい行が増えることを確認する。主な値は `albumUid=test0001`、`valueJson="8 after"`、`previousValueJson="7 before"`、`captureKind=single_event`、`status=recorded`。`recordedAt` は末尾が `Z` のUTC日時になる。
7. E2の内容を削除する。別の履歴行に `valueJson=""`、`previousValueJson="8 after"` が残ることを確認する。次にE2へ `0` を入力し、`valueJson="0"` が残ることを確認する。
8. E2とF2へ2セルをまとめて貼り付ける。対象メンバーごとの履歴が増え、`captureKind=range_snapshot`、`status=needs_review:range_snapshot` になることを確認する。
9. Apps Scriptの左側「トリガー」（時計アイコン）で、`recordRyuryuReviewEdit` の「スプレッドシートから／編集時」が1件あることを確認する。`installRyuryuReviewJournal` をもう一度実行しても件数が増えないことを確認する。
10. チャットへ「テスト：履歴追加OK/NG、削除・0点OK/NG、一括貼り付けの要確認OK/NG」と返す。NGならApps Scriptの「実行数」にあるエラー文を添える。履歴に個人の実レビューを入れる必要はない。

## 本番への設置はテスト成功後

テスト成功を確認してから、実際のRelease Masterでも「拡張機能 → Apps Script」から同じファイルを追加し、同じ管理者1人が設置関数を実行する。設置時に元のレビューや過去の日時は書き換えず、空の履歴タブとトリガーを用意する。過去のレビューを現在時刻で埋めない。

本番ではテストのためにレビューを書き換えず、その後の通常の手入力で履歴が残ることを確認する。設置したアカウントの権限で動くため、他のメンバーは設置関数を実行しない。トリガー失敗は設置者のApps Script「実行数」とGoogleからの失敗通知で確認する。[インストール型トリガーの権限・管理・失敗通知](https://developers.google.com/apps-script/guides/triggers/installable)

## 記録の意味と限界

| 項目 | 扱い |
|---|---|
| `recordedAt` | ハンドラー起動時刻をUTCで保存する。Googleが保証する厳密な編集発生時刻ではない。過去セルへ日時を補完しない。 |
| `albumUid` | 現在のUID列から取得する8文字の英小文字・数字。列移動は列名で追従する。UIDなし・不正形式・重複は要確認として残す。 |
| `memberEmail` | 編集した人の本人確認情報ではなく、編集対象のメンバー列を示す。Kaedeを含む6人分。 |
| `valueJson` | 単一セルはイベントに渡された値を優先。空値、0、コメントのみも保存する。複数セルは取得時点のスナップショット。 |
| `previousValueJson` | 単一セルでイベントに旧値があれば保存する。旧値情報がなければJSONの `null`。空の新値は `""` と区別する。 |
| `observedValueJson` | ハンドラーが読んだ現在値。イベント値と違う場合は要確認にする。 |
| `captureKind` / `status` | 単一セルと範囲の取得を区別する。`recorded` でも自動的な勝者を意味しない。`needs_review:*` は自動採用しないための印。 |
| `eventId` | 実行ごとのUUIDとセル位置。再配信された同一編集を厳密に識別できる操作IDではない。 |

Googleの編集イベントには新旧値が単一セルのときだけ渡され、編集発生日時のフィールドはない。複数セルの貼り付けは、後続の変更を読んでしまう可能性があるため要確認として保存する。[編集イベント仕様](https://developers.google.com/apps-script/guides/triggers/events#edit)

Google Sheets API・他のApps Scriptからの書き込みはこのトリガーを発火させない。アプリ投稿や保守スクリプトは、次の実装で独自の記録が必要となる。[トリガーの制限](https://developers.google.com/apps-script/guides/triggers/installable#restrictions)

同時刻・到着順逆転・行の並べ替え・UIDの変更・ログ欠落などは、このログだけで安全に解決できない。今後の同期側で現在のUID・セル値・記録の整合性を確認し、不明な内容を上書きしない。元シートの構造変更・数式再計算による変化の完全な監査ログではない。

追記はDocumentLockで他の同スクリプト実行と直列化するが、Google Sheets APIや人の編集をロックするものではない。[DocumentLockの範囲](https://developers.google.com/apps-script/reference/lock/lock-service#getDocumentLock())

文字列はJSONで保存し、入力が `=` で始まっても履歴タブで数式として実行しない。1回で対象レビューが1000セルを超える編集は、部分的な記録を作らずエラーにする。設置後に通常編集が反映されない場合は、トリガー失敗・権限・実行上限を調べる。元レビュー自体はこのスクリプトから書き換えない。

## 復旧・停止

- `recordRyuryuReviewEdit` をエディタから直接実行した場合のエラーは正常。設置関数を実行した後、シート上の編集で確認する。
- 履歴の列名を変えたり、履歴タブを削除すると記録は停止する。見出しが違う既存タブには上書きせずエラーにする。内容を退避してから設置手順を確認する。
- 重複トリガーや設置記録の不一致が出た場合は、最初に設置した管理者のアカウントで確認する。他のアカウントのトリガーは一覧に見えないため、管理者間で確認する。コピー元の記録や削除済みトリガーを復旧する場合は、元のトリガーが動いていないことを確認したうえで、プロジェクトの設定 → スクリプトプロパティの `RYURYU_REVIEW_JOURNAL_INSTALLATION` だけを削除し、設置関数を再実行する。履歴行は残す。[トリガーを作成したアカウントによる管理](https://developers.google.com/apps-script/guides/triggers/installable#restrictions)
- 記録を止める場合は、設置者のトリガー一覧で `recordRyuryuReviewEdit` のトリガーを削除する。履歴データと他のトリガーは残す。再設置時は上記の設置記録も確認する。

## 検証状況

ローカルでは実際の `.gs` を読み込み、30件のテストで設置の再実行、6人の列移動、0点、削除、コメントのみ、一括編集、UID不正・重複、後続変更、数式文字列、行数拡張、書き込み失敗時のロック解放を確認した。

2026-11-10、テスト専用のGoogleスプレッドシートで実環境確認を完了した。設置関数を2回実行し、トリガーが1件に保たれることを確認。単一セル変更（7→8）、削除、0点の3件と、一括貼り付け2人分の要確認履歴、計5件をGoogle Sheetsの画面から読み取り確認した。Apps Scriptの実行一覧でも設置2回・編集トリガー4回がすべて完了していた。実ファイルのURLと検証値・画面はGit管理外の `.local/review-journal-live-2026-11-10.*` に保存している。

未確認: 本番のRelease Masterへの設置と通常編集、共同編集時の配信順、利用上限に近い量での実行、権限取り消し後の復旧。テスト環境での成功はこれらを保証しない。同期の新旧比較・部分成功・再試行の実装は後続作業。
