/**
 * Release Masterの手入力を、同じファイル内の追記専用履歴へ記録する。
 * このファイルをコンテナバインドのApps Scriptへ追加する。
 * 導入手順: docs/review-edit-journal.md
 * @OnlyCurrentDoc
 */
const RYURYU_REVIEW_JOURNAL = {
  sourceSheet: "Release Master",
  journalSheet: "_review_edit_log",
  handler: "recordRyuryuReviewEdit",
  installerProperty: "RYURYU_REVIEW_JOURNAL_INSTALLATION",
  members: {
    Kohei: "kohei.fuku0926@gmail.com",
    Meri: "akyme68@gmail.com",
    Hanawa: "yoshinorihnw@gmail.com",
    Eddie: "edwardcannell93@gmail.com",
    Kwisoo: "kwisoo1102@gmail.com",
    Kaede: "qururiquiqui@gmail.com",
  },
  headers: [
    "schemaVersion", "eventId", "recordedAt", "albumUid", "memberEmail",
    "valueJson", "previousValueJson", "observedValueJson", "captureKind", "status",
    "cellA1", "albumNoJson", "albumTitleJson", "artistNameJson",
  ],
  maxReviewCells: 1000,
};

/** 1人の管理者が手動実行する。同じ管理者の再実行ではトリガーを増やさない。 */
function installRyuryuReviewJournal() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error("Release Masterの拡張機能から開いたApps Scriptで実行してください");
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error("コンテナバインドのスクリプトが必要です");
  lock.waitLock(30000);
  try {
    const source = spreadsheet.getSheetByName(RYURYU_REVIEW_JOURNAL.sourceSheet);
    if (!source) throw new Error("Release Masterシートがありません");
    ryuryuReviewColumns_(source.getRange(1, 1, 1, source.getLastColumn()).getDisplayValues()[0]);
    const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return trigger.getHandlerFunction() === RYURYU_REVIEW_JOURNAL.handler
        && trigger.getTriggerSourceId() === spreadsheet.getId()
        && trigger.getEventType() === ScriptApp.EventType.ON_EDIT;
    });
    if (triggers.length > 1) throw new Error("編集トリガーが重複しています。手順書の復旧手順を確認してください");
    const properties = PropertiesService.getScriptProperties();
    const marker = properties.getProperty(RYURYU_REVIEW_JOURNAL.installerProperty);
    const expected = triggers.length ? spreadsheet.getId() + ":" + triggers[0].getUniqueId() : null;
    if (marker && marker !== expected) {
      throw new Error("別の管理者またはコピー元の設置記録があります。手順書の復旧手順を確認してください");
    }
    ryuryuReviewLogSheet_(spreadsheet, true);
    const trigger = triggers[0] || ScriptApp.newTrigger(RYURYU_REVIEW_JOURNAL.handler)
      .forSpreadsheet(spreadsheet).onEdit().create();
    properties.setProperty(RYURYU_REVIEW_JOURNAL.installerProperty, spreadsheet.getId() + ":" + trigger.getUniqueId());
    SpreadsheetApp.flush();
    spreadsheet.toast("レビュー履歴の記録を設定しました。既存レビューの日時は変更していません。", "レビュー履歴", 10);
    return { installed: true, journalSheet: RYURYU_REVIEW_JOURNAL.journalSheet };
  } finally {
    lock.releaseLock();
  }
}

