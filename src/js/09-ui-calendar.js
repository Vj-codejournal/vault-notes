/* ---------- Calendar tab ---------- */
const CalState = { month: todayStr().slice(0, 7), sel: todayStr() };
function renderCalendar(v) {
  const S = CalState, ws = Settings.get().weekStart;
  const [y, m] = S.month.split('-').map(Number);
  const goMonth = d => { const dt = new Date(y, m - 1 + d, 1); S.month = ymd(dt).slice(0, 7); UI.render('calendar'); };
  const sc = h('div', { class: 'scroll' });
  v.replaceChildren(topbar(null, 'Calendar', null), sc);
  v.querySelector('.topbar').prepend(h('div', { style: { width: '42px' } }));
  v.querySelector('.topbar').append(h('button', { class: 'btn sm', onclick: () => { S.sel = todayStr(); S.month = S.sel.slice(0, 7); UI.render('calendar'); } }, 'Today'));
  sc.append(h('div', { class: 'cal-head' }, h('div', { class: 'mlabel' }, `${MONTHS[m - 1]} ${y}`), iconBtn('chevL', () => goMonth(-1), 'Previous month'), iconBtn('chev', () => goMonth(1), 'Next month')));
  const grid = h('div', { class: 'cal-grid' });
  for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'cal-dow' }, DOW3[(i + ws) % 7].slice(0, 2)));
  const first = new Date(y, m - 1, 1), lead = (first.getDay() - ws + 7) % 7;
  const start = addDays(ymd(first), -lead), t = todayStr();
  const weeks = Math.ceil((lead + new Date(y, m, 0).getDate()) / 7);
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i), sum = Daily.summary(d), hf = d <= t ? Habits.dayFraction(d) : null;
    const dots = h('div', { class: 'dots' });
    if (sum?.events) dots.append(h('i', { style: { background: 'var(--accent)' } }));
    if (sum?.open) dots.append(h('i', { style: { background: 'var(--warn)' } }));
    else if (sum?.done) dots.append(h('i', { style: { background: 'var(--muted)' } }));
    if (sum?.note) dots.append(h('i', { style: { background: '#fff' } }));
    const cell = h('button', { class: `cal-day${d.slice(0, 7) !== S.month ? ' out' : ''}${d === t ? ' today' : ''}${d === S.sel ? ' sel' : ''}`, onclick: () => { S.sel = d; if (d.slice(0, 7) !== S.month) S.month = d.slice(0, 7); UI.render('calendar'); } },
      h('span', { class: 'num' }, parseYmd(d).getDate()), dots,
      hf && hf.done ? h('div', { class: 'hbar' }, h('b', { style: { width: Math.round(hf.done / hf.total * 100) + '%' } })) : null);
    grid.append(cell);
  }
  // swipe between months
  let sx = null;
  grid.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  grid.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) goMonth(dx < 0 ? 1 : -1); sx = null; });
  sc.append(grid, dayPanel(S.sel));
}

