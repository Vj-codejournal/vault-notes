/* ---------- Habits tab ---------- */
const HabState = { view: 'today', date: todayStr(), weekOf: todayStr() };
const fmtNum = n => (Math.round(n * 100) / 100).toString();
/* the habit linked to WaterTap (Water.linked) is driven by water entries: + adds one, − removes the newest, setting a value adds an adjustment */
async function habStep(hb, d, dir) {
  if (!Water.linked(hb)) return Habits.step(hb, d, dir);
  if (dir > 0) return Water.add(d, Water.stepMl(), 'manual');
  const e = await Water.removeLast(d);
  if (e) toast(`Removed ${fmtMl(e.ml)}`, 4000, { label: 'Undo', onClick: () => Water.restore(d, e.id) });
}
const habSet = (hb, d, v) => Water.linked(hb) ? Water.setTotal(d, v * 1000) : Habits.setValue(hb.id, d, v);
const habToggle = (hb, d) => Water.linked(hb) ? Water.setTotal(d, Habits.done(hb, d) ? 0 : Water.goalMl()) : Habits.toggle(hb, d);
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

function renderHabits(v) {
  const S = HabState;
  if (S.date > todayStr()) S.date = todayStr();
  const tabs = h('div', { class: 'tabs' });
  for (const [k, l] of [['today', 'Today'], ['weekly', 'Weekly'], ['overall', 'Overall']]) tabs.append(h('button', { class: S.view === k ? 'on' : '', onclick: () => { S.view = k; UI.render('habits'); } }, l));
  const sc = h('div', { class: 'scroll' });
  v.replaceChildren(topbar(iconBtn('archive', showArchived, 'Archived habits'), 'Habits', iconBtn('plus', () => editHabit(), 'New habit')), tabs, sc);
  const list = Habits.list();
  if (!list.length) { sc.append(h('div', { class: 'empty' }, 'No habits yet.', h('br'), h('br'), h('button', { class: 'btn primary', onclick: () => editHabit() }, iconEl('plus'), 'Add a habit'))); return; }
  if (S.view === 'today') habitsToday(sc, list);
  else if (S.view === 'weekly') habitsWeekly(sc, list);
  else habitsOverall(sc, list);
}

function habitsToday(sc, list) {
  const S = HabState, t = todayStr();
  const strip = h('div', { class: 'datestrip' });
  for (let i = 20; i >= 0; i--) {
    const d = addDays(t, -i), dd = parseYmd(d);
    strip.append(h('button', { class: (d === S.date ? 'on' : '') + (d === t ? ' today' : ''), onclick: () => { S.date = d; UI.render('habits'); } }, DOW3[dd.getDay()].slice(0, 3), h('b', null, dd.getDate())));
  }
  requestAnimationFrame(() => { const on = strip.querySelector('.on'); if (on) strip.scrollLeft = on.offsetLeft - strip.clientWidth + on.offsetWidth + 16; });
  const sched = list.filter(hb => Habits.scheduled(hb, S.date));
  const done = sched.filter(hb => Habits.done(hb, S.date)).length;
  const prog = h('div', { class: 'hab-progress' },
    h('div', { class: 'bar' }, h('b', { style: { width: (sched.length ? done / sched.length * 100 : 0) + '%' } })),
    h('div', { class: 'hab-meta' }, h('span', null, h('span', { class: 'n' }, done), ` of ${sched.length} completed${S.date !== t ? ' · ' + prettyDate(S.date, { noRel: true }) : ''}`),
      iconBtn('more', () => actionSheet('Habits', [
        { label: 'New habit', icon: 'plus', onClick: () => editHabit() },
        { label: 'Mark all done for this day', icon: 'check', onClick: async () => { for (const hb of sched) if (!Habits.done(hb, S.date)) await habSet(hb, S.date, Habits.goal(hb)); } },
        { label: 'Archived habits', icon: 'archive', onClick: showArchived },
      ]), 'More')));
  const cards = h('div', { class: 'hcards' });
  const others = list.filter(hb => !Habits.scheduled(hb, S.date));
  for (const hb of [...sched, ...others]) cards.append(habitCard(hb, S.date, !Habits.scheduled(hb, S.date)));
  sc.append(strip, prog, cards);
}

