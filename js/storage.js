/* Data layer: Firebase Firestore (cloud sync) with an automatic localStorage cache and offline fallback.
   Submissions are saved locally first, then pushed to Firestore. Anything that cannot be pushed is queued
   and retried automatically (on load, when the browser comes back online, and when the dashboard opens). */
const Storage = (() => {
  const KEY = 'elp_attempts_v1', PEND = 'elp_pending_v1';
  const COL = (typeof FIREBASE_COLLECTION !== 'undefined' && FIREBASE_COLLECTION) || 'attempts';
  const TIMEOUT = 8000, AUDIO_TIMEOUT = 25000, MAX_AUDIO = 900000;   /* Firestore documents are limited to 1 MB */
  const audioMem = {};
  const listeners = [];
  let db = null, mode = 'local', lastError = '';

  const configured = typeof firebaseConfig !== 'undefined' && !!firebaseConfig && !!firebaseConfig.apiKey && !!firebaseConfig.projectId &&
    !/^YOUR_/.test(firebaseConfig.apiKey) && !/^YOUR_/.test(firebaseConfig.projectId);

  const rd = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const wr = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const readLocal = () => rd(KEY, []);
  const writeLocal = (list) => {
    try { wr(KEY, list); return true; } catch (e) {
      const slim = list.map(a => Object.assign({}, a, { answers: a.answers.map(x => Object.assign({}, x, { audio: null })) }));
      try { wr(KEY, slim); return true; } catch (e2) { return false; }
    }
  };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms || TIMEOUT))]);

  function status() {
    const label = mode === 'cloud' ? 'Cloud Sync active' : mode === 'offline' ? 'Local fallback mode' : 'Local demo mode';
    return { mode, label, pending: rd(PEND, []).length, configured, error: lastError };
  }
  function setMode(m, e) { mode = m; if (e) lastError = String(e.code || e.message || e); else if (m === 'cloud') lastError = ''; listeners.forEach(f => f(status())); }
  function onStatus(f) { listeners.push(f); }
  function queue(id) { const p = rd(PEND, []); if (!p.includes(id)) { p.push(id); wr(PEND, p); } }

  /* Firestore copy of an attempt: audio is stored separately (attempts/{id}/audio/{qid}), never inside the main document. */
  function strip(a) {
    return JSON.parse(JSON.stringify(Object.assign({}, a, { answers: a.answers.map(x => {
      const c = Object.assign({}, x), big = !!x.audio && x.audio.length > MAX_AUDIO;
      c.hasAudio = !!x.hasAudio || (!!x.audio && !big); c.audioTooLarge = big || !!x.audioTooLarge; delete c.audio; return c;
    }) })));
  }
  const audioMapOf = (a) => { const m = {}; a.answers.forEach(x => { if (x.audio) m[x.qid] = x.audio; }); return m; };

  async function push(a) {
    const ref = db.collection(COL).doc(a.id);
    await withTimeout(ref.set(strip(a)), TIMEOUT);
    const aud = a.answers.filter(x => x.audio && x.audio.length <= MAX_AUDIO);
    await withTimeout(Promise.all(aud.map(x => ref.collection('audio').doc(String(x.qid)).set({ qid: x.qid, data: x.audio }))), AUDIO_TIMEOUT);
  }

  async function syncPending() {
    if (!db) return;
    const ids = rd(PEND, []); if (!ids.length) return;
    const local = readLocal(), left = [];
    for (const id of ids) {
      const a = local.find(x => x.id === id); if (!a) continue;
      try { await push(a); } catch (e) { left.push(id); lastError = String(e.code || e.message || e); }
    }
    wr(PEND, left); setMode(left.length ? 'offline' : 'cloud');
  }

  function init() {
    if (!configured) { mode = 'local'; return; }
    if (!window.firebase || !window.firebase.firestore) { mode = 'offline'; return; }
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.firestore(); mode = 'cloud';
      window.addEventListener('online', () => { syncPending(); });
      syncPending();
    } catch (e) { db = null; mode = 'offline'; }
  }

  async function save(a) {
    a.answers.forEach(x => { x.hasAudio = !!x.audio; });
    const list = readLocal(); list.unshift(a);
    const okLocal = writeLocal(list);
    audioMem[a.id] = audioMapOf(a);
    if (!db) { if (configured) queue(a.id); return { ok: okLocal, cloud: false }; }
    try { await push(a); return { ok: true, cloud: true }; }
    catch (e) { queue(a.id); setMode('offline', e); return { ok: okLocal, cloud: false }; }
  }

  async function all() {
    const local = readLocal();
    if (!db) return local;
    try {
      await syncPending();
      const snap = await withTimeout(db.collection(COL).orderBy('date', 'desc').get(), TIMEOUT);
      const cloud = snap.docs.map(d => d.data());
      const byId = {}; local.forEach(a => { byId[a.id] = a; });
      const ids = new Set(cloud.map(a => a.id));
      cloud.forEach(a => { const l = byId[a.id]; if (l) a.answers.forEach((x, i) => { if (l.answers[i] && l.answers[i].audio) x.audio = l.answers[i].audio; }); });
      const pend = rd(PEND, []);
      local.filter(a => !ids.has(a.id) && pend.includes(a.id)).forEach(a => cloud.push(a));
      cloud.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      writeLocal(cloud); setMode('cloud');
      return cloud;
    } catch (e) { setMode('offline', e); return local; }
  }

  async function hydrateAudio(a) {
    if (!a.answers.some(x => x.hasAudio && !x.audio)) return a;
    const mem = audioMem[a.id] || (audioMem[a.id] = {});
    if (db && !Object.keys(mem).length) {
      try {
        const snap = await withTimeout(db.collection(COL).doc(a.id).collection('audio').get(), AUDIO_TIMEOUT);
        snap.docs.forEach(d => { const v = d.data(); mem[v.qid] = v.data; });
      } catch (e) { setMode('offline', e); }
    }
    a.answers.forEach(x => { if (!x.audio && mem[x.qid]) x.audio = mem[x.qid]; });
    return a;
  }

  async function update(a) {
    const list = readLocal(), i = list.findIndex(x => x.id === a.id);
    if (i > -1) list[i] = a; else list.unshift(a);
    writeLocal(list);
    if (!db) return { cloud: false };
    try { await withTimeout(db.collection(COL).doc(a.id).set(strip(a)), TIMEOUT); return { cloud: true }; }
    catch (e) { queue(a.id); setMode('offline', e); return { cloud: false }; }
  }

  async function remove(id) {
    writeLocal(readLocal().filter(a => a.id !== id));
    wr(PEND, rd(PEND, []).filter(x => x !== id)); delete audioMem[id];
    if (!db) return true;
    try {
      const ref = db.collection(COL).doc(id);
      const snap = await withTimeout(ref.collection('audio').get(), TIMEOUT);
      const b = db.batch(); snap.docs.forEach(d => b.delete(d.ref)); b.delete(ref);
      await withTimeout(b.commit(), TIMEOUT); return true;
    } catch (e) { setMode('offline', e); return false; }
  }

  async function clear() {
    const ids = (await all()).map(a => a.id); let ok = true;
    for (const id of ids) { if (!(await remove(id))) ok = false; }
    localStorage.removeItem(KEY); localStorage.removeItem(PEND);
    return ok;
  }

  init();
  return { all, save, update, remove, clear, hydrateAudio, status, onStatus, cached: readLocal, configured };
})();
