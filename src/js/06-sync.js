/* ---------- Optional cloud backup/sync (only when hosted as a Claude artifact with the db capability) ---------- */
function cyrb(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
const MAX_DOC = 250000;
const Cloud = {
  status: 'off', msg: '', coll: null, ready: false, remote: new Map(), chains: new Map(), timers: new Map(), tooLarge: new Set(), downloads: null, listeners: new Set(),
  set(status, msg = '') { this.status = status; this.msg = msg; this.listeners.forEach(f => f()); },
  docId(path) { return 'f' + cyrb(path) + cyrb(path, 7); },
  async init() {
    if (!window.claude?.use) return;
    this.set('busy', 'Connecting…');
    try { this.downloads = await claude.use('downloads'); } catch { }
    try {
      const [db, user] = await Promise.all([claude.use('db'), claude.use('user')]);
      if (!db || !user) { this.set('off', 'Cloud backup unavailable here'); return; }
      const id = await user.id();
      if (!id) { this.set('off', 'Sign in to Claude to back up'); return; }
      this.coll = db.collection('data/users/' + id);
      const timer = setTimeout(() => { if (!this.ready) this.set('err', 'Cloud not reachable — working offline, will retry'); }, 10000);
      this.coll.onSnapshot(snap => {
        for (const ch of snap.docChanges()) if (ch.type !== 'removed') this.applyRemote(ch.doc.data());
        if (!snap.metadata.fromCache && !this.ready) { this.ready = true; clearTimeout(timer); this.pushAll(); this.set('ok', 'Backed up'); }
      }, err => { clearTimeout(timer); this.set('err', 'Sync stopped: ' + (err?.code || 'error')); });
    } catch (e) { this.set('err', String(e?.message || e)); }
  },
  async applyRemote(d) {
    if (!d || typeof d.p !== 'string') return;
    const path = P.clean(d.p); if (!path) return;
    this.remote.set(path, d.m);
    const local = Vault.map.get(path);
    const remoteRec = { path, kind: d.k || kindOf(path), content: d.c || '', mtime: d.m || 0, ctime: d.x || d.m || 0, ...(d.d ? { deleted: true } : {}) };
    const mergeable = path.startsWith('.app/') && local && !local.deleted && !d.d && local.content !== d.c;
    if (mergeable) {
      const merged = mergeAppJson(path, local.content, d.c);
      if (merged != null) {
        if (merged === d.c) { if (d.m >= local.mtime) await Vault.applyRemote(remoteRec); else await Vault.applyRemote({ ...remoteRec, mtime: local.mtime }); }
        else if (merged !== local.content) await Vault.write(path, merged, { mtime: Math.max(local.mtime, d.m) + 1 });
        else if (this.ready) this.schedule(path, 0);
        return;
      }
    }
    if (!local) { if (!d.d) await Vault.applyRemote(remoteRec); return; }
    if (d.m > local.mtime) await Vault.applyRemote(remoteRec);
    else if (d.m < local.mtime && this.ready) this.schedule(path, 0);
  },
  pushAll() {
    for (const r of Vault.map.values()) {
      const rm = this.remote.get(r.path);
      if (rm == null && r.deleted) continue;
      if (rm == null || r.mtime > rm) this.schedule(r.path, 0);
    }
  },
  schedule(path, ms = 900) {
    if (!this.coll || !this.ready) return;
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => { this.timers.delete(path); this.push(path); }, ms));
  },
  push(path) {
    const id = this.docId(path);
    const prev = this.chains.get(id) || Promise.resolve();
    const next = prev.then(async () => {
      const r = Vault.map.get(path); if (!r) return;
      if (this.remote.get(path) === r.mtime) return;
      const body = { p: r.path, k: r.kind, c: r.content || '', m: r.mtime, x: r.ctime || r.mtime, ...(r.deleted ? { d: 1 } : {}) };
      if (JSON.stringify(body).length > MAX_DOC) { this.tooLarge.add(path); this.set(this.status, `${this.tooLarge.size} file(s) too large to back up`); return; }
      this.set('busy', 'Syncing…');
      try {
        await this.coll.doc(id).set(body);
        this.remote.set(path, r.mtime); this.tooLarge.delete(path);
        if (![...this.timers.keys()].length) this.set('ok', this.tooLarge.size ? `${this.tooLarge.size} file(s) too large to back up` : 'Backed up');
      } catch (e) {
        if (e?.code === 'unavailable') { setTimeout(() => this.schedule(path, 0), 1500 + Math.random() * 2000); return; }
        this.set('err', e?.code === 'quota_exceeded' ? 'Cloud storage is full — export a zip backup' : 'Sync error: ' + (e?.code || e?.message || e));
      }
    });
    this.chains.set(id, next.catch(() => { }));
  },
};
Vault.on(ev => { if (!ev.remote) Cloud.schedule(ev.path); });

