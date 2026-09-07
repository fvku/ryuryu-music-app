import type { GeneratorSnapshot } from "@/lib/generator/client-types";

export type GeneratorApiError = Error & { code?: string; status?: number };

export async function generatorJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw Object.assign(new Error(body.error || "操作に失敗しました。"), { code: body.code, status: response.status });
  return body;
}

export function snapshotWithLocks(value: GeneratorSnapshot, locks: GeneratorSnapshot["locks"]): GeneratorSnapshot {
  return { ...value, locks: value.locks || locks };
}
