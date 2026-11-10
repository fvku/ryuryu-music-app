/**
 * 画面のデータ取得で「失敗」を「0件」に化けさせないための共通処理。
 * HTTPエラーは例外にして、呼び出し側で空の一覧ではなくエラーと再試行を出す。
 */

export class LoadError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = "LoadError";
  }
}

export function loadErrorMessage(status: number | null): string {
  if (status === 401) return "ログインの有効期限が切れました。ページを再読み込みして、ログインし直してください";
  if (status === 403) return "このアカウントでは表示できません。メンバーのGoogleアカウントでログインしてください";
  if (status === null) return "通信できませんでした。電波の良いところで再読み込みしてください";
  return `読み込みに失敗しました（HTTP ${status}）。少し待ってから再読み込みしてください`;
}

export async function fetchJsonOrThrow<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new LoadError(loadErrorMessage(null), null);
  }
  if (!res.ok) throw new LoadError(loadErrorMessage(res.status), res.status);
  return res.json() as Promise<T>;
}

export function errorMessageOf(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "エラーが発生しました";
}
