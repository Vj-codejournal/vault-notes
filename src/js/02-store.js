/* ---------- IndexedDB (local vault storage) ---------- */
const IDB = {
  db: null, ok: false,
  async open() {
    try {
      if (!('indexedDB' in window)) throw new Error('no idb');
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('obsidian-like-vault', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('files', { keyPath: 'path' }); r.result.createObjectStore('kv'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
        setTimeout(() => rej(new Error('idb timeout')), 4000);
      });
      this.ok = true;
      try { navigator.storage?.persist?.(); } catch { }
    } catch (e) { console.warn('IndexedDB unavailable, running in memory', e); this.ok = false; }
  },
  _tx(store, mode, fn) {
    if (!this.ok) return Promise.resolve();
    return new Promise((res, rej) => {
      try {
        const tx = this.db.transaction(store, mode); const st = tx.objectStore(store); let out;
        const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
        tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      } catch (e) { rej(e); }
    }).catch(e => { console.warn('idb', e); });
  },
  all() { return this._tx('files', 'readonly', st => st.getAll()).then(r => r || []); },
  put(rec) { return this._tx('files', 'readwrite', st => st.put(rec)); },
  putMany(recs) { return this._tx('files', 'readwrite', st => { recs.forEach(r => st.put(r)); }); },
  del(path) { return this._tx('files', 'readwrite', st => st.delete(path)); },
  clear() { return this._tx('files', 'readwrite', st => st.clear()); },
  kvGet(k) { return this._tx('kv', 'readonly', st => st.get(k)); },
  kvSet(k, v) { return this._tx('kv', 'readwrite', st => st.put(v, k)); },
};

/* ---------- Vault: an in-memory map of path -> record, persisted to IndexedDB ----------
   record: { path, kind:'md'|'img'|'txt'|'bin'|'folder', content:string (text or data: URL), mtime, ctime, deleted? }
   Deleted files are kept as tombstones so deletions sync between devices. */
