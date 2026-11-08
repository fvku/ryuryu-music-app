"use client";

import { useEffect, useRef, useState } from "react";
import type { CanvasPreviewPage } from "@/lib/generator/canvas-preview";
import { effectiveRange, FADE_IN_SECONDS, FADE_OUT_SECONDS, formatClock, parseClock, snapTenth, VIDEO_MAX_SECONDS, VIDEO_MIN_SECONDS } from "@/lib/generator/video";
import type { DecodedAudio, MusicApi } from "./music-store";
import MusicWaveform from "./MusicWaveform";
import { Checkbox, SecondaryButton } from "./ui";

/** 数値欄。入力途中は自由に打たせ、Blur／Enterで確定する（字間・行送りと同じ操作）。 */
function NumberField({ label, value, format, parse, onCommit, suffix, width }: {
  label: string; value: number; format(value: number): string; parse(text: string): number | null;
  onCommit(value: number): void; suffix?: string; width: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parse(draft);
    setDraft(null);
    if (parsed !== null) onCommit(parsed);
  };
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <input
        value={draft ?? format(value)}
        inputMode="decimal"
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }}
        className={`min-h-9 rounded-lg border bg-black/20 px-2 text-right text-base tabular-nums text-white ${width}`}
        style={{ borderColor: "var(--border-subtle)" }}
        aria-label={label}
      />
      {suffix && <span style={{ color: "var(--text-secondary)" }}>{suffix}</span>}
    </label>
  );
}

type Decoded = { itemId: string; blob: Blob; audio: DecodedAudio } | { itemId: string; blob: Blob; error: string };

/**
 * 右パネルの「音楽」タブ。その画像の動画に使う曲・範囲・フェードを決める。
 * 2026-11-08〜 画像と同じく共有する：変更は下書きになり、下端の「保存」で作品・背景色と一緒に確定する。
 * 音声ファイルは選んだ時点でアップロードする（作品のロックが必要。編集できない画像ではこのタブ自体を出さない）。
 */