/* ---------- ZIP (no library): write with deflate via CompressionStream, read stored/deflate ---------- */
const Zip = (() => {
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = u8 => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  async function pipe(u8, Stream, fmt) { const s = new Blob([u8]).stream().pipeThrough(new Stream(fmt)); return new Uint8Array(await new Response(s).arrayBuffer()); }
  async function write(entries) {
    const chunks = [], central = []; let offset = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    for (const e of entries) {
      const name = enc.encode(e.name), raw = e.data || new Uint8Array(0), crc = crc32(raw);
      let method = 0, data = raw;
      if (raw.length > 64 && e.compress !== false && 'CompressionStream' in window) { try { const c = await pipe(raw, CompressionStream, 'deflate-raw'); if (c.length < raw.length) { data = c; method = 8; } } catch { } }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, raw.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, raw.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(38, e.name.endsWith('/') ? 0x10 : 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }
  async function read(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const out = [], dec = new TextDecoder();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip directory');
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const comp = u8.subarray(start, start + csize);
      if (name.endsWith('/')) { out.push({ name, dir: true }); continue; }
      let data;
      if (method === 0) data = comp.slice();
      else if (method === 8) data = await pipe(comp, DecompressionStream, 'deflate-raw');
      else { console.warn('skip unsupported method', method, name); continue; }
      out.push({ name, data });
    }
    return out;
  }
  return { write, read };
})();

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', pdf: 'application/pdf' };
function bytesToDataUrl(u8, ext) {
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return `data:${MIME[ext] || 'application/octet-stream'};base64,${btoa(s)}`;
}
function dataUrlToBytes(url) {
  const i = url.indexOf(','); const meta = url.slice(0, i), body = url.slice(i + 1);
  if (!/;base64/.test(meta)) return new TextEncoder().encode(decodeURIComponent(body));
  const bin = atob(body), u8 = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k); return u8;
}
const blobToDataUrl = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b); });

async function exportVault() {
  const enc = new TextEncoder(), entries = [];
  const folders = new Set([...Vault.all()].filter(r => r.kind === 'folder').map(r => r.path));
  for (const r of Vault.files({ hidden: true })) {
    const isText = r.kind === 'md' || r.kind === 'txt' || !r.content.startsWith('data:');
    entries.push({ name: r.path, data: isText ? enc.encode(r.content) : dataUrlToBytes(r.content), compress: isText });
  }
  for (const f of folders) if (!Vault.files({ hidden: true }).some(r => r.path.startsWith(f + '/'))) entries.push({ name: f + '/', data: new Uint8Array(0) });
  const blob = await Zip.write(entries);
  const name = `vault-${todayStr()}.zip`;
  if (Cloud.downloads) {
    try { await Cloud.downloads.save({ filename: name, data: blob }); toast('Backup saved'); await IDB.kvSet('lastExport', Date.now()); return; }
    catch (e) { if (e?.code === 'declined') return; if (!['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e?.code)) { toast('Export failed: ' + (e?.code || e)); return; } }
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  await IDB.kvSet('lastExport', Date.now()); toast('Backup downloaded');
}
async function importVault(file, mode) {
  const items = await Zip.read(await file.arrayBuffer());
  const names = items.map(i => i.name).filter(n => !n.startsWith('__MACOSX'));
  // strip a single shared top-level folder (Obsidian vault zipped as "MyVault/...")
  const tops = new Set(names.map(n => n.split('/')[0]));
  const strip = tops.size === 1 && names.every(n => n.includes('/')) ? [...tops][0] + '/' : '';
  if (mode === 'replace') { for (const r of Vault.all()) await Vault.remove(r.path); }
  let n = 0; const dec = new TextDecoder();
  for (const it of items) {
    let path = it.name.startsWith(strip) ? it.name.slice(strip.length) : it.name;
    path = P.clean(path);
    if (!path || /(^|\/)(\.obsidian|\.trash|__MACOSX|\.git)(\/|$)/.test(path) || P.base(path) === '.DS_Store') continue;
    if (it.dir) { await Vault.mkdir(path); continue; }
    const k = kindOf(path);
    const content = k === 'md' || k === 'txt' ? dec.decode(it.data) : bytesToDataUrl(it.data, P.ext(path));
    await Vault.write(path, content, { force: true }); n++;
  }
  return n;
}

/* ---------- images: downscale/compress so they stay light (and fit the cloud backup) ---------- */
async function prepareImage(file) {
  const ext0 = (P.ext(file.name) || (file.type.split('/')[1] || 'png')).toLowerCase().replace('jpeg', 'jpg');
  const maxDim = Settings.get().imgMax || 1600;
  if (/svg|gif/.test(file.type) || (file.size < 180000 && /png|jpe?g|webp/.test(file.type))) return { url: await blobToDataUrl(file), ext: ext0 };
  try {
    const bmp = await createImageBitmap(file);
    let scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    for (let attempt = 0; attempt < 5; attempt++) {
      const c = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      for (const q of [0.86, 0.75, 0.62]) {
        const blob = await new Promise(r => c.toBlob(r, 'image/webp', q));
        if (blob && blob.type === 'image/webp' && blob.size < 180000) return { url: await blobToDataUrl(blob), ext: 'webp' };
        if (blob && blob.type !== 'image/webp') { const j = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (j.size < 180000) return { url: await blobToDataUrl(j), ext: 'jpg' }; }
      }
      scale *= 0.75;
    }
  } catch (e) { console.warn('image compress failed', e); }
  return { url: await blobToDataUrl(file), ext: ext0 };
}
