import type { ReleaseMasterAlbum } from "@/lib/types";
import type { NotificationKindId } from "../kinds";

/**
 * アラート計算に渡す材料。データは使うルールだけが読むよう遅延で取り、
 * 同じ計算の中では1回だけ読む（lib/notifications/alerts.ts が用意する）。
 */
export interface AlertContext {
  email: string;
  now: Date;
  albums: () => Promise<ReleaseMasterAlbum[]>;
}

/** ルールが返す1件。id・種類・作成時刻は alerts.ts が補う */
export interface AlertDraft {
  /** 同じ種類の中で一意なキー（ベル一覧の key と id に使う） */
  key: string;
  title: string;
  body: string;
  url: string;
}

export interface AlertRule {
  kind: NotificationKindId;
  compute: (ctx: AlertContext) => Promise<AlertDraft[]>;
}