function habitCard(hb, date, off) {
  const isT = hb.type === 'target', done = Habits.done(hb, date), val = Habits.value(hb.id, date), st = Habits.stats(hb);
  const card = h('div', { class: `hcard ${done ? 'done' : 'notdone'}`, style: { background: hb.color, opacity: off ? .45 : 1 } });
  if (isT) card.append(h('div', { class: 'prog', style: { width: Habits.progress(hb, date) * 100 + '%' } }));
  card.append(h('div', { class: 'hname' }, hb.name));
  if (st.current > 1) card.append(h('span', { class: 'streak', html: `${icon('flame')}`.replace('class="i ', 'style="width:14px;height:14px;vertical-align:-2px" class="i ') + st.current }));
  if (isT) {
    card.append(h('div', { class: 'tgt' },
      h('button', { onclick: e => { e.stopPropagation(); habStep(hb, date, -1); } }, '−'),
      h('span', null, `${fmtNum(val)}/${fmtNum(hb.target)}${hb.unit ? ' ' + hb.unit : ''}`),
      h('button', { onclick: e => { e.stopPropagation(); habStep(hb, date, 1); } }, '+')));
  } else card.append(h('div', { class: 'tick' }));
  card.addEventListener('click', () => { navigator.vibrate?.(8); isT ? habStep(hb, date, 1) : habToggle(hb, date); });
  onLongPress(card, () => habitMenu(hb));
  return card;
}
function habitRow(hb, date) {
  const isT = hb.type === 'target', done = Habits.done(hb, date);
  const row = h('div', { class: 'item' + (done ? '' : '') },
    h('span', { style: { width: '12px', height: '12px', borderRadius: '4px', background: hb.color, flex: 'none' } }),
    h('div', { class: 'txt', onclick: () => openHabit(hb.id) }, hb.name, isT ? h('small', null, `${fmtNum(Habits.value(hb.id, date))} / ${fmtNum(hb.target)} ${hb.unit || ''}`) : null));
  if (isT) row.append(h('button', { class: 'btn sm', onclick: () => habStep(hb, date, -1) }, '−'), h('button', { class: 'btn sm', onclick: () => habStep(hb, date, 1) }, '+'));
  row.append(h('button', { class: 'check' + (done ? ' on' : ''), onclick: () => habToggle(hb, date) }));
  return row;
}
function habitMenu(hb) {
  actionSheet(hb.name, [
    { label: 'Statistics & heatmap', icon: 'chart', onClick: () => openHabit(hb.id) },
    { label: 'Edit', icon: 'edit', onClick: () => editHabit(hb) },
    { label: 'Move up', icon: 'up', onClick: () => Habits.move(hb.id, -1) },
    { label: 'Move down', icon: 'down', onClick: () => Habits.move(hb.id, 1) },
    { label: 'Archive', icon: 'archive', onClick: async () => { await Habits.save({ ...hb, archived: true }); toast('Archived'); } },
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete habit?', `"${hb.name}" and its history will be removed.`)) await Habits.remove(hb.id); } },
  ]);
}
function showArchived() {
  const arch = Habits.list({ archived: true });
  if (!arch.length) return toast('No archived habits');
  actionSheet('Archived — tap to restore', arch.map(hb => ({ label: hb.name, icon: 'archive', onClick: async () => { await Habits.save({ ...hb, archived: false }); toast('Restored'); } })));
}

