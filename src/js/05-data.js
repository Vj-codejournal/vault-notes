/* ---------- Daily notes: calendar to-dos + events live inside "Daily Notes/YYYY-MM-DD.md" ---------- */
const Daily = {
  _sum: new WeakMap(),
  path(date) { return P.join(Settings.get().dailyFolder, date + '.md'); },
  isDailyPath(p) { const r = /(?:^|\/)(\d{4}-\d{2}-\d{2})\.md$/.exec(p); return r && P.dir(p) === Settings.get().dailyFolder ? r[1] : null; },
  parse(text) {
    const { fm, body } = MD.splitFrontmatter(text || '');
    const out = { fm, events: [], tasks: [], rest: '' }, rest = [];
    let sec = null;
    for (const line of body.split('\n')) {
      if (/^##\s+(events?|schedule)\s*$/i.test(line)) { sec = 'events'; continue; }
      if (/^##\s+(tasks?|to-?dos?)\s*$/i.test(line)) { sec = 'tasks'; continue; }
      if (/^#{1,2}\s/.test(line)) sec = null;
      if (sec === 'events') {
        if (!line.trim()) continue;
        const m = /^\s*[-*]\s+(?:(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?\s+)?(.+)$/.exec(line);
        if (m) { out.events.push({ time: m[1] ? m[1].padStart(5, '0') : '', end: m[2] ? m[2].padStart(5, '0') : '', title: m[3].trim() }); continue; }
        sec = null;
      } else if (sec === 'tasks') {
        if (!line.trim()) continue;
        const m = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(line);
        if (m) { out.tasks.push({ done: m[1] !== ' ', text: m[2] }); continue; }
        const m2 = /^\s*[-*]\s+(.+)$/.exec(line);
        if (m2) { out.tasks.push({ done: false, text: m2[1] }); continue; }
        sec = null;
      }
      rest.push(line);
    }
    out.rest = rest.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
    return out;
  },
  serialize(d) {
    const parts = [];
    if (d.fm != null) parts.push(`---\n${d.fm}\n---`);
    if (d.events.length) {
      const ev = [...d.events].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      parts.push('## Events\n' + ev.map(e => `- ${e.time ? e.time + (e.end ? '-' + e.end : '') + ' ' : ''}${e.title}`).join('\n'));
    }
    if (d.tasks.length) parts.push('## Tasks\n' + d.tasks.map(t => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n'));
    if (d.rest.trim()) parts.push(d.rest.trim());
    return parts.length ? parts.join('\n\n') + '\n' : '';
  },
  get(date) { return this.parse(Vault.read(this.path(date))); },
  async save(date, d) {
    const p = this.path(date), text = this.serialize(d);
    if (!text.trim()) { if (Vault.exists(p)) await Vault.remove(p); return; }
    await Vault.write(p, text);
  },
  /** summary for calendar dots */
  summary(date) {
    const r = Vault.get(this.path(date)); if (!r) return null;
    const c = this._sum.get(r); if (c && c.src === r.content) return c.s;
    const d = this.parse(r.content);
    const s = { events: d.events.length, open: d.tasks.filter(t => !t.done).length, done: d.tasks.filter(t => t.done).length, note: !!d.rest.trim() };
    this._sum.set(r, { src: r.content, s });
    return s;
  },
};

/* ---------- Habits: definitions in .app/habits.json, check-ins in .app/habit-log/YYYY.json ----------
   habits.json : { habits: { id: {id,name,color,type:'check'|'target',target,unit,step,days:[0-6],order,archived,created,updatedAt} }, deleted: {id: t} }
   YYYY.json   : { "YYYY-MM-DD": { habitId: [value, timestamp] } }     (per-entry timestamps let devices merge) */
const HABITS_PATH = '.app/habits.json';
const COLORS = ['#2C6670', '#4F4468', '#33506A', '#87531E', '#683C50', '#3A6B3E', '#8A3B3B', '#6B6A2E', '#3D4A8A', '#22707F', '#8A3F6E', '#4A4A4F'];
const Habits = {
  _cache: new Map(),
  _json(path, empty) {
    const r = Vault.get(path); if (!r) return empty();
    const c = this._cache.get(path); if (c && c.src === r.content) return c.val;
    let val; try { val = JSON.parse(r.content); } catch { val = empty(); }
    this._cache.set(path, { src: r.content, val }); return val;
  },
  defs() { const d = this._json(HABITS_PATH, () => ({ habits: {}, deleted: {} })); d.habits ||= {}; d.deleted ||= {}; return d; },
  list({ archived = false } = {}) { return Object.values(this.defs().habits).filter(h => !!h.archived === archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)); },
  get(id) { return this.defs().habits[id]; },
  async _writeDefs(d) { await Vault.write(HABITS_PATH, JSON.stringify(d, null, 1)); },
  async save(hb) {
    const d = structuredClone(this.defs());
    if (!hb.id) { hb.id = 'h' + uid(); hb.order = Math.max(0, ...Object.values(d.habits).map(x => x.order ?? 0)) + 1; hb.created ||= todayStr(); }
    hb.updatedAt = Date.now(); d.habits[hb.id] = hb; delete d.deleted[hb.id];
    await this._writeDefs(d); return hb;
  },
  async remove(id) { const d = structuredClone(this.defs()); delete d.habits[id]; d.deleted[id] = Date.now(); await this._writeDefs(d); },
  async move(id, dir) {
    const list = this.list(), i = list.findIndex(x => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const d = structuredClone(this.defs()); const now = Date.now();
    list.forEach((x, k) => { d.habits[x.id].order = k; d.habits[x.id].updatedAt = now; });
    await this._writeDefs(d);
  },
  logPath(year) { return `.app/habit-log/${year}.json`; },
  log(year) { return this._json(this.logPath(year), () => ({})); },
  value(id, date) { const e = this.log(date.slice(0, 4))[date]?.[id]; return e ? e[0] : 0; },
  async setValue(id, date, v) {
    const y = date.slice(0, 4), lg = structuredClone(this.log(y));
    lg[date] ||= {}; lg[date][id] = [Math.max(0, Math.round(v * 1000) / 1000), Date.now()];
    await Vault.write(this.logPath(y), JSON.stringify(lg));
  },
  goal(hb) { return hb.type === 'target' ? (+hb.target || 1) : 1; },
  progress(hb, date) { return clamp(this.value(hb.id, date) / this.goal(hb), 0, 1); },
  done(hb, date) { return this.value(hb.id, date) >= this.goal(hb) - 1e-9; },
  scheduled(hb, date) { return !hb.days?.length || hb.days.length === 7 || hb.days.includes(dow(date)); },
  async toggle(hb, date) {
    if (hb.type === 'target') { const v = this.value(hb.id, date); await this.setValue(hb.id, date, v >= this.goal(hb) ? 0 : this.goal(hb)); }
    else await this.setValue(hb.id, date, this.done(hb, date) ? 0 : 1);
  },
  async step(hb, date, dir) { const st = +hb.step || 1; await this.setValue(hb.id, date, Math.max(0, this.value(hb.id, date) + dir * st)); },
  firstDay(hb) {
    let first = hb.created || todayStr();
    // include any earlier check-ins (e.g. imported)
    for (const r of Vault.files({ hidden: true })) {
      const m = /^\.app\/habit-log\/(\d{4})\.json$/.exec(r.path); if (!m) continue;
      for (const [d, e] of Object.entries(this.log(m[1]))) if (e[hb.id]?.[0] > 0 && d < first) first = d;
    }
    return first;
  },
  stats(hb) {
    const t = todayStr(), first = this.firstDay(hb);
    let cur = 0, best = 0, run = 0, total = 0, sched30 = 0, done30 = 0;
    for (let d = first; d <= t; d = addDays(d, 1)) {
      if (!this.scheduled(hb, d)) continue;
      const ok = this.done(hb, d);
      if (ok) { total++; run++; best = Math.max(best, run); } else if (d !== t) run = 0;
    }
    // current streak: walk back from today
    for (let d = t; d >= first; d = addDays(d, -1)) {
      if (!this.scheduled(hb, d)) continue;
      if (this.done(hb, d)) cur++; else if (d !== t) break;
    }
    for (let i = 0; i < 30; i++) {
      const d = addDays(t, -i); if (d < first) break;
      if (!this.scheduled(hb, d)) continue;
      if (i === 0 && !this.done(hb, d)) continue;
      sched30++; if (this.done(hb, d)) done30++;
    }
    return { current: cur, best, total, rate30: sched30 ? Math.round(done30 / sched30 * 100) : 0, first };
  },
  dayFraction(date) {
    const hs = this.list().filter(hb => this.scheduled(hb, date) && (hb.created || '') <= date);
    if (!hs.length) return null;
    return { done: hs.filter(hb => this.done(hb, date)).length, total: hs.length };
  },
  seed() {
    // the habits from the user's current tracker screenshot (stable ids, updatedAt 1 so any synced copy wins)
    const t = todayStr();
    const mk = (id, name, color, order, extra = {}) => ({ id, name, color, type: 'check', target: 1, unit: '', step: 1, days: [], order, archived: false, created: t, updatedAt: 1, ...extra });
    const list = [
      mk('h-water', 'Water 3.5l', '#2C6670', 0, { type: 'target', target: 3.5, unit: 'L', step: 0.5 }),
      mk('h-meds', 'Meds supradine fish magnesium silajit creatine', '#2C6670', 1),
      mk('h-guitar', 'Guitar practice Scales Chords Theory', '#4F4468', 2),
      mk('h-singing', 'Singing Practice', '#4F4468', 3),
      mk('h-stocks', 'Stocks', '#33506A', 4),
      mk('h-dsa', 'DSA /AI ML/ SYSTEM DESIGN', '#87531E', 5),
      mk('h-server', 'Set up server/ Learn Arch and deployment', '#87531E', 6),
      mk('h-electronics', 'Electronics / 3D print', '#87531E', 7),
      mk('h-editing', 'video and photo editing', '#683C50', 8),
    ];
    const habits = {}; list.forEach(x => habits[x.id] = x);
    return JSON.stringify({ habits, deleted: {} }, null, 1);
  },
};

/* merge two versions of an .app JSON file (used when both devices changed it) */
function mergeAppJson(path, a, b) {
  let A, B; try { A = JSON.parse(a); B = JSON.parse(b); } catch { return null; }
  if (path === HABITS_PATH) {
    const out = { habits: {}, deleted: { ...A.deleted } };
    for (const [id, t] of Object.entries(B.deleted || {})) out.deleted[id] = Math.max(out.deleted[id] || 0, t);
    for (const src of [A.habits || {}, B.habits || {}]) for (const [id, hb] of Object.entries(src)) {
      if (!out.habits[id] || (hb.updatedAt || 0) > (out.habits[id].updatedAt || 0)) out.habits[id] = hb;
    }
    for (const [id, t] of Object.entries(out.deleted)) if (out.habits[id] && (out.habits[id].updatedAt || 0) <= t) delete out.habits[id]; else if (out.habits[id]) delete out.deleted[id];
    return JSON.stringify(out, null, 1);
  }
  if (/^\.app\/habit-log\/\d{4}\.json$/.test(path)) {
    const out = structuredClone(A);
    for (const [d, e] of Object.entries(B)) { out[d] ||= {}; for (const [id, v] of Object.entries(e)) if (!out[d][id] || v[1] > out[d][id][1]) out[d][id] = v; }
    return JSON.stringify(out);
  }
  return null;
}
