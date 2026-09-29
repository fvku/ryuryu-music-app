"use client";

/**
 * 今週のリリース作業（Weekly / 金曜19時投稿）。
 *
 * 以前は AOTY → Claudeで整形 → シートに貼り付け、邦楽は1件ずつ追加、
 * リスナー数は GAS、URL・収録タグは管理画面…と複数の場所に分かれていた作業を、
 * 上から順に進めるだけで終わるように1ページにまとめたもの。
 * 初めての人でも迷わないよう、各手順に「いつやるか」と「なぜ」を書いている。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { shiftWeek, todayInTokyo, upcomingFriday, weekLabel, weekWindow } from "@/lib/weekly/week";
import { MismatchQueueModal, type RefetchMismatch } from "@/components/admin/MismatchQueueModal";
import { CandidateList, isDefaultSelected, type Candidate } from "./CandidateList";
import { ACCENT, Badge, Button, DANGER, Note, OK, StepCard, WARN, formatListeners } from "./parts";

const AOTY_PAGES = [
  "https://www.albumoftheyear.org/upcoming/",
  "https://www.albumoftheyear.org/upcoming/2/",
];
const DEFAULT_JAPAN_PLAYLIST = "https://open.spotify.com/playlist/37i9dQZF1DWYBDycFJuxRt";
const JAPAN_PLAYLIST_KEY = "weekly_japan_playlist";

type Viewer = { email: string; isMember: boolean; googleVerified: boolean; isAdmin: boolean };

interface WeekRow {
  rowNum: number; date: string; title: string; artist: string; waboku: string; time: string;
  spotifyUrl: string; listeners: string; playlists: string; week: string; hasNo: boolean;
}

type RefreshStep = "spotify" | "time" | "listeners" | "playlists";
const REFRESH_STEPS: { key: RefreshStep; label: string }[] = [
  { key: "spotify", label: "Spotify URL を探す" },
  { key: "time", label: "曲数・再生時間を入れる" },
  { key: "listeners", label: "月間リスナー数を入れる" },
  { key: "playlists", label: "プレイリスト収録タグを付ける" },
];
type StepState = { status: "idle" | "running" | "done" | "error"; summary?: string };

async function api<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/admin/weekly", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `エラーが発生しました (${res.status})`);
  return data as T;
}

function toRelease(c: Candidate) {
  return {
    date: c.date, title: c.title, artist: c.artist, waboku: c.waboku,
    spotifyUrl: c.spotifyUrl, coverUrl: c.coverUrl, trackCount: c.trackCount, totalDurationMs: c.totalDurationMs,
  };
}

function useCandidates() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const load = (list: Candidate[]) => {
    setCandidates(list);
    setSelected(new Set(list.filter(isDefaultSelected).map((c) => c.id)));
  };
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return { candidates, selected, load, toggle, reset: () => { setCandidates(null); setSelected(new Set()); } };
}

export default function WeeklyPage() {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [friday, setFriday] = useState(() => upcomingFriday(todayInTokyo()));
  const weekRange = useMemo(() => weekWindow(friday), [friday]);

  // 今週の状況
  const [rows, setRows] = useState<WeekRow[] | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [statusError, setStatusError] = useState<string | null>(null);

  // 1. 洋楽
  const [aotyText, setAotyText] = useState("");
  const western = useCandidates();
  const [westernBusy, setWesternBusy] = useState<"parse" | "add" | null>(null);
  const [westernMessage, setWesternMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  // 2. 邦楽
  const [japanPlaylist, setJapanPlaylist] = useState(DEFAULT_JAPAN_PLAYLIST);
  const [editingPlaylist, setEditingPlaylist] = useState(false);
  const [playlistDraft, setPlaylistDraft] = useState("");
  const japan = useCandidates();
  const [japanName, setJapanName] = useState("");
  const [japanBusy, setJapanBusy] = useState<"load" | "add" | null>(null);
  const [japanMessage, setJapanMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  // 3. 情報の更新
  const [refreshing, setRefreshing] = useState(false);
  const [stepStates, setStepStates] = useState<Record<RefreshStep, StepState>>({
    spotify: { status: "idle" }, time: { status: "idle" }, listeners: { status: "idle" }, playlists: { status: "idle" },
  });
  const [mismatches, setMismatches] = useState<RefetchMismatch[]>([]);
  const [pendingListeners, setPendingListeners] = useState<{ row: number; artist: string; note: string }[]>([]);
  const [mismatchOpen, setMismatchOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/whoami")
      .then((r) => r.json())
      .then(setViewer)
      .catch(() => setViewer({ email: "", isMember: false, googleVerified: false, isAdmin: false }));
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((s: Record<string, string>) => { if (s[JAPAN_PLAYLIST_KEY]) setJapanPlaylist(s[JAPAN_PLAYLIST_KEY]); })
      .catch(() => {});
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api<{ rows: WeekRow[]; sheetUrl: string }>("status", { friday });
      setStatusError(null);
      setRows(data.rows);
      setSheetUrl(data.sheetUrl);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    }
  }, [friday]);

  useEffect(() => {
    if (!viewer?.isAdmin) return;
    let cancelled = false;
    api<{ rows: WeekRow[]; sheetUrl: string }>("status", { friday })
      .then((data) => { if (!cancelled) { setStatusError(null); setRows(data.rows); setSheetUrl(data.sheetUrl); } })
      .catch((e) => { if (!cancelled) setStatusError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [viewer?.isAdmin, friday]);

  /** 週を切り替えたら、前の週の候補や結果は捨てて作り直す */
  function changeWeek(weeks: number) {
    setFriday(shiftWeek(friday, weeks));
    setRows(null);
    western.reset(); japan.reset();
    setWesternMessage(null); setJapanMessage(null);
    setMismatches([]); setPendingListeners([]);
    setStepStates({ spotify: { status: "idle" }, time: { status: "idle" }, listeners: { status: "idle" }, playlists: { status: "idle" } });
  }

  async function parseWestern() {
    setWesternBusy("parse"); setWesternMessage(null);
    try {
      const data = await api<{ candidates: Candidate[]; skipped: number }>("western-preview", { friday, text: aotyText });
      western.load(data.candidates);
      if (data.candidates.length === 0) {
        setWesternMessage({ tone: "warn", text: "作品を読み取れませんでした。AOTYのページで全選択（⌘A / Ctrl+A）してコピーしたものを貼り付けてください。" });
      } else if (data.skipped > 0) {
        setWesternMessage({ tone: "warn", text: `${data.skipped}件は作品名・アーティスト名を読み取れませんでした。足りない作品はシートに直接追加してください。` });
      }
    } catch (e) {
      setWesternMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWesternBusy(null);
    }
  }

  /** 読み取った作品名とアーティスト名が逆だったときの救済 */
  function swapWestern() {
    if (!western.candidates) return;
    western.load(western.candidates.map((c) => ({ ...c, title: c.artist, artist: c.title })));
  }

  async function addCandidates(kind: "western" | "japan") {
    const state = kind === "western" ? western : japan;
    const setBusy = kind === "western" ? setWesternBusy : setJapanBusy;
    const setMessage = kind === "western" ? setWesternMessage : setJapanMessage;
    const picked = (state.candidates ?? []).filter((c) => state.selected.has(c.id));
    if (picked.length === 0) return;
    setBusy("add"); setMessage(null);
    try {
      const result = await api<{ added: { rowNum: number }[]; skipped: { title: string; existingRow: number }[] }>(
        "add", { friday, releases: picked.map(toRelease) },
      );
      const skippedText = result.skipped.length > 0 ? `（${result.skipped.length}件は他の人が先に追加していたので飛ばしました）` : "";
      setMessage({ tone: "ok", text: `${result.added.length}件を追加しました${skippedText}。` });
      state.reset();
      if (kind === "western") setAotyText("");
      await loadStatus();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  async function loadJapan() {
    setJapanBusy("load"); setJapanMessage(null);
    try {
      const data = await api<{ playlistName: string; candidates: Candidate[] }>("japan-preview", { friday, playlistUrl: japanPlaylist });
      setJapanName(data.playlistName);
      japan.load(data.candidates);
    } catch (e) {
      setJapanMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setJapanBusy(null);
    }
  }

  async function savePlaylist() {
    const value = playlistDraft.trim();
    if (!value) return;
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: JAPAN_PLAYLIST_KEY, value }),
    });
    if (res.ok) { setJapanPlaylist(value); setEditingPlaylist(false); japan.reset(); }
    else setJapanMessage({ tone: "error", text: "プレイリストURLを保存できませんでした" });
  }

  async function runRefresh() {
    setRefreshing(true);
    setMismatches([]); setPendingListeners([]);
    setStepStates({ spotify: { status: "idle" }, time: { status: "idle" }, listeners: { status: "idle" }, playlists: { status: "idle" } });
    const set = (key: RefreshStep, state: StepState) => setStepStates((prev) => ({ ...prev, [key]: state }));

    for (const { key } of REFRESH_STEPS) {
      set(key, { status: "running" });
      try {
        // 各段の結果は形が違うので、画面に要る分だけ取り出す
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await api<any>("refresh", { friday, step: key });
        if (key === "spotify") {
          setMismatches(r.mismatches ?? []);
          set(key, { status: "done", summary: r.total === 0
            ? "URLが空の行はありません"
            : `${r.written}件見つかりました／まだ配信されていない・見つからない ${r.notFound}件／名前の食い違い ${r.mismatched}件` });
        } else if (key === "time") {
          set(key, { status: "done", summary: r.total === 0 ? "入れる行はありません" : `${r.written}件入れました` });
        } else if (key === "listeners") {
          const pending = (r.details ?? []).filter((d: { listeners: number | null }) => d.listeners === null);
          setPendingListeners(pending);
          set(key, { status: "done", summary: r.total === 0 ? "すべて入っています" : `${r.written}件入れました${pending.length ? `／保留 ${pending.length}件` : ""}` });
        } else {
          set(key, { status: "done", summary: `${r.written}件にタグを付けました（プレイリスト${r.fetched}本を確認${r.failed?.length ? `、${r.failed.length}本は取得失敗` : ""}）` });
        }
      } catch (e) {
        set(key, { status: "error", summary: e instanceof Error ? e.message : String(e) });
      }
    }
    await loadStatus();
    setRefreshing(false);
  }

  if (!viewer) {
    return <p className="mt-16 text-center text-sm" style={{ color: "var(--text-secondary)" }}>確認中...</p>;
  }
  if (!viewer.isAdmin) {
    return (
      <div className="max-w-sm mx-auto mt-16 rounded-2xl p-8 border text-center" style={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border-subtle)" }}>
        <Link href="/mypage" className="inline-block mb-4 text-xs text-violet-300 hover:underline">← マイページ</Link>
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>今週のリリース作業</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          {!viewer.email ? "Googleでログインしてください。"
            : !viewer.isMember ? "このアカウントにはアクセスが許可されていません。"
            : "Googleで再ログインしてください。"}
        </p>
      </div>
    );
  }

  const total = rows?.length ?? 0;
  const count = (pred: (r: WeekRow) => boolean) => rows?.filter(pred).length ?? 0;
  const westernCount = count((r) => r.waboku === "洋楽");
  const japanCount = count((r) => r.waboku === "邦楽");
  const withUrl = count((r) => !!r.spotifyUrl);
  const withListeners = count((r) => !!r.listeners && !Number.isNaN(Number(r.listeners.replace(/,/g, ""))));
  const adopted = count((r) => r.week === "採用");
  const listed = count((r) => r.week === "掲載");
  const decided = count((r) => !!r.week);
  const missingNo = rows?.filter((r) => !r.hasNo) ?? [];

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link href="/mypage" className="self-start text-xs text-violet-300 hover:underline">← マイページ</Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>今週のリリース作業</h1>
          <Link href="/admin" className="text-xs underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>管理者ページ</Link>
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          金曜19時の Weekly 投稿に向けて、上から順に進めてください。どの手順も何度やり直しても大丈夫です（同じ作品が二重に入ることはありません）。
        </p>
        <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
          <button type="button" onClick={() => changeWeek(-1)} className="px-2 text-lg" style={{ color: "var(--text-secondary)" }} aria-label="前の週">‹</button>
          <div className="flex-1 text-center">
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>対象週</p>
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>{weekLabel(weekRange)}</p>
          </div>
          <button type="button" onClick={() => changeWeek(1)} className="px-2 text-lg" style={{ color: "var(--text-secondary)" }} aria-label="次の週">›</button>
        </div>
        {rows && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              ["登録", `${total}件`, `洋楽${westernCount}・邦楽${japanCount}`],
              ["Spotify URL", `${withUrl}/${total}`, total - withUrl > 0 ? `未取得 ${total - withUrl}` : "そろいました"],
              ["リスナー数", `${withListeners}/${total}`, ""],
              ["振り分け", `${decided}/${total}`, `採用${adopted}・掲載${listed}`],
            ].map(([label, value, sub]) => (
              <div key={label} className="rounded-xl py-2" style={{ backgroundColor: "var(--bg-card)" }}>
                <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{label}</p>
                <p className="font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
                {sub && <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
              </div>
            ))}
          </div>
        )}
        {statusError && <Note tone="error">今週の状況を読み込めませんでした：{statusError}</Note>}
      </header>

      {/* 1. 邦楽 */}
      <StepCard
        no={1}
        title="邦楽を取り込む（New Music Wednesday）"
        when="水曜以降（プレイリストは毎週水曜に更新されます）"
        done={japanCount > 0 ? `${japanCount}件登録済み` : undefined}
        why={<>
          <p>邦楽の候補は Spotify の公式プレイリスト「New Music Wednesday」から選んでいます。</p>
          <p>プレイリストには曲単位で並んでいるので、曲が入っているアルバムを調べ、アルバムとEP（4曲以上）だけを候補にします。1〜3曲のシングルと、インスト・ライブ音源で曲数が水増しされたものは外します。</p>
          <p>追加するときに Spotify URL・カバー画像・曲数と再生時間も一緒に入ります。</p>
        </>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={loadJapan} disabled={japanBusy !== null}>
            {japanBusy === "load" ? "読み込み中...（10秒ほど）" : "New Music Wednesday を読み込む"}
          </Button>
          <button type="button" onClick={() => { setPlaylistDraft(japanPlaylist); setEditingPlaylist(!editingPlaylist); }}
            className="text-xs underline underline-offset-2" style={{ color: "var(--text-secondary)" }}>
            読み込むプレイリストを変える
          </button>
        </div>
        {editingPlaylist && (
          <div className="flex flex-wrap gap-2">
            <input value={playlistDraft} onChange={(e) => setPlaylistDraft(e.target.value)}
              className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-xs"
              style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }} />
            <Button variant="secondary" onClick={savePlaylist}>保存</Button>
          </div>
        )}
        {japanMessage && <Note tone={japanMessage.tone}>{japanMessage.text}</Note>}
        {japan.candidates && (
          <>
            {japanName && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>「{japanName}」から {japan.candidates.length}作品を確認しました</p>}
            <CandidateList
              candidates={japan.candidates}
              selected={japan.selected}
              onToggle={japan.toggle}
              onAdd={() => addCandidates("japan")}
              adding={japanBusy === "add"}
              singlesLabel="シングル（1〜3曲）"
            />
          </>
        )}
      </StepCard>

      {/* 2. 洋楽 */}
      <StepCard
        no={2}
        title="洋楽を取り込む（AOTY）"
        when="木曜22時ごろ〜（AOTYに金曜リリースが出そろってから）"
        done={westernCount > 0 ? `${westernCount}件登録済み` : undefined}
        why={<>
          <p>AOTY（Album of the Year）の Upcoming は、その週に出る注目作がまとまっている一覧です。洋楽の候補はここから選んでいます。</p>
          <p>AOTY はプログラムからの自動取得を拒否しているため、人がブラウザでコピーしたものを貼り付ける形にしています。</p>
          <p>オリジナルアルバムだけが対象です。EP・デラックス版・リイシュー・ライブ盤などは自動で見分けて外します（外れていたら手でチェックを入れ直せます）。</p>
        </>}
      >
        <ol className="list-decimal pl-5 flex flex-col gap-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          <li>
            AOTY の{" "}
            <a href={AOTY_PAGES[0]} target="_blank" rel="noreferrer" className="underline" style={{ color: ACCENT }}>1ページ目</a>
            {" "}と{" "}
            <a href={AOTY_PAGES[1]} target="_blank" rel="noreferrer" className="underline" style={{ color: ACCENT }}>2ページ目</a>
            {" "}を開く
          </li>
          <li>それぞれページ全体を選択（⌘A / Ctrl+A）してコピー</li>
          <li>下の欄に貼り付ける（2ページ分を続けて貼ってOK）→「読み取る」</li>
        </ol>
        <textarea
          value={aotyText}
          onChange={(e) => setAotyText(e.target.value)}
          rows={5}
          placeholder="ここに AOTY のページを貼り付け"
          className="w-full rounded-xl border px-3 py-2 text-sm"
          style={{ backgroundColor: "#12121a", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={parseWestern} disabled={!aotyText.trim() || westernBusy !== null}>
            {westernBusy === "parse" ? "読み取り中..." : "読み取る"}
          </Button>
          {western.candidates && western.candidates.length > 0 && (
            <Button variant="secondary" onClick={swapWestern}>作品名とアーティスト名が逆なら入れ替え</Button>
          )}
        </div>
        {westernMessage && <Note tone={westernMessage.tone}>{westernMessage.text}</Note>}
        {western.candidates && western.candidates.length > 0 && (
          <CandidateList
            candidates={western.candidates}
            selected={western.selected}
            onToggle={western.toggle}
            onAdd={() => addCandidates("western")}
            adding={westernBusy === "add"}
          />
        )}
      </StepCard>

      {/* 3. 情報の更新 */}
      <StepCard
        no={3}
        title="情報を更新する"
        when="金曜0時〜夕方。数時間おきに何度でも"
        done={total > 0 && withUrl === total && withListeners === total ? true : total > 0 ? `URL ${withUrl}/${total}` : undefined}
        why={<>
          <p>洋楽は現地の金曜0時に配信されるので、日本時間では金曜の朝〜夕方にかけて順番に Spotify に出てきます。配信前は URL が見つからないため、時間をおいて何度か押すと少しずつ埋まっていきます。</p>
          <p>このボタン1つで、今週の行について次の4つを順に行います：Spotify URL（まだ無い行だけ）→ 曲数・再生時間 → 月間リスナー数 → プレイリスト収録タグ。</p>
          <p>月間リスナー数は、Spotify URL があればアルバムからアーティストを特定するので、同名の別アーティストと取り違えません。URL がまだ無い行は名前で探し、候補が1人に絞れない場合は保留にします。</p>
          <p>プレイリスト収録タグは、毎晩0:30にも自動で更新されています。</p>
        </>}
      >
        <div>
          <Button onClick={runRefresh} disabled={refreshing || total === 0}>
            {refreshing ? "更新中...（1〜3分かかります）" : "今週の情報を更新する"}
          </Button>
          {total === 0 && rows && <p className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>先に手順1・2で作品を登録してください。</p>}
        </div>
        {REFRESH_STEPS.some(({ key }) => stepStates[key].status !== "idle") && (
          <ul className="flex flex-col gap-1.5 text-xs">
            {REFRESH_STEPS.map(({ key, label }) => {
              const s = stepStates[key];
              const icon = { idle: "・", running: "…", done: "✓", error: "×" }[s.status];
              const color = { idle: "var(--text-secondary)", running: ACCENT, done: OK, error: DANGER }[s.status];
              return (
                <li key={key} className="flex gap-2">
                  <span style={{ color }} className="w-3 flex-shrink-0">{icon}</span>
                  <span style={{ color: "var(--text-primary)" }}>{label}</span>
                  {s.summary && <span style={{ color: s.status === "error" ? DANGER : "var(--text-secondary)" }}>— {s.summary}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {mismatches.length > 0 && (
          <Note tone="warn">
            <p>シートの作品名・アーティスト名と Spotify の検索結果が食い違った作品が {mismatches.length}件あります。別の作品を拾っている可能性があるので、目で確かめてから URL を入れてください。</p>
            <div className="mt-2"><Button variant="secondary" onClick={() => setMismatchOpen(true)}>確認する（{mismatches.length}件）</Button></div>
          </Note>
        )}
        {pendingListeners.length > 0 && (
          <details className="text-xs" style={{ color: "var(--text-secondary)" }}>
            <summary className="cursor-pointer">月間リスナー数が保留になった {pendingListeners.length}件</summary>
            <ul className="mt-1 flex flex-col gap-0.5">
              {pendingListeners.map((p) => <li key={p.row}>行{p.row} {p.artist}：{p.note}</li>)}
            </ul>
          </details>
        )}
      </StepCard>

      {/* 4. 振り分け */}
      <StepCard
        no={4}
        title="採用・掲載を振り分ける（シート）"
        when="金曜の夕方まで"
        done={total > 0 && decided === total ? true : total > 0 ? `${decided}/${total}件 決定` : undefined}
        why={<>
          <p>WEEK列の値で投稿画像の中身が決まります。「採用」は1枚1作品で紹介するメイン（目安は洋楽4＋邦楽1の5枚）、「掲載」は最後の Other Releases に文字で並べる作品（20件前後）、「不採用」は載せない作品です。</p>
          <p>リスナー数やプレイリスト収録タグは、話題性の目安として使えます。</p>
        </>}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Release Master の <b style={{ color: "var(--text-primary)" }}>WEEK列</b> に「採用」「掲載」「不採用」を入れていきます。下の一覧は確認用です（ここでは編集できません）。
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer"
              className="px-4 py-2 rounded-xl text-sm font-semibold border"
              style={{ backgroundColor: "rgba(96,165,250,0.15)", borderColor: ACCENT, color: ACCENT }}>
              Release Master を開く（今週の行へ）
            </a>
          )}
          <Button variant="secondary" onClick={loadStatus}>一覧を再読み込み</Button>
          <span className="text-xs" style={{ color: adopted === 5 ? OK : "var(--text-secondary)" }}>採用 {adopted}/5・掲載 {listed}</span>
        </div>
        {missingNo.length > 0 && (
          <Note tone="warn">
            行{missingNo.map((r) => r.rowNum).join("・")} は A列（No.）が空のため、アプリと画像ジェネレーターに表示されません。シートのA列に <code>=ROW()-1</code> を入れてください。
          </Note>
        )}
        {rows && rows.length > 0 && (
          <div className="flex flex-col rounded-xl border divide-y" style={{ borderColor: "var(--border-subtle)" }}>
            {rows.map((r) => (
              <div key={r.rowNum} className="flex items-center gap-3 px-3 py-2" style={{ borderColor: "var(--border-subtle)" }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" style={{ color: "var(--text-primary)" }}>{r.title}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--text-secondary)" }}>
                    {r.artist}・{r.waboku || "洋邦未入力"}{r.time ? `・${r.time}` : ""}
                  </span>
                  {r.playlists && <span className="block truncate text-[11px]" style={{ color: ACCENT }}>{r.playlists}</span>}
                </span>
                <span className="flex flex-col items-end gap-1 flex-shrink-0 text-xs">
                  <span style={{ color: "var(--text-secondary)" }}>{formatListeners(r.listeners)}</span>
                  {r.week
                    ? <Badge color={r.week === "採用" ? OK : r.week === "掲載" ? ACCENT : "var(--text-secondary)"}>{r.week}</Badge>
                    : <Badge color={WARN}>未決定</Badge>}
                  {!r.spotifyUrl && <Badge>URLなし</Badge>}
                </span>
              </div>
            ))}
          </div>
        )}
      </StepCard>

      {/* 5. 画像 */}
      <StepCard
        no={5}
        title="投稿画像を作る"
        when="振り分けが終わったら（19時の投稿まで）"
        why={<p>ジェネレーターは WEEK列の「採用」をメインの5枚、「掲載」を Other Releases として読み込みます。振り分けを後から直した場合は、ジェネレーターの「Release Masterから再取得」で反映できます。</p>}
      >
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          画像ジェネレーターで <b style={{ color: "var(--text-primary)" }}>Weekly Review</b> を選び、対象週に <b style={{ color: "var(--text-primary)" }}>{friday}</b>（金曜日）を指定して作成します。表紙を含む7枚ができます。
        </p>
        <div>
          <Link href="/generator" className="inline-block px-4 py-2 rounded-xl text-sm font-semibold border"
            style={{ backgroundColor: "rgba(96,165,250,0.15)", borderColor: ACCENT, color: ACCENT }}>
            画像ジェネレーターを開く
          </Link>
        </div>
      </StepCard>

      {mismatchOpen && mismatches.length > 0 && (
        <MismatchQueueModal mismatches={mismatches} onClose={() => { setMismatchOpen(false); loadStatus(); }} />
      )}
    </div>
  );
}
