"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function HowToUseModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors hover:opacity-80"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
      >
        使い方
      </button>

      {mounted && open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
            style={{ backgroundColor: "var(--bg-primary)", border: "1px solid var(--border-subtle)" }}
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b"
              style={{ backgroundColor: "var(--bg-primary)", borderColor: "var(--border-subtle)" }}
            >
              <div className="w-10 h-10" />
              <div className="absolute left-1/2 -translate-x-1/2 top-2 w-10 h-1 rounded-full sm:hidden" style={{ backgroundColor: "var(--border-subtle)" }} />
              <h2 className="font-bold text-sm" style={{ color: "var(--text-primary)" }}>使い方</h2>
              <button
                onClick={() => setOpen(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 text-lg font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="px-5 py-6 flex flex-col gap-7">

              <Section title="なんのアプリ？">
                <p>毎月アルバムを聴いて、点数つけて、「これよかった」「これは微妙」を記録＆共有するやつです。グループのレビュー文化をちゃんとデータにしよう、という試みです。</p>
              </Section>

              <Section title="ホーム">
                <p>いつもクイスーが聞いてくれている有象無象のアルバムをすべて収録しています。有象のアルバムはもちろん、無象のアルバムも早めにレビューしてみんなに知らせましょう。</p>
                <Items items={[
                  ["月で絞る", "今月分がデフォルトで開くようになってます。「先月どうだったっけ」もプルダウンで見れます"],
                  ["ジャンル", "得意ジャンルに絞ってください。たまには得意じゃない邦楽も聞くようにします"],
                  ["M/J採用", "採用されたやつだけ見たいとか、逆に落ちたやつ気になるとか、自由に"],
                  ["🎯 Up Next (for Review)", "「まだ聴いてないやつ全部出して」ボタンです。採用判定前＆自分がまだレビューしてないアルバムを一発で絞れます。宿題リストの確認にどうぞ"],
                ]} />
              </Section>

              <Section title="アルバム開いたら">
                <p>タップすると詳細が出てきます。いろいろできます。</p>
                <Items items={[
                  ["M/J採用、変えられます", "バッジをポチっとタップすれば変更できます。「検討に早めにしとこ」が目的です。念のため反映前にダイアログで誤タップを防いでます。安心して触ってください"],
                  ["Release Master 速報", "リリースマスターにスコアや一言が書かれてるのに、まだアプリに反映されてないやつがここにこっそり出ます。フライング情報コーナー"],
                  ["みんなのレコメンド", "このアルバムについて誰かが誰かに送ったレコメンドが全部見れます。ログインしてなくても見れます"],
                  ["レビューを書く", "0〜10点、0.5刻み。コメントも書ける。「点数はよくわからんけど一言だけ言いたい」ならスコアなしでコメントだけでもOKです"],
                  ["ブックマーク", "左上のやつ。「まだ聴いてないけどとりあえず確保」なアルバムを積んでおく場所です"],
                  ["閉じ方", "右上の ✕ か、上のバー部分をぐっと下にスワイプすると閉じます"],
                ]} />
              </Section>

              <Section title="タイムライン">
                <p>みんなのレビューとレコメンドが新しい順に流れてきます。自分にメンションが来てると黄色くなるのですぐわかります。「なんか知らんけど薦められてた」に気づける設計です。</p>
              </Section>

              <Section title="マイページ">
                <p>Googleでログインして使います。</p>
                <Items items={[
                  ["SAVED", "ブックマークしたやつ。「いつか聴く」の墓場にならないように定期的に開いてください"],
                  ["FOR YOU", "誰かがあなたに送ったレコメンドが届きます。アイコンに赤丸が出たら新着あり。ちゃんと見てあげてください、送った人が悲しむので"],
                  ["REVIEWED", "自分がレビューしたやつの一覧。リリース日順。意外とあまり使わないかもですが、あると便利かなと設置してます"],
                ]} />
              </Section>

              <Section title="レコメンドの送り方">
                <p>くいすーがいつもやってくれてるやつを機能化しました。バッジですぐ気づけるので便利！しかもすぐSpotifyで聞けます。アルバム勧められるって良いよね、の感情を取り戻したい。</p>
              </Section>

            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Items({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map(([label, desc]) => (
        <div key={label}>
          <span className="font-bold" style={{ color: "var(--text-primary)" }}>{label}</span>
          <span> — {desc}</span>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="font-bold text-sm mb-2.5 pb-1.5 border-b" style={{ color: "var(--text-primary)", borderColor: "var(--border-subtle)" }}>{title}</h3>
      <div className="flex flex-col gap-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        {children}
      </div>
    </div>
  );
}