function dayPanel(date) {
  const panel = h('div', { class: 'day-panel' });
  const dn = Daily.get(date);
  const save = async () => { await Daily.save(date, dn); };
  panel.append(h('div', { class: 'day-title' }, prettyDate(date, { year: true })),
    h('div', { class: 'day-sub' }, `${dn.events.length} event${dn.events.length === 1 ? '' : 's'} · ${dn.tasks.filter(t => !t.done).length} to-do · ${dn.tasks.filter(t => t.done).length} done`));

  // habits for that day
  const hs = Habits.list().filter(hb => Habits.scheduled(hb, date));
  if (hs.length && date <= addDays(todayStr(), 0)) {
    const f = Habits.dayFraction(date);
    panel.append(h('div', { class: 'section-h' }, `Habits · ${f ? f.done : 0}/${f ? f.total : hs.length}`, h('button', { onclick: () => { HabState.date = date; UI.show('habits'); } }, 'Open')));
    const card = h('div', { class: 'card' });
    for (const hb of hs) card.append(habitRow(hb, date));
    panel.append(card);
  }

  // events
  panel.append(h('div', { class: 'section-h' }, 'Events'));
  const ec = h('div', { class: 'card' });
  dn.events.slice().sort((a, b) => (a.time || '').localeCompare(b.time || '')).forEach(e => {
    const idx = dn.events.indexOf(e);
    ec.append(h('div', { class: 'item', onclick: () => editEvent(date, dn, idx) },
      h('span', { class: 'time-badge' }, e.time || 'All day'),
      h('div', { class: 'txt' }, e.title, e.end ? h('small', null, `${e.time} – ${e.end}`) : null)));
  });
  const evTitle = h('input', { type: 'text', placeholder: 'Add event…', enterkeyhint: 'done' }), evTime = h('input', { type: 'time' });
  const addEv = async () => { const t = evTitle.value.trim(); if (!t) return; dn.events.push({ time: evTime.value, end: '', title: t }); evTitle.value = ''; await save(); toast('Event added'); };
  evTitle.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addEv(); } });
  ec.append(h('div', { class: 'addline' }, evTitle, evTime, h('button', { onclick: addEv }, '+')));
  panel.append(ec);

  // to-dos
  panel.append(h('div', { class: 'section-h' }, 'To-do', dn.tasks.some(t => !t.done) && date <= todayStr() ? h('button', { onclick: async () => { await moveTasks(date, addDays(date, 1), dn); toast('Moved unfinished to next day'); } }, 'Move unfinished →') : null));
  const tc = h('div', { class: 'card' });
  dn.tasks.forEach((t, i) => {
    const chk = h('button', { class: 'check' + (t.done ? ' on' : ''), 'aria-label': 'toggle', onclick: async e => { e.stopPropagation(); t.done = !t.done; await save(); } });
    tc.append(h('div', { class: 'item' + (t.done ? ' done' : '') }, chk, h('div', { class: 'txt', onclick: () => editTask(date, dn, i) }, t.text)));
  });
  const tIn = h('input', { type: 'text', placeholder: 'Add to-do…', enterkeyhint: 'done' });
  const addT = async () => { const t = tIn.value.trim(); if (!t) return; dn.tasks.push({ done: false, text: t }); tIn.value = ''; await save(); setTimeout(() => $('.day-panel input[placeholder="Add to-do…"]')?.focus(), 200); };
  tIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addT(); } });
  tc.append(h('div', { class: 'addline' }, tIn, h('button', { onclick: addT }, '+')));
  panel.append(tc);

  // daily note
  panel.append(h('div', { class: 'section-h' }, 'Daily note', h('button', { onclick: () => openDaily(date) }, dn.rest.trim() ? 'Open' : 'Write')));
  const nc = h('div', { class: 'card', onclick: () => openDaily(date) });
  nc.append(h('div', { class: 'note-prev' }, dn.rest.trim() ? dn.rest.trim().slice(0, 400) : h('span', { style: { color: 'var(--dim)' } }, `Tap to write in ${Daily.path(date)}`)));
  panel.append(nc);

  // notes touched that day
  const touched = Vault.notes().filter(r => r.path !== Daily.path(date) && (ymd(new Date(r.mtime)) === date || ymd(new Date(r.ctime || r.mtime)) === date)).sort((a, b) => b.mtime - a.mtime).slice(0, 12);
  if (touched.length) {
    panel.append(h('div', { class: 'section-h' }, 'Notes created or edited'));
    const c = h('div', { class: 'card' });
    touched.forEach(r => c.append(h('div', { class: 'item', onclick: () => openFile(r.path) }, iconEl('file'), h('div', { class: 'txt' }, P.stem(r.path), h('small', null, P.dir(r.path) || 'Vault root')))));
    panel.append(c);
  }
  return panel;
}
async function moveTasks(from, to, dn) {
  const open = dn.tasks.filter(t => !t.done); if (!open.length) return;
  const target = Daily.get(to); target.tasks.push(...open.map(t => ({ ...t })));
  dn.tasks = dn.tasks.filter(t => t.done);
  await Daily.save(to, target); await Daily.save(from, dn);
}
async function editTask(date, dn, i) {
  const t = dn.tasks[i];
  const r = await formSheet('Edit to-do', form => {
    const inp = h('input', { type: 'text', value: t.text });
    const dt = h('input', { type: 'date', value: date });
    form.append(inp, h('label', null, 'Date'), dt);
    return { value: () => inp.value.trim() ? { text: inp.value.trim(), date: dt.value || date } : undefined };
  }, { extra: { label: 'Delete', danger: true } });
  if (!r) return;
  if (r.extra) { dn.tasks.splice(i, 1); await Daily.save(date, dn); return; }
  t.text = r.text;
  if (r.date !== date) { dn.tasks.splice(i, 1); const o = Daily.get(r.date); o.tasks.push(t); await Daily.save(r.date, o); toast('Moved to ' + prettyDate(r.date, { noRel: true })); }
  await Daily.save(date, dn);
}
async function editEvent(date, dn, i) {
  const e = dn.events[i];
  const r = await formSheet('Edit event', form => {
    const ti = h('input', { type: 'text', value: e.title });
    const dt = h('input', { type: 'date', value: date }), st = h('input', { type: 'time', value: e.time }), en = h('input', { type: 'time', value: e.end });
    form.append(ti, h('label', null, 'Date'), dt, h('div', { class: 'row2' }, h('div', null, h('label', null, 'Start'), st), h('div', null, h('label', null, 'End'), en)), h('div', { class: 'hint' }, 'Leave the time empty for an all-day event.'));
    return { value: () => ti.value.trim() ? { title: ti.value.trim(), date: dt.value || date, time: st.value, end: st.value ? en.value : '' } : undefined };
  }, { extra: { label: 'Delete', danger: true } });
  if (!r) return;
  if (r.extra) { dn.events.splice(i, 1); await Daily.save(date, dn); return; }
  const ne = { title: r.title, time: r.time, end: r.end };
  if (r.date !== date) { dn.events.splice(i, 1); const o = Daily.get(r.date); o.events.push(ne); await Daily.save(r.date, o); }
  else dn.events[i] = ne;
  await Daily.save(date, dn);
}
