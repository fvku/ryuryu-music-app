/**
 * 通知・アラートの種類の一覧（クライアントとサーバーの両方から読む）。
 *
 * 種類は2系統ある。
 *   - message: 送った時点の内容を `notifications` シートに残す通知（既読あり）。`notifyMember` で送る
 *   - alert:   今の作業状況から毎回計算するアラート（既読なし。作業が終われば消える）。`rules/` に1ファイルずつ置く
 *
 * ここに足した種類は、設定画面に ON/OFF が自動で並ぶ。
 */

export type NotificationSource = "message" | "alert";

export interface NotificationKind {
  id: string;
  label: string;
  description: string;
  source: NotificationSource;
  /** プッシュ通知で届けられる種類か。false ならベル一覧だけ（設定画面にプッシュのON/OFFを出さない） */
  pushAvailable: boolean;
  /** 設定が未保存のメンバーへの既定値 */
  defaultInApp: boolean;
  defaultPush: boolean;
  /** false なら設定画面に出さない（テスト通知など、本人が自分で送るもの） */
  configurable: boolean;
}

export const NOTIFICATION_KINDS = [
  {
    id: "test",
    label: "テスト通知",
    description: "設定画面から自分に送る動作確認用の通知",
    source: "message",
    pushAvailable: true,
    defaultInApp: true,
    defaultPush: true,
    configurable: false,
  },
  {
    id: "mj_unwritten",
    label: "M/J担当の未執筆",
    description: "ASSIGNで自分の担当になっていて、まだ文章が書けていない作品",
    source: "alert",
    pushAvailable: false,
    defaultInApp: true,
    defaultPush: false,
    configurable: true,
  },
] as const satisfies readonly NotificationKind[];

export type NotificationKindId = (typeof NOTIFICATION_KINDS)[number]["id"];

export function getNotificationKind(id: string): NotificationKind | undefined {
  return (NOTIFICATION_KINDS as readonly NotificationKind[]).find((k) => k.id === id);
}

/** メンバーごとの受け取り設定（種類ごと） */
export interface KindPref {
  inApp: boolean;
  push: boolean;
}

export type NotificationPrefs = Record<string, KindPref>;

/** 保存済みの設定に既定値を補って、全種類ぶんの設定を返す */
export function resolvePrefs(saved: Record<string, Partial<KindPref>>): NotificationPrefs {
  return Object.fromEntries(
    (NOTIFICATION_KINDS as readonly NotificationKind[]).map((k) => {
      const s = saved[k.id];
      return [k.id, {
        inApp: s?.inApp ?? k.defaultInApp,
        push: k.pushAvailable && (s?.push ?? k.defaultPush),
      }];
    })
  );
}

/** ベル一覧に並ぶ1件（message と alert を同じ形で扱う） */
export interface InboxItem {
  /** message は通知ID、alert は `alert:<種類>:<キー>` */
  id: string;
  kind: string;
  source: NotificationSource;
  title: string;
  body: string;
  /** タップしたときの移動先（アプリ内のパス） */
  url: string;
  createdAt: string;
  /** message のみ。alert は常に null */
  readAt: string | null;
}

export interface InboxResponse {
  items: InboxItem[];
  /** 未読の message 件数 + alert 件数（ベルのバッジ） */
  badgeCount: number;
}
