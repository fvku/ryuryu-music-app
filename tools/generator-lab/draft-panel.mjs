import { openDraftStore, createDraftWriter } from './draft-store.mjs';

export async function createDraftPanel({ capture, restore, setBusy }) {
  const $ = id => document.getElementById(id);
  const status = $('draft-status'), select = $('draft-list');
  let draftId = crypto.randomUUID(), timer, deadline, working = false;
  let store;
  const report = (text, error = false) => {
    status.textContent = text; status.classList.toggle('error', error);
  };
  const unavailable = 'このブラウザ内に保存できません。容量・プライベートモード・保存設定を確認してください。共有保存もされていません。';
  try { store = await openDraftStore(); }
  catch {
    report(unavailable, true);
    return { changed() {}, flush: async () => false, get dirty() { return true; } };
  }
  async function refresh() {
    const records = await store.list();
    const previous = select.value;
    select.replaceChildren();
    for (const record of records.filter(record => record.id !== draftId)) {
      const option = document.createElement('option'); option.value = record.id;
      option.textContent = `${new Date(record.updatedAt).toLocaleString('ja-JP')} · ${record.title || '無題'}`;
      select.append(option);
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    if (!select.options.length) {
      const option = document.createElement('option'); option.textContent = '復元できる別の下書きはありません'; option.value = '';
      select.append(option);
    }
    select.disabled = !select.value || working;
    $('restore-draft').disabled = !select.value || working;
    return records.filter(record => record.id !== draftId).length;
  }
  const writer = createDraftWriter({ capture, save: value => store.save(draftId, value), onState(event) {
    if (event.state === 'pending') report('変更あり · このブラウザ内に未保存（共有保存なし）');
    if (event.state === 'saving') report('このブラウザ内に下書きを保存しています…');
    if (event.state === 'saved') report(`このブラウザ内に保存済み · ${new Date(event.result.updatedAt).toLocaleTimeString('ja-JP')}（共有保存なし）`);
    if (event.state === 'error') report(unavailable, true);
  } });
  function flush() { clearTimeout(timer); clearTimeout(deadline); deadline = null; return writer.flush(); }
  function changed() {
    writer.changed(); clearTimeout(timer);
    timer = setTimeout(flush, 500);
    deadline ??= setTimeout(flush, 2000);
  }
  $('save-draft').disabled = false;
  $('save-draft').addEventListener('click', () => { writer.changed(); void flush(); });
  $('refresh-drafts').disabled = false;
  $('refresh-drafts').addEventListener('click', () => refresh().catch(() => report(unavailable, true)));
  $('restore-draft').addEventListener('click', async () => {
    if (!select.value || working) return;
    const selectedId = select.value;
    working = true; setBusy(true);
    for (const id of ['restore-draft', 'save-draft', 'refresh-drafts', 'draft-list']) $(id).disabled = true;
    try {
      // Leave the current draft intact; restoration starts a new branch.
      if (!await flush()) throw new Error('現在の入力を保存できなかったため、復元を中止しました。');
      const value = await store.load(selectedId);
      await restore(value);
      draftId = crypto.randomUUID();
      writer.changed();
      await flush();
    } catch (error) { report(`復元できませんでした。${error.message}`, true); }
    finally {
      working = false; setBusy(false);
      $('save-draft').disabled = false; $('refresh-drafts').disabled = false;
      await refresh().catch(() => report(unavailable, true));
    }
  });
  report('このブラウザ内の下書き保存が利用できます（共有保存なし）');
  await refresh().then(count => {
    if (count && !writer.dirty) report(`以前の下書きが${count}件あります。ここを開いて選択・復元できます（共有保存なし）。`);
  }).catch(() => report('下書き一覧を読み込めません。「一覧を更新」で再試行してください。', true));
  return { changed, flush, get dirty() { return writer.dirty; } };
}
