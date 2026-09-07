import { DRAFT_SCOPE, validatePackage } from './draft-model.mjs';

// Each page load/editing branch gets its own ID. Two tabs never overwrite each
// other's draft. No expiry/deletion and no server/account data in this lab DB.
export function openDraftStore(factory = globalThis.indexedDB, name = 'ryuryu-generator-lab-drafts') {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('このブラウザでは下書き保存を利用できません。')); return; }
    const request = factory.open(name, 1);
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('別のタブを閉じてから再読み込みしてください。')); };
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('summaries', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      function transaction(stores, mode, action) {
        return new Promise((done, fail) => {
          const tx = db.transaction(stores, mode);
          let result;
          tx.oncomplete = () => done(result?.result);
          tx.onabort = () => fail(tx.error || new Error('下書き保存が中断されました。'));
          tx.onerror = () => {}; // abort handles transaction failure, not request success
          try { result = action(tx); } catch (error) { tx.abort(); fail(error); }
        });
      }
      resolve({
        async save(id, value) {
          const data = validatePackage(value);
          const updatedAt = new Date().toISOString();
          const summary = { id, scope: DRAFT_SCOPE, updatedAt,
            title: data.document.pages[data.document.ui.mode].slots[0].fields.title.slice(0, 80) };
          await transaction(['drafts', 'summaries'], 'readwrite', tx => {
            tx.objectStore('drafts').put({ id, ...data });
            tx.objectStore('summaries').put(summary);
          });
          return summary;
        },
        async list() {
          const records = await transaction(['summaries'], 'readonly', tx => tx.objectStore('summaries').getAll());
          return records.filter(record => record.scope === DRAFT_SCOPE).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },
        async load(id) {
          const record = await transaction(['drafts'], 'readonly', tx => tx.objectStore('drafts').get(id));
          if (!record) throw new Error('下書きが見つかりません。');
          return validatePackage(record);
        },
        close: () => db.close(),
      });
    };
  });
}

// Single in-flight save, newest pending snapshot wins. A stale success cannot
// mark newer input saved. Failed snapshots stay pending until an explicit retry.
export function createDraftWriter({ capture, save, onState = () => {} }) {
  let revision = 0, savedRevision = 0, running = null;
  async function drain() {
    while (savedRevision !== revision) {
      const version = revision;
      onState({ state: 'saving', version });
      try {
        const result = await save(capture());
        savedRevision = version;
        onState({ state: version === revision ? 'saved' : 'pending', result, version });
      } catch (error) {
        onState({ state: 'error', error, version });
        return false;
      }
    }
    return true;
  }
  return {
    changed() { revision++; onState({ state: 'pending', version: revision }); },
    flush() {
      if (!running) running = drain().finally(() => { running = null; });
      return running;
    },
    get dirty() { return savedRevision !== revision; },
  };
}
