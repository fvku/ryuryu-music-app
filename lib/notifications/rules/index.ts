/**
 * アラートのルール一覧。種類を足すときは
 *   1. lib/notifications/kinds.ts に source: "alert" の種類を足す
 *   2. このフォルダにルールを1ファイル書いて、下の配列に足す
 */

import type { AlertRule } from "./types";
import { mjUnwrittenRule } from "./mj-unwritten";

export const ALERT_RULES: AlertRule[] = [
  mjUnwrittenRule,
];
