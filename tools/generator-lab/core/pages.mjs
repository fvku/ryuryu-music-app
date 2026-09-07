// ============================================================
// pages.js — 絞り込み・ソート・ページ組み・帯の組み立て（SPEC.md §7.5）
//
// ここに入るのは**全部が純関数**。DOM も canvas も fetch も触らない。
// そのため node からそのまま require してテストできる（`node test/pages_test.js`）。
//
// 用語（SPEC.md §7.5「データモデル」）:
//   Album … API のレスポンス1件を正規化したもの。不変
//   Slot  … アルバム1件ぶんの表示単位。編集された値（fields）と「出す／出さない」（show）を持つ
//   Page  … 書き出す画像1枚。採用は Slot 1つ、掲載は Slot 2つ（SPEC.md §4・§7）
// ============================================================
const Pages = (() => {

  // ---- Release Master の値の対応（SPEC.md §10「Release Master の列対応」）----
  const ADOPTION = {
    monthly: { '採用': 'adopted', '掲載': 'listed' },
    japan:   { 'J採用': 'adopted', 'J掲載': 'listed' },
  };

  /** `mjAdoption` の値を枠の種別に写す。対象外（不採用・空欄・企画違い）は null */
  function groupOf(adoption, program) {
    const table = ADOPTION[program];
    return (table && table[String(adoption || '').trim()]) || null;
  }

  // ---- 日付 ----
  // Date 列は表記ゆれがありうるので数字だけ拾う（measure/check_api.js と同じ方針）
  function yearMonth(date) {
    const m = String(date || '').match(/(\d{4})\D+(\d{1,2})/);
    return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}` : '';
  }
  /** ソート用の数値キー。20260815 の形。読めない日付は最後に送る（先頭に紛れ込ませない） */
  function dateKey(date) {
    const m = String(date || '').match(/(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?/);
    if (!m) return Infinity;
    return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0);
  }

  // ---- EP ----
  // Release Master の Title は `[EP] foo` の形で EP を注記している。
  // 並び順ではグループ末尾に送る材料に使い（SPEC.md §7）、描画する作品名からは外す。
  // 外すだけで隠さないよう、エディタ側はページ一覧に EP のしるしを出す（SPEC.md §7.5）。
  const EP_RE = /^\s*[\[［]\s*ep\s*[\]］]\s*/i;
  function isEP(album)  { return EP_RE.test(String((album && album.title) || '')); }
  function stripEP(title) { return String(title || '').replace(EP_RE, ''); }

  /**
   * グループ内のソート（SPEC.md §7「並び順」）
   *   1. リリース日 昇順
   *   2. 同日はアーティスト名の a–z
   *   3. EP はグループの末尾
   *
   * アーティスト名は toLowerCase() した文字コード順で比べる。localeCompare を使うと
   * 環境によって和文の並びが変わり、§7 が受け入れた「欧文 → ひらがな → カタカナ → 漢字」から外れる。
   * あいうえお順は取らない（読み仮名を持たないデータでは機械的に決められないため）。
   */
  function sortGroup(albums) {
    const key = a => String(a.artist || '').toLowerCase();
    return albums.slice().sort((a, b) => {
      const ep = (isEP(a) ? 1 : 0) - (isEP(b) ? 1 : 0);
      if (ep) return ep;
      const d = dateKey(a.date) - dateKey(b.date);
      if (d) return d;
      const ka = key(a), kb = key(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  }

  // ---- 正規化 ----
  /** API のレスポンス1件 → Album（SPEC.md §7「データの取得元」のレスポンス形） */
  function normalize(raw, program) {
    return {
      raw,
      date:          raw.date || '',
      title:         raw.title || '',
      artist:        raw.artist || '',
      duration:      raw.duration || '',
      genreMemo:     raw.genreMemo || '',
      country:       raw.country || '',
      trackNo:       raw.mjTrackNo || '',
      track:         raw.mjTrack || '',
      text:          raw.mjText || '',
      coverUrlLarge: raw.coverUrlLarge || '',
      coverUrl:      raw.coverUrl || '',
      adoption:      raw.mjAdoption || '',
      group:         groupOf(raw.mjAdoption, program),
    };
  }

  /** 取得した全件から、その月・その企画の採用/掲載だけを取り出す */
  function selectAlbums(raws, month, program) {
    return (raws || [])
      .map(r => normalize(r, program))
      .filter(a => a.group && (!month || yearMonth(a.date) === month));
  }

  /** 取得した全件に現れる年月（新しい順）。月セレクトの選択肢はこれで作る。ハードコードしない */
  function monthsIn(raws) {
    const set = new Set((raws || []).map(r => yearMonth(r.date)).filter(Boolean));
    return [...set].sort().reverse();
  }

  // ---- Slot ----
  /**
   * Album から Slot を作る。
   * fields は取得値のコピー。**編集はここだけを触り、album は書き換えない。**
   * これで「自動取得した値」と「人が直した値」が常に区別でき、黄色マスキングの判定も機械的に決まる。
   */
  function makeSlot(album, program) {
    return {
      album,
      fields: {
        title:     stripEP(album.title),
        artist:    album.artist,
        duration:  album.duration,
        genreMemo: album.genreMemo,
        country:   album.country,
        trackNo:   album.trackNo,
        track:     album.track,
        text:      album.text,
      },
      // 帯の項目ごとの「出す／出さない」。Japan の 国 は既定で出さない（SPEC.md §7）。
      // 既定で出すと全ページが黄色になって警告として機能しなくなる。
      show: {
        title: true,
        artist: true,
        duration:  true,
        genreMemo: true,
        country:   program !== 'japan',
        track:     true,
      },
      jacket: { img: null, source: null, error: null },
      // 背景の色の面。**画像ごとに人が決める**（ジャケットからスポイドで拾い、彩度・明度を調整する。
      // SPEC.md §6、2026-09-04 Kohei の指示）。自動抽出はしない。null なら背景を描かない。
      // 掲載枠は1画像に2件入るが背景は1つなので、そのページの**上の Slot** の色を使う。
      bgColor: null,
      // 本文の字間（em）。**ページごとに人が決める判断**（SPEC.md §5）。
      // tracking は本文全体、kerns は文字ごと（文字の位置 → 詰め量）。Figma の
      // 「範囲を選んで手でカーニング」に対応する。どちらも 0 なら Figma の既定と同じ。
      tracking: 0,
      kerns: {},
      bodyLeadMode: 'auto',
      bodyMaxLead: 42,
      typography: {},
    };
  }

  /** 採用/掲載それぞれをソートして Slot にする。**並び順の正はこの2本の配列**（ページは下で導出する） */
  function makeGroups(albums, program) {
    const of = g => sortGroup(albums.filter(a => a.group === g)).map(a => makeSlot(a, program));
    return { adopted: of('adopted'), listed: of('listed') };
  }

  /**
   * Slot の並びからページを組む（SPEC.md §7「ページ構成」）。
   *   採用 … 1ページに1件
   *   掲載 … 1ページに2件（端数が出たら最後のページは1件。運用では起きない前提の安全弁）
   *   no  … 投稿内の掲載順。**2 から始まる**（表紙のぶんの 1 は常に空ける）
   *
   * Slot は参照のまま持つので、並べ替えてページを組み直しても編集内容は付いて回る。
   */
  function paginate(groups) {
    const pages = [];
    let no = 2;
    for (const slot of groups.adopted) pages.push({ kind: 'adopted', slots: [slot], no: no++ });
    for (let i = 0; i < groups.listed.length; i += 2) {
      const slots = groups.listed.slice(i, i + 2);
      pages.push({ kind: 'listed', slots, no: no++ });
    }
    return pages;
  }

  /** グループ内で1つ動かす。グループを跨いだ移動はしない（SPEC.md §7） */
  function move(groups, group, index, delta) {
    const list = groups[group];
    const to = index + delta;
    if (!list || index < 0 || index >= list.length || to < 0 || to >= list.length) return false;
    [list[index], list[to]] = [list[to], list[index]];
    return true;
  }

  /** ファイル名（SPEC.md §7「ファイル名・並び順」）。monthly_26_08_02 */
  function filenameOf(page, program, month) {
    const m = String(month || '').match(/(\d{4})-(\d{2})/);
    const yy = m ? m[1].slice(2) : '00';
    const mm = m ? m[2] : '00';
    return `${program}_${yy}_${mm}_${String(page.no).padStart(2, '0')}`;
  }

  // ---- 帯 ----
  // SPEC.md §7「項目を『出さない』選択と、書き出し時の中黒」を、両方の帯に効く1つの規則にした。
  //   fixed … 落とさない（recommend）
  //   value … 空なら落とす
  //   sep   … value が落ちた結果、先頭・末尾に来たものと sep が隣接したものを落とす
  function compactBand(segs) {
    const kept = segs.filter(s => s.kind !== 'value' || String(s.text == null ? '' : s.text).trim() !== '');
    const out = [];
    for (let i = 0; i < kept.length; i++) {
      const s = kept[i];
      if (s.kind === 'sep') {
        const prev = out[out.length - 1];
        if (!prev || prev.kind === 'sep') continue;                    // 先頭・sep隣接
        let hasAfter = false;
        for (let j = i + 1; j < kept.length; j++) if (kept[j].kind !== 'sep') { hasAfter = true; break; }
        if (!hasAfter) continue;                                       // 末尾
      }
      out.push(s);
    }
    return out;
  }

  const val = (on, text, cs, key, prefix) => ({ text: on ? text : '', case: cs, kind: 'value', ...(key ? { key } : {}), ...(prefix ? { prefix } : {}) });

  /** メタ帯。中黒は全角の「・」（U+30FB）。Oswald に無く和文へフォールバックする（SPEC.md §5） */
  function metaBand(slot) {
    const f = slot.fields, s = slot.show;
    return compactBand([
      val(s.duration,  f.duration,  'UPPER', 'duration'),
      { text: '・', case: 'ORIGINAL', kind: 'sep' },
      val(s.genreMemo, f.genreMemo, 'UPPER', 'genreMemo'),
      { text: '・', case: 'ORIGINAL', kind: 'sep' },
      val(s.country,   f.country,   'UPPER', 'country'),
    ]);
  }

  /**
   * RECOMMEND帯。`M Number` 列は数字だけで入っているので `M6` への整形はツール側の仕事（SPEC.md §7）。
   * show.track は M番号と曲名の両方を支配する（「M6」だけ出す使い方は無いため1つに束ねた。§7.5）。
   */
  function recBand(slot) {
    const f = slot.fields, s = slot.show;
    const no = String(f.trackNo == null ? '' : f.trackNo).trim().replace(/^m/i, '');
    return compactBand([
      { text: 'recommend', case: 'UPPER', kind: 'fixed' },
      { text: '-', case: 'ORIGINAL', kind: 'sep' },
      val(s.track && no, 'M' + no, 'UPPER', 'trackNo', 1),
      val(s.track, f.track, 'ORIGINAL', 'track'),
    ]);
  }

  /** Slot → Render.draw に渡す形（SPEC.md §7.5「render.js の分岐」） */
  function toDrawData(slot) {
    return {
      title:  slot.show.title === false ? '' : slot.fields.title,
      artist: slot.show.artist === false ? '' : slot.fields.artist,
      meta:   metaBand(slot),
      body:   slot.fields.text,
      tracking: slot.tracking || 0,
      kerns: slot.kerns || null,
      bodyLeadMode: slot.bodyLeadMode || 'auto',
      bodyMaxLead: slot.bodyMaxLead,
      typography: slot.typography || {},
      rec:    recBand(slot),
    };
  }

  // ---- 黄色マスキング（SPEC.md §7「欠けているデータを見えるようにする」）----
  // 黄色にする ⟺ show[k] が true かつ fields[k] が空 かつ その項目が自動取得の対象
  // 「出さない」に切り替えた項目は show[k] が false なので黄色にならない。
  // 書き出しの挙動は両者で同じ（空の項目ごと飛ばす）。違うのは警告を出すかだけ。
  const AUTO_FIELDS = ['title', 'artist', 'duration', 'genreMemo', 'country', 'trackNo', 'track', 'text'];
  const SHOW_OF = { duration: 'duration', genreMemo: 'genreMemo', country: 'country', trackNo: 'track', track: 'track' };

  function isMissing(slot, key, opts) {
    if (!AUTO_FIELDS.includes(key)) return false;
    // 掲載枠に評価文は入らない（SPEC.md §4）。空でも警告しない
    if (key === 'text' && opts && opts.kind === 'listed') return false;
    const showKey = SHOW_OF[key];
    if (showKey && !slot.show[showKey]) return false;
    return String(slot.fields[key] == null ? '' : slot.fields[key]).trim() === '';
  }

  return {
    groupOf, yearMonth, dateKey, isEP, stripEP, sortGroup,
    normalize, selectAlbums, monthsIn,
    makeSlot, makeGroups, paginate, move, filenameOf,
    compactBand, metaBand, recBand, toDrawData, isMissing,
    AUTO_FIELDS,
  };
})();

export default Pages;