function weekStartOf(d) { const ws = Settings.get().weekStart; return addDays(d, -((dow(d) - ws + 7) % 7)); }
function habitsWeekly(sc, list) {
  const S = HabState, t = todayStr(), start = weekStartOf(S.weekOf), days = [...Array(7)].map((_, i) => addDays(start, i));
  const end = days[6];
  sc.append(h('div', { class: 'cal-head', style: { paddingTop: '10px' } },
    h('div', { class: 'mlabel', style: { fontSize: '16px' } }, `${parseYmd(start).getDate()} ${MON3[parseYmd(start).getMonth()]} – ${parseYmd(end).getDate()} ${MON3[parseYmd(end).getMonth()]}`),
    iconBtn('chevL', () => { S.weekOf = addDays(start, -7); UI.render('habits'); }), iconBtn('chev', () => { S.weekOf = addDays(start, 7); UI.render('habits'); })));
  const tbl = h('table', { class: 'wk' });
  tbl.append(h('tr', null, h('th'), days.map(d => h('th', { class: d === t ? 'today' : '' }, DOW1[dow(d)], h('br'), parseYmd(d).getDate())), h('th')));
  for (const hb of list) {
    let cnt = 0, sch = 0;
    const tr = h('tr', null, h('td', { class: 'hn', onclick: () => openHabit(hb.id) }, hb.name));
    for (const d of days) {
      const s = Habits.scheduled(hb, d); if (s && d <= t) sch++;
      const p = Habits.progress(hb, d), dn = Habits.done(hb, d); if (dn) cnt++;
      const c = h('button', { class: 'c' + (s ? '' : ' off'), style: { background: dn ? hb.color : p > 0 ? hexA(hb.color, .25 + p * .5) : '' }, disabled: d > t, onclick: () => habToggle(hb, d) }, dn ? '✓' : p > 0 ? Math.round(p * 100) + '%' : '');
      tr.append(h('td', null, c));
    }
    tr.append(h('td', { class: 'cnt' }, `${cnt}/${sch || 0}`));
    tbl.append(tr);
  }
  sc.append(tbl, h('div', { class: 'hint', style: { padding: '8px 18px 120px' } }, 'Tap a square to tick or untick that day. Dashed squares are days the habit isn’t scheduled.'));
}

/** GitHub-style contribution heatmap. hb=null → all habits combined. */
function heatmap(hb, { start, end, cs = 12, onCell } = {}) {
  const ws = Settings.get().weekStart, t = todayStr();
  start = addDays(start, -((dow(start) - ws + 7) % 7));
  const color = hb ? hb.color : '#39d353';
  const first = hb ? Habits.firstDay(hb) : null;
  const grid = h('div', { class: 'heat', style: { '--cs': cs + 'px' } });
  const months = h('div', { class: 'heat-months', style: { '--cs': cs + 'px' } });
  let col = 0, lastMonth = -1;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const di = (dow(d) - ws + 7) % 7;
    if (di === 0) {
      // month label on the column containing the 1st..7th
      const dd = parseYmd(d), mEnd = parseYmd(addDays(d, 6));
      const mon = dd.getDate() <= 7 ? dd.getMonth() : (mEnd.getMonth() !== dd.getMonth() ? mEnd.getMonth() : -1);
      months.append(h('span', null, mon >= 0 && mon !== lastMonth ? MON3[mon] : ''));
      if (mon >= 0) lastMonth = mon; col++;
    }
    let cls = '', bg = '', title = prettyDate(d, { noRel: true, year: true });
    if (d > t) cls = 'fut';
    else if (hb) {
      if (d < first || !Habits.scheduled(hb, d)) cls = 'na';
      else { const p = Habits.progress(hb, d); if (p > 0) bg = hexA(color, p >= 1 ? 1 : .25 + p * .5); title += ` · ${hb.type === 'target' ? fmtNum(Habits.value(hb.id, d)) + '/' + fmtNum(hb.target) : Habits.done(hb, d) ? 'done' : ''}`; }
    } else {
      const f = Habits.dayFraction(d);
      if (!f) cls = 'na'; else if (f.done) { const p = f.done / f.total; bg = hexA(color, p >= 1 ? 1 : .2 + p * .6); title += ` · ${f.done}/${f.total}`; }
    }
    if (d === t) cls += ' today';
    const cell = h('i', { class: cls, title, style: bg ? { background: bg } : null, 'data-d': d });
    grid.append(cell);
  }
  if (onCell) grid.addEventListener('click', e => { const c = e.target.closest('i[data-d]'); if (c && !c.classList.contains('fut')) onCell(c.dataset.d); });
  const wrap = h('div', { class: 'heat-wrap' }, months, grid);
  months.style.gridTemplateColumns = `repeat(${col}, ${cs}px)`;
  // keep the newest week visible
  requestAnimationFrame(() => { const tc = grid.querySelector('.today'); wrap.scrollLeft = tc ? Math.max(0, tc.offsetLeft - wrap.clientWidth + cs * 4) : wrap.scrollWidth; });
  return wrap;
}
function legend(color) {
  return h('div', { class: 'legend' }, 'Less', [0, .35, .55, .78, 1].map(a => h('i', { style: { background: a ? hexA(color, a) : '#1f2125' } })), 'More');
}
function habitsOverall(sc, list) {
  const t = todayStr(), w = Math.max(10, Math.floor((Math.min(innerWidth, 560) - 52) / 15) - 1);
  const start = addDays(t, -(w * 7 - 1));
  const all = h('div', { class: 'hm-card', style: { marginTop: '12px' } }, h('div', { class: 'hm-top' }, h('span', { class: 'dot', style: { background: '#39d353' } }), h('span', { class: 't' }, 'All habits')),
    heatmap(null, { start, end: t }), legend('#39d353'));
  sc.append(all);
  for (const hb of list) {
    const st = Habits.stats(hb);
    const card = h('div', { class: 'hm-card', onclick: () => openHabit(hb.id) },
      h('div', { class: 'hm-top' }, h('span', { class: 'dot', style: { background: hb.color } }), h('span', { class: 't' }, hb.name), iconEl('chev')),
      heatmap(hb, { start, end: t }),
      h('div', { class: 'hm-stats' }, h('div', null, h('b', null, st.current), 'streak'), h('div', null, h('b', null, st.best), 'best'), h('div', null, h('b', null, st.rate30 + '%'), 'last 30d'), h('div', null, h('b', null, st.total), 'total')));
    sc.append(card);
  }
  sc.append(h('div', { style: { height: '110px' } }));
}

