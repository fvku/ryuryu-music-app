/**
 * 通知まわりの保存先（アプリ用スプレッドシート）。
 *
 *   push_subscriptions: A=email, B=endpoint, C=p256dh, D=auth, E=userAgent, F=createdAt, G=lastSentAt
 *     プッシュ通知を受け取る端末の登録。1人が複数端末を持てる。endpoint で一意
 *   notifications: A=id, B=email, C=kind, D=title, E=body, F=url, G=createdAt, H=readAt
 *     送った通知（message）の履歴と既読。alert はここに残さない
 *   notification_prefs: A=email, B=kind, C=inApp, D=push, E=updatedAt
 *     種類ごとの受け取り設定。行が無い種類は lib/notifications/kinds.ts の既定値
 *
 * どれもシートが無ければ初回アクセスで作る。
 */

import "server-only";
import { google } from "googleapis";
import { getGoogleAuth } from "@/lib/google-auth";
import type { InboxItem, KindPref } from "./kinds";

const SUBSCRIPTIONS = "push_subscriptions";
const NOTIFICATIONS = "notifications";
const PREFS = "notification_prefs";

const HEADERS: Record<string, string[]> = {
  [SUBSCRIPTIONS]: ["email", "endpoint", "p256dh", "auth", "userAgent", "createdAt", "lastSentAt"],
  [NOTIFICATIONS]: ["id", "email", "kind", "title", "body", "url", "createdAt", "readAt"],
  [PREFS]: ["email", "kind", "inApp", "push", "updatedAt"],
};

function client() {
  return google.sheets({ version: "v4", auth: getGoogleAuth(true) });
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new Error("GOOGLE_SPREADSHEET_ID is not set");
  return id;
}

/** 列数からA1記法の最終列（A〜Z）を返す */
function lastCol(name: string): string {
  return String.fromCharCode(64 + HEADERS[name].length);
}

/** 同じインスタンスで作成済みと分かったシートは、毎回のメタデータ取得を省く */
const ensured = new Set<string>();

async function ensureSheet(sheets: ReturnType<typeof client>, name: string) {
  if (ensured.has(name)) return;
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "sheets.properties.title" });
  if (!meta.data.sheets?.some((s) => s.properties?.title === name)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: name } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${name}!A1:${lastCol(name)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS[name]] },
    });
  }
  ensured.add(name);
}

async function readRows(name: string): Promise<string[][]> {
  const sheets = client();
  await ensureSheet(sheets, name);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId(), range: `${name}!A2:${lastCol(name)}` });
  return (res.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
}

async function appendRows(name: string, rows: string[][]) {
  if (rows.length === 0) return;
  const sheets = client();
  await ensureSheet(sheets, name);
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${name}!A:${lastCol(name)}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/** 2行目以降を丸ごと書き直す（件数の少ない表の削除に使う） */
async function rewriteRows(name: string, rows: string[][]) {
  const sheets = client();
  await ensureSheet(sheets, name);
  const id = spreadsheetId();
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: `${name}!A2:${lastCol(name)}` });
  if (rows.length === 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${name}!A2:${lastCol(name)}${rows.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/** 指定セルだけ書き換える（rowIndex は readRows の添字） */
async function updateCells(name: string, cells: { rowIndex: number; col: string; value: string }[]) {
  if (cells.length === 0) return;
  const sheets = client();
  await ensureSheet(sheets, name);
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      valueInputOption: "RAW",
      data: cells.map((c) => ({ range: `${name}!${c.col}${c.rowIndex + 2}`, values: [[c.value]] })),
    },
  });
}

const norm = (email: string) => email.trim().toLowerCase();

// ── 端末の登録 ──────────────────────────────────────────────

export interface PushSubscriptionRecord {
  email: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  createdAt: string;
  lastSentAt: string;
}

function rowToSubscription(row: string[]): PushSubscriptionRecord {
  return {
    email: norm(row[0] ?? ""), endpoint: row[1] ?? "", p256dh: row[2] ?? "", auth: row[3] ?? "",
    userAgent: row[4] ?? "", createdAt: row[5] ?? "", lastSentAt: row[6] ?? "",
  };
}

function subscriptionToRow(s: PushSubscriptionRecord): string[] {
  return [s.email, s.endpoint, s.p256dh, s.auth, s.userAgent, s.createdAt, s.lastSentAt];
}

export async function readSubscriptions(email?: string): Promise<PushSubscriptionRecord[]> {
  const all = (await readRows(SUBSCRIPTIONS)).map(rowToSubscription).filter((s) => s.endpoint);
  return email ? all.filter((s) => s.email === norm(email)) : all;
}

/**
 * 端末を登録する。同じ endpoint が既にあれば持ち主と鍵を上書きする
 * （同じ端末で別のメンバーがログインし直した場合も、最後の人に届くようにする）。
 */