const Vault = {
  map: new Map(), listeners: new Set(), _names: null,
  async init() {
    await IDB.open();
    if (IDB.ok) for (const r of await IDB.all()) this.map.set(r.path, r);
  },
  on(fn) { this.listeners.add(fn); },
  emit(ev) { this._names = null; for (const fn of this.listeners) try { fn(ev); } catch (e) { console.error(e); } },
  get(p) { const r = this.map.get(p); return r && !r.deleted ? r : null; },
  exists(p) { return !!this.get(p); },
  read(p) { return this.get(p)?.content ?? ''; },
  all() { return [...this.map.values()].filter(r => !r.deleted); },
  files({ hidden = false } = {}) { return this.all().filter(r => r.kind !== 'folder' && (hidden || !P.hidden(r.path))); },
  notes() { return this.files().filter(r => r.kind === 'md'); },
  folders({ hidden = false } = {}) {
    const s = new Set();
    for (const r of this.all()) {
      if (!hidden && P.hidden(r.path)) continue;
      let d = r.kind === 'folder' ? r.path : P.dir(r.path);
      while (d) { s.add(d); d = P.dir(d); }
    }
    return s;
  },
  folderExists(p) { return !p || this.folders({ hidden: true }).has(p); },
  async write(path, content, opts = {}) {
    path = P.clean(path);
    const old = this.map.get(path), now = Date.now();
    if (old && !old.deleted && old.content === content && !opts.force) return old;
    const rec = { path, kind: opts.kind || kindOf(path), content, mtime: opts.mtime || now, ctime: (old && !old.deleted && old.ctime) || opts.ctime || now };
    this.map.set(path, rec);
    await IDB.put(rec);
    this.emit({ type: 'write', path, rec, remote: !!opts.remote });
    return rec;
  },
  async mkdir(path) {
    path = P.clean(path); if (!path || this.folderExists(path)) return;
    const rec = { path, kind: 'folder', content: '', mtime: Date.now(), ctime: Date.now() };
    this.map.set(path, rec); await IDB.put(rec); this.emit({ type: 'write', path, rec });
  },
  async remove(path) {
    const now = Date.now(), recs = [];
    for (const r of this.all()) if (r.path === path || r.path.startsWith(path + '/')) {
      const t = { path: r.path, kind: r.kind, content: '', mtime: now, ctime: r.ctime, deleted: true };
      this.map.set(r.path, t); recs.push(t);
    }
    await IDB.putMany(recs);
    for (const t of recs) this.emit({ type: 'delete', path: t.path, rec: t });
  },
  /** Rename/move a file or folder. Updates [[wikilinks]] in other notes when a note's name changes. */
  async rename(from, to) {
    from = P.clean(from); to = P.clean(to);
    if (from === to) return to;
    const isFolder = !this.get(from) || this.get(from).kind === 'folder';
    const moves = [];
    for (const r of this.all()) {
      if (r.path === from) moves.push([r, to]);
      else if (isFolder && r.path.startsWith(from + '/')) moves.push([r, to + r.path.slice(from.length)]);
    }
    for (const [r, np] of moves) if (this.exists(np)) throw new Error(`"${np}" already exists`);
    const now = Date.now();
    for (const [r, np] of moves) {
      const nr = { ...r, path: np, mtime: now }; delete nr.deleted;
      this.map.set(np, nr); this.map.set(r.path, { path: r.path, kind: r.kind, content: '', mtime: now, ctime: r.ctime, deleted: true });
    }
    await IDB.putMany(moves.flatMap(([r, np]) => [this.map.get(np), this.map.get(r.path)]));
    for (const [r, np] of moves) { this.emit({ type: 'delete', path: r.path, rec: this.map.get(r.path) }); this.emit({ type: 'write', path: np, rec: this.map.get(np) }); }
    // update wikilinks if a note's basename changed
    if (!isFolder && P.ext(from) === 'md' && P.stem(from) !== P.stem(to)) await this.relink(P.stem(from), P.stem(to));
    if (!isFolder && P.ext(from) !== 'md' && P.base(from) !== P.base(to)) await this.relink(P.base(from), P.base(to));
    return to;
  },
  async relink(oldName, newName) {
    const re = new RegExp('(!?\\[\\[)' + oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '((?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\])', 'gi');
    for (const n of this.notes()) {
      if (!n.content.includes('[[')) continue;
      const nc = n.content.replace(re, (_, a, b) => a + newName + b);
      if (nc !== n.content) await this.write(n.path, nc);
    }
  },
  async applyRemote(rec) {
    this.map.set(rec.path, rec); await IDB.put(rec);
    this.emit({ type: rec.deleted ? 'delete' : 'write', path: rec.path, rec, remote: true });
  },
  uniquePath(dir, stem, ext) {
    let p = P.join(dir, `${stem}${ext ? '.' + ext : ''}`), i = 1;
    while (this.exists(p) || (!ext && this.folderExists(p))) p = P.join(dir, `${stem} ${i++}${ext ? '.' + ext : ''}`);
    return p;
  },
  names() {
    if (this._names) return this._names;
    const m = new Map();
    for (const r of this.files({ hidden: true })) {
      const keys = [P.base(r.path).toLowerCase()]; if (r.kind === 'md') keys.push(P.stem(r.path).toLowerCase());
      for (const k of keys) { if (!m.has(k)) m.set(k, []); m.get(k).push(r.path); }
    }
    return (this._names = m);
  },
  /** Obsidian-style link resolution: exact path, relative path, then shortest match by name. */
  resolve(target, fromPath = '') {
    if (!target) return null;
    target = target.split('#')[0].split('^')[0].trim();
    try { target = decodeURIComponent(target); } catch { }
    if (!target) return fromPath || null;
    const cands = [target, target + '.md'];
    for (const c of cands) { const p = P.clean(c); if (this.exists(p)) return p; }
    const dir = P.dir(fromPath);
    for (const c of cands) { const p = P.clean(P.join(dir, c)); if (this.exists(p)) return p; }
    const key = P.base(target).toLowerCase();
    let list = this.names().get(key) || this.names().get(key.replace(/\.md$/, ''));
    if (!list) return null;
    if (target.includes('/')) list = list.filter(p => p.toLowerCase().endsWith(target.toLowerCase()) || p.toLowerCase().endsWith(target.toLowerCase() + '.md'));
    if (!list.length) return null;
    return [...list].sort((a, b) => (P.dir(b) === dir) - (P.dir(a) === dir) || a.split('/').length - b.split('/').length || a.length - b.length)[0];
  },
};

/* ---------- settings (stored in the vault so they sync + export) ---------- */
const SETTINGS_PATH = '.app/settings.json';
const DEFAULT_SETTINGS = { dailyFolder: 'Daily Notes', attachFolder: 'attachments', weekStart: 1, sort: 'name', readDefault: true, imgMax: 1600 };
const Settings = {
  get() { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(Vault.read(SETTINGS_PATH) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } },
  async set(patch) { await Vault.write(SETTINGS_PATH, JSON.stringify({ ...this.get(), ...patch }, null, 2)); },
};