function openHabit(id) {
  let year = +todayStr().slice(0, 4);
  const el = h('section', { id: 'habit-detail' });
  const body = h('div', { class: 'scroll' });
  const close = UI.pushScreen(el, { refresh: () => draw() });
  function draw() {
    const hb = Habits.get(id); if (!hb) { close(); return; }
    const st = Habits.stats(hb);
    el.replaceChildren(topbar(iconBtn('back', () => close(), 'Back'), hb.name, iconBtn('more', () => habitMenu(hb), 'More')), body);
    const yStart = `${year}-01-01`, yEnd = `${year}-12-31`;
    const firstYear = +st.first.slice(0, 4), thisYear = +todayStr().slice(0, 4);
    const hm = heatmap(hb, { start: yStart, end: yEnd, cs: 13, onCell: d => dayEdit(hb, d) });
    const top = body.scrollTop;
    body.replaceChildren(
      h('div', { class: 'big-stats', style: { paddingTop: '6px' } },
        h('div', null, h('b', { style: { color: hb.color === '#4A4A4F' ? '#fff' : '' } }, st.current), h('span', null, '🔥 current streak')),
        h('div', null, h('b', null, st.best), h('span', null, 'best streak')),
        h('div', null, h('b', null, st.rate30 + '%'), h('span', null, 'completion · 30 days')),
        h('div', null, h('b', null, st.total), h('span', null, 'days done · since ' + prettyDate(st.first, { noRel: true, year: true })))),
      h('div', { class: 'hm-card' },
        h('div', { class: 'yearnav' }, iconBtn('chevL', () => { year--; draw(); }, 'Previous year', 'sm'), String(year), iconBtn('chev', () => { if (year < thisYear) { year++; draw(); } }, 'Next year', 'sm')),
        hm, legend(hb.color), h('div', { class: 'hint' }, 'Tap any day to change it.')),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Details')),
      h('div', { class: 'card', style: { margin: '0 12px 120px' } },
        h('div', { class: 'item' }, h('div', { class: 'txt' }, 'Type', h('small', null, hb.type === 'target' ? `Target: ${fmtNum(hb.target)} ${hb.unit || ''} per day (step ${fmtNum(hb.step)})` : 'Done / not done'))),
        h('div', { class: 'item' }, h('div', { class: 'txt' }, 'Schedule', h('small', null, !hb.days?.length || hb.days.length === 7 ? 'Every day' : hb.days.slice().sort().map(d => DOW3[d]).join(', ')))),
        h('div', { class: 'item', onclick: () => editHabit(hb) }, h('div', { class: 'txt' }, 'Edit habit'), iconEl('chev'))));
    body.scrollTop = top;
    // scroll the year heatmap so today is visible
    requestAnimationFrame(() => { const tc = hm.querySelector('.today'); if (tc) hm.scrollLeft = Math.max(0, tc.offsetLeft - hm.clientWidth + 60); else if (year < thisYear) hm.scrollLeft = hm.scrollWidth; });
  }
  draw();
}
async function dayEdit(hb, d) {
  if (hb.type !== 'target') { await habToggle(hb, d); toast(`${prettyDate(d, { noRel: true })}: ${Habits.done(hb, d) ? 'done ✓' : 'not done'}`); return; }
  const r = await formSheet(prettyDate(d, { year: true }), form => {
    const inp = h('input', { type: 'number', step: 'any', min: '0', value: fmtNum(Habits.value(hb.id, d)), inputmode: 'decimal' });
    form.append(h('label', null, `${hb.name} (${hb.unit || 'amount'}) — target ${fmtNum(hb.target)}`), inp);
    setTimeout(() => inp.select(), 80);
    return { value: () => +inp.value || 0, autofocus: false };
  });
  if (r != null) await habSet(hb, d, r);
}

