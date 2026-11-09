/* ---------- Water tab (WaterTap) ---------- */
const WaterState = { month: todayStr().slice(0, 7), shown: null };  // shown: what the glass showed last, so the next render animates from it
const W_SRC = { nfc: ['nfc', 'NFC tap'], manual: ['hand', 'Added by hand'], adjust: ['edit', 'Adjustment'] };
const fmtL = ml => (ml / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' L';
const hhmm = ts => { const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const wTint = p => p >= 1 ? 'var(--water)' : p > 0 ? `rgba(74,168,255,${(.16 + p * .6).toFixed(2)})` : '';

/* keep the native side (Android NFC taps) in step: pull pending taps in, push today's totals out */
Object.assign(Water, {
  _busy: false, _again: false, _years: new Set(),
  async sync() {
    if (this._busy) { this._again = true; return; }
    this._busy = true;
    try {
      for (const y of this._years) await this.reconcile(y);
      this._years.clear();
      const taps = NativeWater.available ? await NativeWater.drain().catch(e => { console.warn('water drain', e); return []; }) : [];
      let n = 0;
      for (const tp of taps || []) if (tp && +tp.ml > 0 && /^\d{4}-\d{2}-\d{2}$/.test(tp.day || '')) { await this.add(tp.day, +tp.ml, 'nfc', +tp.ts || Date.now()); n++; }
      if (n && UI.tab !== 'water') toast(`Added ${n} NFC tap${n > 1 ? 's' : ''} · today ${fmtMl(this.total(todayStr()))}`);
      const t = todayStr();
      if (NativeWater.available) await NativeWater.setMirror({ date: t, totalMl: this.total(t), goalMl: this.goalMl(), tapMl: this.tapMl() });
    } catch (e) { console.warn('water sync', e); }
    this._busy = false;
    if (this._again) { this._again = false; this.sync(); }
  },
  syncSoon: debounce(() => Water.sync(), 250),
  start() {
    Vault.on(ev => {
      const m = /^\.app\/(?:water|habit)-log\/(\d{4})\.json$/.exec(ev.path);
      if (m) this._years.add(m[1]);
      if (m || ev.path === HABITS_PATH || ev.path === SETTINGS_PATH) this.syncSoon();
    });
    try { NativeWater.onResume(() => this.sync()); } catch (e) { console.warn(e); }
    this.years().forEach(y => this._years.add(y));
    this.sync();
  },
});

/** the glass: an SVG tumbler clipped around two drifting waves; the level moves with a CSS transition */
function waveD(per, amp) { let d = 'M0 0'; for (let x = 0; x < 260; x += per) d += ` q${per / 4} ${-amp} ${per / 2} 0 t${per / 2} 0`; return d + ' V200 H0 Z'; }
const levelY = p => p <= 0 ? 166 : 154 - Math.max(.035, Math.min(1, p)) * 140;
function waterGlass(p) {
  const inner = 'M12.5 7 L23.6 146.4 Q24.4 153.5 31.6 153.5 L88.4 153.5 Q95.6 153.5 96.4 146.4 L107.5 7 Z';
  const ticks = [.25, .5, .75].map(f => { const y = levelY(f); return `<path d="M${(106.5 - (y - 7) * 11.1 / 139.4).toFixed(1)} ${y}h-${f === .5 ? 9 : 6}"/>`; }).join('');
  return h('div', {
    class: 'wglass' + (p >= 1 ? ' full' : ''), html: `<svg viewBox="0 0 120 162" aria-hidden="true">
<defs><clipPath id="wg-clip"><path d="${inner}"/></clipPath>
<linearGradient id="wg-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cd0ff"/><stop offset="1" stop-color="#1c64c8"/></linearGradient>
<linearGradient id="wg-shine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<path d="${inner}" class="g-in"/>
<g clip-path="url(#wg-clip)"><g class="wlevel" style="transform:translateY(${levelY(p)}px)">
<path class="wv wb" d="${waveD(80, 3.2)}"/><path class="wv wf" d="${waveD(60, 2.6)}" fill="url(#wg-grad)"/></g></g>
<g class="g-ticks">${ticks}</g>
<path d="M17 12 L27 140 Q27.6 145 31 146" class="g-shine"/>
<path d="M10 4 L21.6 146.8 Q22.6 155.6 31.6 155.6 L88.4 155.6 Q97.4 155.6 98.4 146.8 L110 4" class="g-rim"/>
<ellipse cx="60" cy="4.2" rx="50" ry="1.6" class="g-lip"/></svg>`,
  });
}
function setGlass(el, p) { const g = el.querySelector('.wlevel'); if (g) g.style.transform = `translateY(${levelY(p)}px)`; el.classList.toggle('full', p >= 1); }
function countUp(el, from, to, ms = 700) {
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmtMl(to); return; }
  const t0 = performance.now();
  const tick = now => { if (!el.isConnected && now - t0 > 50) return; const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); el.textContent = fmtMl(from + (to - from) * e); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

async function waterAdd(ml, date = todayStr(), ts, after) {
  const id = await Water.add(date, ml, 'manual', ts); navigator.vibrate?.(10);
  if (id) toast(`+${fmtMl(ml)}${date === todayStr() ? ` · today ${fmtMl(Water.total(date))}` : ''}`, 3000, { label: 'Undo', onClick: async () => { await Water.remove(date, id); after?.(); } });
  return id;
}
async function waterDelete(date, e, after) {
  await Water.remove(date, e.id); after?.();
  toast(`Removed ${fmtMl(Math.abs(e.ml))}`, 4500, { label: 'Undo', onClick: async () => { await Water.restore(date, e.id); after?.(); } });
}
function mlInput(value, placeholder = 'ml') { return h('input', { type: 'number', min: '1', max: '10000', step: '1', inputmode: 'numeric', value, placeholder }); }
const mlOk = v => { const n = Math.round(+v); return n >= 1 && n <= 10000 ? n : undefined; };
function askMl(title, value, { label = 'Amount (ml)', okLabel = 'Add', hint } = {}) {
  return formSheet(title, form => {
    const inp = mlInput(value);
    const chips = h('div', { class: 'chips', style: { padding: '10px 0 0' } }, [150, 200, 250, 330, 500, 750].map(n => h('button', { type: 'button', class: 'chip', onclick: () => { inp.value = n; inp.focus(); } }, n + ' ml')));
    form.append(h('label', null, label), inp, chips, hint ? h('div', { class: 'hint' }, hint) : null);
    setTimeout(() => { inp.focus(); inp.select(); }, 80);
    return { autofocus: false, value: () => { const n = mlOk(inp.value); if (n == null) toast('Enter an amount from 1 to 10,000 ml'); return n; } };
  }, { okLabel });
}
const entryLabel = e => (e.src === 'adjust' && !e.seed ? (e.ml < 0 ? '−' : '+') : '') + fmtMl(Math.abs(e.ml));
function entryRow(date, e, onclick, right) {
  const [ic, src] = e.seed ? ['habit', 'From the habit tracker'] : W_SRC[e.src] || W_SRC.manual;
  return h('div', { class: 'item w-entry', onclick },
    h('span', { class: 'time-badge' }, e.seed ? 'Earlier' : hhmm(e.ts)),
    h('div', { class: 'txt' }, entryLabel(e), h('small', null, src)),
    h('span', { class: 'w-src ' + e.src }, iconEl(ic)), right);
}

function renderWater(v) {
  const t = todayStr(), hb = Water.habit(), goal = Water.goalMl(), total = Water.total(t), p = total / goal, tap = Water.tapMl();
  const sc = h('div', { class: 'scroll' });
  v.replaceChildren(topbar(h('div', { style: { width: '42px' } }), 'Water', iconBtn('more', waterMenu, 'More')), sc);

  // hero: glass + numbers, animating from what was shown last
  const prev = WaterState.shown?.date === t ? WaterState.shown : { ml: 0, p: 0 };
  WaterState.shown = { date: t, ml: total, p };
  const glass = waterGlass(prev.p), amt = h('div', { class: 'w-amt' }, fmtMl(prev.ml));
  requestAnimationFrame(() => requestAnimationFrame(() => setGlass(glass, p)));
  countUp(amt, prev.ml, total);
  const entries = Water.entries(t), last = entries.filter(e => !e.seed).at(-1);
  sc.append(h('div', { class: 'w-hero' }, glass,
    h('div', { class: 'w-nums' }, amt,
      h('div', { class: 'w-of' }, `of ${fmtMl(goal)} · ${Math.round(p * 100)}%`),
      h('div', { class: 'w-status' + (p >= 1 ? ' ok' : '') }, p >= 1 ? 'Goal reached 🎉' : `${fmtMl(goal - total)} to go`),
      last ? h('div', { class: 'w-last' }, `Last drink ${hhmm(last.ts)}`) : null)));

  // quick add
  const second = tap === 250 ? 500 : 250;
  sc.append(h('div', { class: 'w-quick' },
    h('button', { onclick: () => waterAdd(tap) }, iconEl('drop'), `+${tap.toLocaleString('en-US')}`),
    h('button', { onclick: () => waterAdd(second) }, iconEl('drop'), `+${second}`),
    h('button', { onclick: async () => { const ml = await askMl('Add water', 300); if (ml) waterAdd(ml); } }, 'Custom…')));

  if (!hb) sc.append(h('div', { class: 'card w-link' }, h('div', { class: 'item' }, iconEl('habit'),
    h('div', { class: 'txt' }, 'Not linked to a habit', h('small', null, 'Link water to a habit to see it on the Habits tab, with streaks and heatmaps.'))),
    h('div', { style: { padding: '0 14px 12px' } }, h('button', { class: 'btn primary block', onclick: async () => { const x = await Water.createHabit(); toast(`Created “${x.name}” · ${fmtNum(x.target)} L a day`); } }, iconEl('plus'), 'Create Water habit (target 3.5 L)'))));

  // today's log (newest first)
  const pad = h('div', { class: 'pad' });
  pad.append(h('div', { class: 'section-h' }, `Today · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, h('button', { onclick: () => openWaterDay(t) }, 'Edit day')));
  const log = h('div', { class: 'card' });
  if (!entries.length) log.append(h('div', { class: 'item' }, h('div', { class: 'txt', style: { color: 'var(--dim)' } }, 'Nothing logged yet today.', h('small', null, NativeWater.available ? 'Tap a programmed NFC sticker or use the buttons above.' : 'Use the buttons above to log a drink.'))));
  for (const e of [...entries].reverse()) log.append(entryRow(t, e, () => actionSheet(`${entryLabel(e)} · ${e.seed ? 'earlier' : hhmm(e.ts)}`, [
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => waterDelete(t, e) },
  ])));
  pad.append(log);
  sc.append(pad);

  sc.append(waterMonth(goal));
  if (NativeWater.available) sc.append(stickerSection(tap));
  sc.append(h('div', { style: { height: '110px' } }));
}

function waterMonth(goal) {
  const S = WaterState, ws = Settings.get().weekStart, t = todayStr();
  const [y, m] = S.month.split('-').map(Number);
  const goMonth = d => { S.month = ymd(new Date(y, m - 1 + d, 1)).slice(0, 7); UI.render('water'); };
  const wrap = h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'History', S.month !== t.slice(0, 7) ? h('button', { onclick: () => { S.month = t.slice(0, 7); UI.render('water'); } }, 'This month') : null));
  const head = h('div', { class: 'cal-head', style: { padding: '0 0 4px' } }, h('div', { class: 'mlabel', style: { paddingLeft: '2px' } }, `${MONTHS[m - 1]} ${y}`),
    iconBtn('chevL', () => goMonth(-1), 'Previous month'), iconBtn('chev', () => goMonth(1), 'Next month'));
  const grid = h('div', { class: 'cal-grid w-grid' });
  for (let i = 0; i < 7; i++) grid.append(h('div', { class: 'cal-dow' }, DOW3[(i + ws) % 7].slice(0, 2)));
  const first = new Date(y, m - 1, 1), lead = (first.getDay() - ws + 7) % 7, dim = new Date(y, m, 0).getDate();
  for (let i = 0; i < lead; i++) grid.append(h('div'));
  let met = 0, sum = 0, elapsed = 0;
  for (let k = 1; k <= dim; k++) {
    const d = `${S.month}-${pad2(k)}`, fut = d > t, tot = fut ? 0 : Water.total(d), p = tot / goal;
    if (!fut) { elapsed++; sum += tot; if (p >= 1) met++; }
    grid.append(h('button', { class: `w-day${fut ? ' fut' : ''}${d === t ? ' today' : ''}${p >= 1 ? ' met' : ''}`, disabled: fut, title: `${prettyDate(d, { noRel: true })} · ${fmtMl(tot)}`, onclick: () => openWaterDay(d) },
      h('span', { class: 'c', style: { background: wTint(p) } }, k, p >= 1 ? h('i', { html: icon('check') }) : null),
      h('small', null, tot ? (tot / 1000).toFixed(1) : '')));
  }
  let sx = null;
  grid.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
  grid.addEventListener('touchend', e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 60) goMonth(dx < 0 ? 1 : -1); sx = null; });
  const card = h('div', { class: 'card w-cal' }, head, grid,
    h('div', { class: 'w-stats' },
      h('div', null, h('b', null, elapsed ? `${met}/${elapsed}` : '–'), h('span', null, 'days goal met')),
      h('div', null, h('b', null, elapsed ? fmtMl(sum / elapsed) : '–'), h('span', null, 'average a day')),
      h('div', null, h('b', null, fmtL(sum)), h('span', null, 'month total'))));
  wrap.append(card);
  return wrap;
}

/** a sheet with one day's entries: delete, and add an entry with amount + time */
function openWaterDay(date) {
  const sheet = h('div', { class: 'sheet w-daysheet' });
  const close = openOverlay(sheet);
  const draw = () => {
    if (!sheet.isConnected) return;
    const es = Water.entries(date), tot = Water.total(date), goal = Water.goalMl();
    const list = h('div', { class: 'card', style: { margin: '0 14px' } });
    if (!es.length) list.append(h('div', { class: 'item' }, h('div', { class: 'txt', style: { color: 'var(--dim)' } }, 'No water logged.')));
    for (const e of es) list.append(entryRow(date, e, null, iconBtn('trash', () => waterDelete(date, e, draw), 'Delete', 'sm')));
    const mlIn = mlInput(Water.tapMl()), tIn = h('input', { type: 'time', value: date === todayStr() ? hhmm(Date.now()) : '12:00' });
    const add = async () => {
      const ml = mlOk(mlIn.value); if (ml == null) return toast('Enter an amount from 1 to 10,000 ml');
      const [hh, mm] = (tIn.value || '12:00').split(':').map(Number), ts = parseYmd(date).setHours(hh, mm, 0, 0);
      await waterAdd(ml, date, ts, draw); draw();
    };
    mlIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    sheet.replaceChildren(h('div', { class: 'grab' }), h('h3', null, prettyDate(date, { year: true })),
      h('div', { class: 'w-daysum' }, h('b', null, fmtMl(tot)), ` of ${fmtMl(goal)} · ${Math.round(tot / goal * 100)}%`,
        h('div', { class: 'w-bar' }, h('b', { style: { width: Math.min(100, tot / goal * 100) + '%' } }))),
      list,
      h('div', { class: 'section-h', style: { margin: '18px 20px 6px' } }, 'Add entry'),
      h('div', { class: 'card', style: { margin: '0 14px' } }, h('div', { class: 'addline' }, mlIn, tIn, h('button', { onclick: add }, 'Add'))),
      h('div', { class: 'form' }, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Done'))));
  };
  draw();
}

function waterMenu() {
  const hb = Water.habit(), tap = Water.tapMl();
  actionSheet('Water', [
    { label: `Amount per tap · ${fmtMl(tap)}`, icon: 'drop', onClick: editTapMl },
    { label: `Linked habit · ${hb ? hb.name : 'none'}`, icon: 'link', onClick: pickWaterHabit },
    hb ? { label: 'Habit streaks & heatmap', icon: 'chart', onClick: () => openHabit(hb.id) } : null,
    NativeWater.available ? { label: 'Program NFC sticker', icon: 'nfc', onClick: programSticker } : null,
  ]);
}
async function editTapMl() {
  const ml = await askMl('Amount per tap', Water.tapMl(), { okLabel: 'Save', label: 'Each tap / quick add adds (ml)', hint: 'Used by the first quick-add button and as the default for new stickers. Stickers you already programmed keep their own amount.' });
  if (ml) { await Settings.set({ tapMl: ml }); toast(`Amount per tap: ${fmtMl(ml)}`); }
}
function pickWaterHabit() {
  const cur = Water.habitId(), list = Habits.list().filter(x => x.type === 'target');
  actionSheet('Link water to habit', [
    ...list.map(x => ({ label: `${x.name} · ${fmtNum(x.target)} ${x.unit || ''}`, icon: x.id === cur ? 'check' : null, onClick: async () => { await Settings.set({ waterHabitId: x.id }); for (const y of Water.years()) await Water.reconcile(y); toast(`Linked to “${x.name}”`); } })),
    !Water.habit() ? { label: 'Create Water habit (target 3.5 L)', icon: 'plus', onClick: () => Water.createHabit() } : null,
  ]);
}

function stickerSection(tap) {
  const nfcSub = h('small', null, 'Checking NFC…');
  NativeWater.nfcState().then(s => { nfcSub.textContent = !s?.supported ? 'This phone has no NFC' : s.enabled ? 'NFC is on · tap a sticker to log water' : 'NFC is off · turn it on in Android settings'; }).catch(() => { nfcSub.textContent = 'NFC status unavailable'; });
  return h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'NFC stickers'),
    h('div', { class: 'card' },
      h('div', { class: 'item', onclick: programSticker }, h('span', { class: 'w-src nfc' }, iconEl('nfc')), h('div', { class: 'txt' }, 'Program NFC sticker', nfcSub), iconEl('chev')),
      h('div', { class: 'item', onclick: editTapMl }, h('span', { class: 'w-src' }, iconEl('drop')), h('div', { class: 'txt' }, 'Amount per tap', h('small', null, `${fmtMl(tap)} · default for new stickers`)), iconEl('chev'))),
    h('div', { class: 'hint', style: { padding: '0 4px' } }, 'Stick a blank NTAG213/215/216 sticker on your bottle or by the tap. Each tap of the phone logs its amount, even when the app is closed.'));
}
async function programSticker() {
  const st = await NativeWater.nfcState().catch(() => ({ supported: false, enabled: false }));
  if (!st?.supported) return toast('This phone has no NFC');
  if (!st.enabled) return toast('NFC is off — turn it on in Android settings', 3500);
  const ml = await askMl('Program NFC sticker', Water.tapMl(), { okLabel: 'Next', label: 'Each tap of this sticker adds (ml)', hint: 'You can reprogram a sticker any time.' });
  if (!ml) return;
  let done = false;
  const sheet = h('div', { class: 'sheet w-nfc' }, h('div', { class: 'grab' }),
    h('div', { class: 'w-nfc-anim' }, h('span'), h('span'), iconEl('nfc')),
    h('h3', null, 'Hold the sticker to the back of the phone…'),
    h('p', null, `It will be programmed to add ${fmtMl(ml)} per tap. Keep it still until the phone confirms.`),
    h('div', { class: 'form' }, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'))));
  const close = openOverlay(sheet, () => { if (!done) NativeWater.cancelWrite().catch(() => { }); });
  try {
    await NativeWater.writeTag(ml);
    done = true; close(); navigator.vibrate?.(40);
    toast(`Sticker ready ✓ · each tap adds ${fmtMl(ml)}`, 3500);
  } catch (e) {
    const wasOpen = !done && sheet.isConnected; done = true; close();
    const msg = e?.message || String(e);
    if (/cancel/i.test(msg) || !wasOpen) return;
    toast('Couldn’t program the sticker: ' + msg, 4500);
  }
}