export async function upsertSubscription(input: Omit<PushSubscriptionRecord, "createdAt" | "lastSentAt">): Promise<void> {
  const rows = await readRows(SUBSCRIPTIONS);
  const index = rows.findIndex((row) => row[1] === input.endpoint);
  const now = new Date().toISOString();
  if (index < 0) {
    await appendRows(SUBSCRIPTIONS, [subscriptionToRow({ ...input, email: norm(input.email), createdAt: now, lastSentAt: "" })]);
    return;
  }
  const next = rows.map(rowToSubscription);
  const current = next[index];
  const updated = { ...current, ...input, email: norm(input.email) };
  // 画面を開くたびに登録し直すので、何も変わっていなければ書かない
  if (subscriptionToRow(updated).join("\t") === subscriptionToRow(current).join("\t")) return;
  next[index] = updated;
  await rewriteRows(SUBSCRIPTIONS, next.map(subscriptionToRow));
}

export async function removeSubscriptions(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  const drop = new Set(endpoints);
  const rows = await readRows(SUBSCRIPTIONS);
  const kept = rows.filter((row) => !drop.has(row[1]));
  if (kept.length !== rows.length) await rewriteRows(SUBSCRIPTIONS, kept);
}

export async function markSubscriptionsSent(endpoints: string[], sentAt: string): Promise<void> {
  if (endpoints.length === 0) return;
  const targets = new Set(endpoints);
  const rows = await readRows(SUBSCRIPTIONS);
  await updateCells(SUBSCRIPTIONS, rows.flatMap((row, rowIndex) => (targets.has(row[1]) ? [{ rowIndex, col: "G", value: sentAt }] : [])));
}

// ── 通知の履歴 ──────────────────────────────────────────────

export interface StoredNotification {
  id: string;
  email: string;
  kind: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  readAt: string | null;
}

function rowToNotification(row: string[]): StoredNotification {
  return {
    id: row[0] ?? "", email: norm(row[1] ?? ""), kind: row[2] ?? "", title: row[3] ?? "", body: row[4] ?? "",
    url: row[5] ?? "", createdAt: row[6] ?? "", readAt: row[7] || null,
  };
}

export async function appendNotification(n: StoredNotification): Promise<void> {
  await appendRows(NOTIFICATIONS, [[n.id, norm(n.email), n.kind, n.title, n.body, n.url, n.createdAt, n.readAt ?? ""]]);
}

/** その人の通知を新しい順に返す */
export async function readNotifications(email: string, limit = 50): Promise<InboxItem[]> {
  const mine = (await readRows(NOTIFICATIONS)).map(rowToNotification).filter((n) => n.id && n.email === norm(email));
  return mine
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((n) => ({ id: n.id, kind: n.kind, source: "message" as const, title: n.title, body: n.body, url: n.url, createdAt: n.createdAt, readAt: n.readAt }));
}

/** 既読にする。ids を省くとその人の未読すべて */
export async function markNotificationsRead(email: string, ids?: string[]): Promise<void> {
  const target = ids ? new Set(ids) : null;
  const now = new Date().toISOString();
  const rows = await readRows(NOTIFICATIONS);
  await updateCells(NOTIFICATIONS, rows.flatMap((row, rowIndex) => {
    const n = rowToNotification(row);
    if (n.email !== norm(email) || n.readAt || (target && !target.has(n.id))) return [];
    return [{ rowIndex, col: "H", value: now }];
  }));
}

// ── 受け取り設定 ──────────────────────────────────────────────

const bool = (v: string | undefined): boolean | undefined => {
  const s = (v ?? "").trim().toUpperCase();
  return s === "TRUE" ? true : s === "FALSE" ? false : undefined;
};

/** 保存済みの設定だけを返す（未保存の種類は含まない。既定値は resolvePrefs で補う） */
export async function readSavedPrefs(email: string): Promise<Record<string, Partial<KindPref>>> {
  const saved: Record<string, Partial<KindPref>> = {};
  for (const row of await readRows(PREFS)) {
    if (norm(row[0] ?? "") !== norm(email) || !row[1]) continue;
    saved[row[1]] = { inApp: bool(row[2]), push: bool(row[3]) };
  }
  return saved;
}

export async function writePrefs(email: string, prefs: Record<string, KindPref>): Promise<void> {
  const now = new Date().toISOString();
  const me = norm(email);
  const rows = await readRows(PREFS);
  const others = rows.filter((row) => norm(row[0] ?? "") !== me || !(row[1] in prefs));
  const mine = Object.entries(prefs).map(([kind, p]) => [me, kind, p.inApp ? "TRUE" : "FALSE", p.push ? "TRUE" : "FALSE", now]);
  await rewriteRows(PREFS, [...others, ...mine]);
}