export default function MusicPanel({ page, music }: { page: CanvasPreviewPage; music: MusicApi }) {
  const itemId = music.choice(page);
  const slot = page.slots.find(value => value.id === itemId) ?? page.slots[0];
  const sound = music.audio(itemId);
  const entry = sound.entry;
  const listed = page.slots.length > 1;

  // 共有の音声がまだ端末に無ければ読み込む。
  useEffect(() => { if (sound.kind === "loading") music.fetchAudio(itemId); }, [sound.kind, itemId, music]);

  // 音声の読み込み（波形・長さ）。ファイルが変わったら読み直す。
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    music.decode(itemId)
      .then(audio => { if (!cancelled) setDecoded(prev => (prev && "audio" in prev && prev.audio === audio ? prev : { itemId, blob: entry.blob, audio })); })
      .catch(() => { if (!cancelled) setDecoded({ itemId, blob: entry.blob, error: "この音声ファイルを読み込めませんでした。mp3・m4a・wav・aif のどれかで選び直してください（Apple Musicでダウンロードした曲はコピー防止のため読み込めません）。" }); });
    return () => { cancelled = true; };
  }, [entry, itemId, music]);
  const current = entry && decoded && decoded.itemId === itemId && decoded.blob === entry.blob ? decoded : null;
  const audio = current && "audio" in current ? current.audio : null;
  const decodeError = current && "error" in current ? current.error : null;
  const trackSeconds = audio?.buffer.duration ?? null;

  const preference = music.preference(itemId);
  const range = effectiveRange(preference, trackSeconds);
  const sheetStart = music.sheetStart(itemId);

  // 試聴。範囲の試聴は書き出しと同じフェードで、波形を押したときはその位置から曲の終わりまで鳴らす。
  const playRef = useRef<{ source: AudioBufferSourceNode; startedAt: number; from: number } | null>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [rangePlaying, setRangePlaying] = useState(false);
  function stop() {
    const playing = playRef.current;
    playRef.current = null;
    if (playing) { playing.source.onended = null; try { playing.source.stop(); } catch { /* 既に止まっている */ } }
    setPlayhead(null);
    setRangePlaying(false);
  }
  function play(from: number, withRange: boolean) {
    if (!audio) return;
    stop();
    const context = music.audioContext();
    void context.resume();
    const source = context.createBufferSource(), gain = context.createGain(), now = context.currentTime;
    source.buffer = audio.buffer;
    const duration = withRange ? range.length : undefined;
    gain.gain.setValueAtTime(withRange && preference.fadeIn ? 0 : 1, now);
    if (withRange && preference.fadeIn) gain.gain.linearRampToValueAtTime(1, now + Math.min(FADE_IN_SECONDS, range.length));
    if (withRange && preference.fadeOut) {
      gain.gain.setValueAtTime(1, now + Math.max(0, range.length - FADE_OUT_SECONDS));
      gain.gain.linearRampToValueAtTime(0, now + range.length);
    }
    source.connect(gain).connect(context.destination);
    source.start(now, from, duration);
    source.onended = () => { if (playRef.current?.source === source) stop(); };
    playRef.current = { source, startedAt: now, from };
    setPlayhead(from);
    setRangePlaying(withRange);
  }
  const playing = playhead !== null;
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const value = playRef.current;
      if (!value) return;
      setPlayhead(value.from + (music.audioContext().currentTime - value.startedAt));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, music]);
  // 画像・曲を切り替えたら止める
  useEffect(() => () => stop(), [itemId, page.id]);

  const fileRef = useRef<HTMLInputElement>(null);
  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    stop();
    await music.setAudio(itemId, file);
  }
  const local = sound.kind === "local" ? sound.local : null;
  const sending = local?.phase === "preparing" || local?.phase === "uploading";
  const fileState = local
    ? local.phase === "preparing" ? { text: "音声を確かめています…（WAV・AIF は AAC に変換します）", tone: "muted" }
      : local.phase === "uploading" ? { text: `アップロードしています… ${Math.round(local.progress * 100)}%`, tone: "muted" }
        : local.phase === "failed" ? { text: local.error || "アップロードできませんでした。", tone: "error" }
          : { text: "まだ共有していません。「保存」のときにアップロードします。", tone: "warn" }
    : sound.kind === "loading" ? { text: "共有の音声を読み込んでいます…", tone: "muted" }
      : sound.kind === "error" ? { text: sound.error, tone: "error" }
        : null;

  const sheetLabel = music.startTimes === null ? "Release Master を読み込んでいます…"
    : music.edited(itemId) ? `手で変えました（Release Master は ${sheetStart === null ? "空欄" : formatClock(sheetStart)}）`
      : sheetStart === null
        ? (music.startTimesError ? `Start Time を読めませんでした（${music.startTimesError}）。0:00 から始めます` : "Release Master の Start Time が空なので 0:00 から始めます")
        : `開始は Release Master の Start Time（${formatClock(sheetStart)}）`;
  const trackLabel = (id: string, fallbackNo: string, fallbackTrack: string) => {
    const hit = music.startTimes?.[id];
    return [hit?.trackNo || fallbackNo, hit?.track || fallbackTrack].filter(Boolean).join(". ");
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>{listed ? "曲（上下どちらかの作品）" : "曲"}</h3>
        <div className={`grid gap-1.5 ${listed ? "grid-cols-2" : "grid-cols-1"}`}>
          {page.slots.map((value, index) => {
            const active = value.id === itemId, hasAudio = music.audio(value.id).kind !== "none";
            const label = trackLabel(value.id, value.fields.trackNo, value.fields.track);
            return (
              <button
                key={value.id}
                type="button"
                onClick={() => { if (!active) { stop(); music.setChoice(page.id, value.id); } }}
                aria-pressed={active}
                disabled={!listed}
                className="min-h-11 rounded-xl border px-3 py-2 text-left text-sm transition enabled:hover:bg-white/5"
                style={{ borderColor: active ? "var(--accent)" : "var(--border-subtle)", backgroundColor: active ? "rgba(139,92,246,.16)" : "transparent", boxShadow: active && listed ? "inset 0 0 0 1px var(--accent)" : undefined }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{listed ? `${index === 0 ? "上" : "下"} · ` : ""}{value.fields.title || "（作品名未入力）"}</span>
                  {hasAudio && <span className="shrink-0 text-[11px] text-emerald-300" title="音声ファイルあり">♪</span>}
                </span>
                <span className="block truncate text-xs" style={{ color: "var(--text-secondary)" }}>{label || "おすすめ曲 未入力"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>音声ファイル</h3>
        <div className="flex flex-wrap items-center gap-2">
          <SecondaryButton className="!min-h-9 px-3 text-xs" disabled={sending || !music.editable} onClick={() => fileRef.current?.click()}>
            {sending ? "送信中…" : sound.kind === "none" ? "ファイルを選ぶ" : "差し替える"}
          </SecondaryButton>
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav,.aac,.aif,.aiff" className="hidden" onChange={event => void onFile(event.target.files?.[0])} />
          <span className="min-w-0 flex-1 truncate text-sm" style={{ color: entry ? "var(--text-primary)" : "var(--text-secondary)" }}>
            {entry ? `${entry.name}${trackSeconds ? ` · ${formatClock(trackSeconds)}` : ""}` : "未選択（m4a・mp3・wav）"}
          </span>
          {sound.kind !== "none" && !sending && music.editable && (
            <button type="button" className="text-[11px] underline decoration-dotted underline-offset-2" style={{ color: "var(--text-secondary)" }} onClick={() => { stop(); music.removeAudio(itemId); }}>
              外す
            </button>
          )}
        </div>
        {local?.phase === "uploading" && (
          <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.round(local.progress * 100)}%`, backgroundColor: "var(--accent)" }} />
          </div>
        )}
        {fileState && (
          <p className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: fileState.tone === "error" ? "#fda4af" : fileState.tone === "warn" ? "#fcd34d" : "var(--text-secondary)" }}>
            <span>{fileState.text}</span>
            {local && (local.phase === "failed" || local.phase === "waiting") && music.editable && (
              <button type="button" className="underline decoration-dotted underline-offset-2" onClick={() => music.retryUpload(itemId)}>いま送る</button>
            )}
          </p>
        )}
        {decodeError && <p className="text-xs" style={{ color: "#fda4af" }}>{decodeError}</p>}
        <p className="text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
          選んだ音声はアップロードし、下の「保存」でほかのメンバーにも共有します。MP3・m4a はそのまま、WAV・AIF は AAC（256kbps）に変換して送ります。50MBまで。
        </p>
      </section>

      <section className={`space-y-2 ${audio ? "" : "pointer-events-none opacity-40"}`}>
        <h3 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>範囲</h3>
        <MusicWaveform
          peaks={audio?.peaks ?? null}
          duration={trackSeconds}
          range={range}
          playhead={playhead}
          disabled={!audio}
          onChange={next => { if (rangePlaying) stop(); music.update(itemId, { start: next.start, length: next.length }); }}
          onPlayFrom={seconds => play(seconds, false)}
        />
        <p className="text-[11px] leading-4" style={{ color: "var(--text-secondary)" }}>
          紫の範囲をドラッグで移動、両端で長さを調整（Shiftを押しながらで細かく）。波形を押すと、その位置から試聴します。← → で0.1秒ずつ動かせます。
        </p>
      </section>

      <section className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <NumberField
            label="開始"
            value={range.start}
            format={value => formatClock(value, true)}
            parse={parseClock}
            width="w-20"
            onCommit={value => { stop(); music.update(itemId, { start: snapTenth(Math.max(0, value)) }); }}
          />
          <NumberField
            label="長さ"
            value={preference.length}
            format={value => String(snapTenth(value))}
            parse={text => { const value = Number(text.trim()); return text.trim() && Number.isFinite(value) ? Math.min(VIDEO_MAX_SECONDS, Math.max(VIDEO_MIN_SECONDS, snapTenth(value))) : null; }}
            suffix="秒"
            width="w-16"
            onCommit={value => { stop(); music.update(itemId, { length: value }); }}
          />
          <span className="text-sm tabular-nums" style={{ color: "var(--text-secondary)" }}>→ 終了 {formatClock(range.start + range.length, true)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <SecondaryButton className="!min-h-9 px-3 text-xs" disabled={!audio} onClick={() => (playing ? stop() : play(range.start, true))}>
            {playing ? "■ 停止" : "▶ 範囲を試聴"}
          </SecondaryButton>
          {playing && <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>{formatClock(playhead ?? 0, true)}{rangePlaying ? "（範囲）" : ""}</span>}
        </div>
        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{sheetLabel}</p>
        <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>長さは最大 {VIDEO_MAX_SECONDS} 秒（Instagramのフィードは60秒未満）。</p>
        {range.trimmed && trackSeconds && (
          <p className="text-xs" style={{ color: "#fcd34d" }}>曲の終わり（{formatClock(trackSeconds)}）で止まるため、動画は {snapTenth(range.length)} 秒になります。</p>
        )}
        {music.edited(itemId) && (
          <button type="button" className="text-xs underline decoration-dotted underline-offset-2" style={{ color: "var(--text-secondary)" }} onClick={() => { stop(); music.reset(itemId); }}>
            Release Master の値に戻す
          </button>
        )}
      </section>

      <section className="flex flex-wrap gap-x-5 border-t pt-3" style={{ borderColor: "var(--border-subtle)" }}>
        <Checkbox label={`頭をフェードイン（${FADE_IN_SECONDS}秒）`} checked={preference.fadeIn} onChange={event => music.update(itemId, { fadeIn: event.target.checked })} />
        <Checkbox label={`終わりをフェードアウト（${FADE_OUT_SECONDS}秒）`} checked={preference.fadeOut} onChange={event => music.update(itemId, { fadeOut: event.target.checked })} />
      </section>

      {slot && !entry && (
        <p className="text-xs" style={{ color: "#fcd34d" }}>この画像はまだ動画にできません。「{slot.fields.title}」の音声ファイルを選んでください。</p>
      )}
    </div>
  );
}
