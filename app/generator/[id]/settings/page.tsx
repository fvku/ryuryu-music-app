import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { generatorActor } from "@/lib/generator/access";
import type { GeneratorSnapshot } from "@/lib/generator/client-types";
import { GeneratorError } from "@/lib/generator/errors";
import { uuid } from "@/lib/generator/model";
import { generatorRpc } from "@/lib/generator/repository";
import ThemeWorkspace from "./ThemeWorkspace";

export const metadata: Metadata = { title: "共通設定 | 投稿画像ジェネレーター" };
export const dynamic = "force-dynamic";

export default async function GeneratorSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const rawId = (await params).id;
  let snapshot: GeneratorSnapshot | null = null, actor = "", loadError: string | null = null;
  try {
    actor = generatorActor(await auth());
    snapshot = await generatorRpc("generator_read", { p_id: uuid(rawId) }) as GeneratorSnapshot;
  } catch (error) {
    loadError = (error as GeneratorError).message || "共有文書を読み込めませんでした。";
  }
  if (!snapshot) {
    return (
      <section className="mx-auto max-w-2xl rounded-2xl border p-6" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <h1 className="text-xl font-bold">共通設定を開けません</h1>
        <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>{loadError}</p>
        <Link href="/generator" className="mt-5 inline-block rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold">企画一覧へ戻る</Link>
      </section>
    );
  }
  return <ThemeWorkspace initialSnapshot={snapshot} actor={actor} />;
}