/** インストール型「編集時」トリガー専用。エディタから直接実行しない。 */
function recordRyuryuReviewEdit(event) {
  const recordedAt = new Date().toISOString(); // 編集時刻ではなく、ハンドラーが起動した記録時刻。
  if (!event || !event.range || !event.source || !event.triggerUid) {
    throw new Error("この関数は編集トリガーからのみ実行してください");
  }
  const sheet = event.range.getSheet();
  if (sheet.getName() !== RYURYU_REVIEW_JOURNAL.sourceSheet) return;
  if (sheet.getParent().getId() !== event.source.getId()) throw new Error("イベントのファイルが一致しません");
  const marker = PropertiesService.getScriptProperties().getProperty(RYURYU_REVIEW_JOURNAL.installerProperty);
  if (marker !== event.source.getId() + ":" + event.triggerUid) throw new Error("登録したトリガーと一致しません");

  const firstRow = Math.max(2, event.range.getRow());
  const lastRow = event.range.getLastRow();
  if (lastRow < firstRow) return;
  const columns = ryuryuReviewColumns_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]);
  const memberColumns = Object.keys(RYURYU_REVIEW_JOURNAL.members).filter(function (name) {
    const column = columns[name] + 1;
    return column >= event.range.getColumn() && column <= event.range.getLastColumn();
  });
  if (!memberColumns.length) return;
  if ((lastRow - firstRow + 1) * memberColumns.length > RYURYU_REVIEW_JOURNAL.maxReviewCells) {
    throw new Error("レビューの一括編集が大きすぎます。1000セル以下に分け、履歴の記録状況を確認してください");
  }
  const lock = LockService.getDocumentLock();
  if (!lock) throw new Error("コンテナバインドのスクリプトが必要です");
  lock.waitLock(30000);
  try {
    const journal = ryuryuReviewLogSheet_(event.source, false);
    const rows = sheet.getRange(firstRow, 1, lastRow - firstRow + 1, sheet.getLastColumn()).getDisplayValues();
    const uidCounts = {};
    if (sheet.getLastRow() >= 2) {
      sheet.getRange(2, columns.UID + 1, sheet.getLastRow() - 1, 1).getDisplayValues().forEach(function (row) {
        const uid = String(row[0] || "").trim();
        uidCounts[uid] = (uidCounts[uid] || 0) + 1;
      });
    }
    const singleCell = event.range.getNumRows() === 1 && event.range.getNumColumns() === 1;
    const batchId = Utilities.getUuid();
    const entries = [];
    rows.forEach(function (row, offset) {
      const uid = String(row[columns.UID] || "").trim();
      memberColumns.forEach(function (member) {
        const observed = String(row[columns[member]] == null ? "" : row[columns[member]]);
        const hasEventValue = singleCell && event.value !== undefined;
        const value = hasEventValue ? String(event.value) : (singleCell && observed === "" ? "" : observed);
        const previous = singleCell && event.oldValue !== undefined ? String(event.oldValue) : null;
        const issues = [];
        if (!/^[a-z0-9]{8}$/.test(uid)) issues.push("invalid_uid");
        else if (uidCounts[uid] !== 1) issues.push("duplicate_uid");
        if (!singleCell) issues.push("range_snapshot");
        else if (!hasEventValue && observed !== "") issues.push("event_value_missing");
        else if (value !== observed) issues.push("value_changed_before_capture");
        if (value.startsWith("=")) issues.push("formula");
        const cell = ryuryuReviewColumnLetter_(columns[member] + 1) + (firstRow + offset);
        entries.push([
          "1", batchId + ":" + cell, recordedAt, /^[a-z0-9]{8}$/.test(uid) ? uid : "",
          RYURYU_REVIEW_JOURNAL.members[member], JSON.stringify(value), JSON.stringify(previous),
          JSON.stringify(observed), singleCell ? "single_event" : "range_snapshot",
          issues.length ? "needs_review:" + issues.join(",") : "recorded", cell,
          JSON.stringify(String(row[columns["No."]] || "")),
          JSON.stringify(String(row[columns.title] || "")),
          JSON.stringify(String(row[columns.artist] || "")),
        ]);
      });
    });
    const nextRow = journal.getLastRow() + 1;
    const requiredRows = nextRow + entries.length - 1;
    if (requiredRows > journal.getMaxRows()) journal.insertRowsAfter(journal.getMaxRows(), requiredRows - journal.getMaxRows());
    journal.getRange(nextRow, 1, entries.length, RYURYU_REVIEW_JOURNAL.headers.length).setValues(entries);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** 作品名・アーティスト名の列は、本番の見出し（Title / Artist）と旧来の日本語の見出しのどちらでも読む */
const RYURYU_REVIEW_ALIASES = {
  title: ["Title", "アルバム名"],
  artist: ["Artist", "アーティスト"],
};

function ryuryuReviewColumns_(headers) {
  const columns = {};
  const required = ["UID", "No."].concat(Object.keys(RYURYU_REVIEW_JOURNAL.members));
  const aliasOf = {};
  Object.keys(RYURYU_REVIEW_ALIASES).forEach(function (key) {
    RYURYU_REVIEW_ALIASES[key].forEach(function (name) { aliasOf[name] = key; });
  });
  headers.forEach(function (header, index) {
    const name = String(header).trim();
    const key = aliasOf[name] || (required.includes(name) ? name : null);
    if (!key) return;
    if (columns[key] !== undefined) throw new Error("必要な列名が重複しています: " + name);
    columns[key] = index;
  });
  required.concat(Object.keys(RYURYU_REVIEW_ALIASES)).forEach(function (key) {
    if (columns[key] === undefined) {
      const label = RYURYU_REVIEW_ALIASES[key] ? RYURYU_REVIEW_ALIASES[key].join(" または ") : key;
      throw new Error("必要な列がありません: " + label);
    }
  });
  return columns;
}

function ryuryuReviewLogSheet_(spreadsheet, allowCreate) {
  let sheet = spreadsheet.getSheetByName(RYURYU_REVIEW_JOURNAL.journalSheet);
  if (!sheet) {
    if (!allowCreate) throw new Error("履歴シートがありません。設置関数を実行してください");
    sheet = spreadsheet.insertSheet(RYURYU_REVIEW_JOURNAL.journalSheet);
  }
  if (sheet.getLastRow() === 0 && allowCreate) {
    sheet.getRange(1, 1, 1, RYURYU_REVIEW_JOURNAL.headers.length).setValues([RYURYU_REVIEW_JOURNAL.headers]);
    sheet.setFrozenRows(1);
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  if (JSON.stringify(headers) !== JSON.stringify(RYURYU_REVIEW_JOURNAL.headers)) {
    throw new Error("履歴シートの列が想定と異なります。既存データは上書きしていません");
  }
  return sheet;
}

function ryuryuReviewColumnLetter_(column) {
  let result = "";
  while (column > 0) {
    column--;
    result = String.fromCharCode(65 + column % 26) + result;
    column = Math.floor(column / 26);
  }
  return result;
}