async function editHabit(hb) {
  const isNew = !hb; hb = hb ? structuredClone(hb) : { name: '', color: COLORS[Habits.list().length % COLORS.length], type: 'check', target: 1, unit: '', step: 1, days: [], created: todayStr() };
  const r = await formSheet(isNew ? 'New habit' : 'Edit habit', form => {
    const name = h('input', { type: 'text', value: hb.name, placeholder: 'e.g. Read 20 pages', autocapitalize: 'sentences' });
    const sw = h('div', { class: 'swatches' });
    const drawSw = () => { sw.replaceChildren(...COLORS.map(c => h('button', { type: 'button', class: c === hb.color ? 'on' : '', style: { background: c }, onclick: () => { hb.color = c; drawSw(); } }))); };
    drawSw();
    const seg = h('div', { class: 'seg' }), tgt = h('div');
    const target = h('input', { type: 'number', step: 'any', min: '0', value: hb.type === 'target' ? hb.target : 8, inputmode: 'decimal' });
    const unit = h('input', { type: 'text', value: hb.unit || '', placeholder: 'L, pages, min…' });
    const step = h('input', { type: 'number', step: 'any', min: '0', value: hb.step || 1, inputmode: 'decimal' });
    tgt.append(h('div', { class: 'row2' }, h('div', null, h('label', null, 'Daily target'), target), h('div', null, h('label', null, 'Unit'), unit)), h('label', null, 'Each tap adds'), step);
    const drawSeg = () => { seg.replaceChildren(...[['check', 'Done / not done'], ['target', 'Amount target']].map(([k, l]) => h('button', { type: 'button', class: hb.type === k ? 'on' : '', onclick: () => { hb.type = k; drawSeg(); } }, l))); tgt.classList.toggle('hidden', hb.type !== 'target'); };
    drawSeg();
    const dows = h('div', { class: 'dows' });
    const drawDows = () => { const all = !hb.days?.length || hb.days.length === 7; dows.replaceChildren(...[0, 1, 2, 3, 4, 5, 6].map(i => (i + Settings.get().weekStart) % 7).map(i => h('button', { type: 'button', class: all || hb.days.includes(i) ? 'on' : '', onclick: () => { let ds = all ? [0, 1, 2, 3, 4, 5, 6] : [...hb.days]; ds = ds.includes(i) ? ds.filter(x => x !== i) : [...ds, i]; hb.days = ds.length === 7 ? [] : ds; drawDows(); } }, DOW1[i]))); };
    drawDows();
    const created = h('input', { type: 'date', value: hb.created || todayStr() });
    form.append(h('label', null, 'Name'), name, h('label', null, 'Color'), sw, h('label', null, 'Type'), seg, tgt, h('label', null, 'Repeat on'), dows,
      h('div', { class: 'hint' }, 'All days selected = every day.'), h('label', null, 'Start date'), created);
    return {
      value: () => {
        if (!name.value.trim()) { toast('Give the habit a name'); return undefined; }
        if (!hb.days?.length && hb.days !== undefined && false) return undefined;
        hb.name = name.value.trim(); hb.created = created.value || todayStr();
        if (hb.type === 'target') { hb.target = +target.value || 1; hb.unit = unit.value.trim(); hb.step = +step.value || 1; } else { hb.target = 1; hb.step = 1; }
        return hb;
      },
    };
  }, { okLabel: isNew ? 'Create' : 'Save', extra: isNew ? null : { label: 'Delete', danger: true } });
  if (!r) return;
  if (r.extra) { if (await confirmBox('Delete habit?', `"${hb.name}" and its history will be removed.`)) await Habits.remove(hb.id); return; }
  await Habits.save(r); toast(isNew ? 'Habit created' : 'Saved');
}
