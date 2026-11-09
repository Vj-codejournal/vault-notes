/* ---------- Water (WaterTap): entries in .app/water-log/YYYY.json ----------
   YYYY.json : { "YYYY-MM-DD": { entryId: [ml, ts, src:'nfc'|'manual'|'adjust', delTs?] } }   (delTs = tombstone, so devices merge)
   The linked habit (setting waterHabitId, unit L) always holds total/1000 for every day that has water entries.
   Days with no water entries but a habit value (history from before WaterTap) show that value as one virtual 'seed' entry,
   which is written for real the first time the day is changed. */
const fmtMl = n => Math.round(n).toLocaleString('en-US') + ' ml';
const Water = {
  path(y) { return `.app/water-log/${y}.json`; },
  log(y) { return Habits._json(this.path(y), () => ({})); },
  /** canonical JSON (sorted days + ids) so two devices holding the same entries write identical files */
  ser(lg) { const o = {}; for (const d of Object.keys(lg).sort()) { const e = lg[d] || {}, x = {}; for (const id of Object.keys(e).sort()) x[id] = e[id]; o[d] = x; } return JSON.stringify(o); },
  habitId() { return Settings.get().waterHabitId || 'h-water'; },
  habit() { const hb = Habits.get(this.habitId()); return hb && hb.type === 'target' ? hb : null; },
  linked(hb) { return !!hb && hb.type === 'target' && hb.id === this.habitId(); },
  goalMl() { const hb = this.habit(); return hb && +hb.target > 0 ? Math.round(hb.target * 1000) : 2500; },
  stepMl() { const hb = this.habit(); return Math.round((+hb?.step || 0.25) * 1000); },
  tapMl() { const v = Math.round(+Settings.get().tapMl); return v >= 1 && v <= 10000 ? v : 100; },
  _seed(date) { const hb = this.habit(), v = hb ? Habits.value(hb.id, date) : 0; return v > 0 ? { id: 'seed-' + date, ml: Math.round(v * 1000), ts: parseYmd(date).getTime(), src: 'adjust', seed: true } : null; },
  /** live entries of a day, oldest first */
  entries(date) {
    const day = this.log(date.slice(0, 4))[date];
    if (!day) { const s = this._seed(date); return s ? [s] : []; }
    return Object.entries(day).filter(([, e]) => Array.isArray(e) && e[3] == null).map(([id, e]) => ({ id, ml: +e[0] || 0, ts: +e[1] || 0, src: e[2] || 'manual', seed: id.startsWith('seed-') }))
      .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));
  },
  total(date) { return Math.max(0, this.entries(date).reduce((a, e) => a + e.ml, 0)); },
  async _mut(date, fn) {
    const y = date.slice(0, 4), lg = structuredClone(this.log(y));
    if (!lg[date]) { const s = this._seed(date); lg[date] = s ? { [s.id]: [s.ml, s.ts, s.src] } : {}; }
    const out = fn(lg[date]);
    await Vault.write(this.path(y), this.ser(lg));
    await this._syncHabit(date);
    return out;
  },
  async _syncHabit(date) {
    const hb = this.habit(); if (!hb) return;
    const v = this.total(date) / 1000;
    if (Math.abs(Habits.value(hb.id, date) - v) > 1e-9) await Habits.setValue(hb.id, date, v);
  },
  /** add an entry; returns its id. NFC taps get an id derived from ts+ml so a re-delivered tap is never counted twice. */
  add(date, ml, src = 'manual', ts = Date.now()) {
    ml = Math.round(+ml); if (!ml) return Promise.resolve(null);
    const id = src === 'nfc' ? 'n' + Math.round(ts).toString(36) + '-' + ml : uid();
    if (src === 'nfc' && this.log(date.slice(0, 4))[date]?.[id]) return Promise.resolve(id);
    return this._mut(date, d => { d[id] = [ml, Math.round(ts), src]; return id; });
  },
  remove(date, id) { return this._mut(date, d => { const e = d[id]; if (e && e[3] == null) { e[3] = Date.now(); return true; } return false; }); },
  /** undo a remove: re-adds the entry under a new id (a tombstone always wins a merge, so it can't be revived in place) */
  restore(date, id) { return this._mut(date, d => { const e = d[id]; if (!e) return null; if (e[3] == null) return id; const nid = uid(); d[nid] = [e[0], e[1], e[2]]; return nid; }); },
  /** make the day's total exactly ml by adding an 'adjust' entry for the difference */
  setTotal(date, ml, ts = Date.now()) { const diff = Math.round(Math.max(0, ml) - this.total(date)); return diff ? this.add(date, diff, 'adjust', ts) : Promise.resolve(null); },
  /** removes the newest live entry; returns it (for undo) */
  async removeLast(date) { const e = this.entries(date).at(-1); if (!e) return null; await this.remove(date, e.id); return e; },
  /** bring the linked habit's values in line with the water log (after merges from other devices) */
  async reconcile(y) {
    const hb = this.habit(); if (!hb) return;
    const lg = this.log(y), hl = structuredClone(Habits.log(y)); let ch = false;
    for (const d of Object.keys(lg)) {
      const v = this.total(d) / 1000;
      if (Math.abs((hl[d]?.[hb.id]?.[0] || 0) - v) > 1e-9) { (hl[d] ||= {})[hb.id] = [v, Date.now()]; ch = true; }
    }
    if (ch) await Vault.write(Habits.logPath(y), JSON.stringify(hl));
  },
  years() { const s = new Set([todayStr().slice(0, 4)]); for (const r of Vault.files({ hidden: true })) { const m = /^\.app\/water-log\/(\d{4})\.json$/.exec(r.path); if (m) s.add(m[1]); } return [...s]; },
  async createHabit() {
    let id = this.habitId(); if (Habits.get(id)) id = undefined;  // the id is taken by a non-target habit: make a new one and link it
    const hb = await Habits.save({ id, name: 'Water', color: '#2C6670', type: 'target', target: 3.5, unit: 'L', step: 0.25, days: [], order: -1, archived: false, created: todayStr() });
    if (hb.id !== this.habitId()) await Settings.set({ waterHabitId: hb.id });
    for (const y of this.years()) await this.reconcile(y);
    return hb;
  },
};
