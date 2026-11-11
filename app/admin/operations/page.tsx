import Link from "next/link";
import CronStatusPanel from "@/components/admin/CronStatusPanel";

export default function OperationsPage() {
  return (
    <main className="mx-auto max-w-3xl" style={{ color: "var(--text-primary)" }}>
      <Link href="/admin" className="text-sm underline underline-offset-4">← 管理画面へ</Link>
      <h1 className="mb-3 mt-5 text-2xl font-bold">定期実行の確認</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>失敗や記録の途切れを確認するページです。復旧の判断と本番データの変更・復元の承認はKoheiが行います。</p>
      <CronStatusPanel />
    </main>
  );
}
