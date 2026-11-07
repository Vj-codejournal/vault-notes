'use strict';
/* ---------- tiny DOM + helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function onLongPress(el, fn, ms = 480) {
  let t, moved = false, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', e => { moved = false; fired = false; sx = e.clientX; sy = e.clientY; t = setTimeout(() => { if (!moved) { fired = true; navigator.vibrate?.(15); fn(e); } }, ms); });
  el.addEventListener('pointermove', e => { if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) { moved = true; clearTimeout(t); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, () => clearTimeout(t)));
  el.addEventListener('click', e => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  el.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- dates (local, YYYY-MM-DD) ---------- */
const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const dow = s => parseYmd(s).getDay();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
function prettyDate(s, opts = {}) {
  const d = parseYmd(s), t = todayStr();
  let rel = s === t ? 'Today' : s === addDays(t, -1) ? 'Yesterday' : s === addDays(t, 1) ? 'Tomorrow' : '';
  const base = `${DOW3[d.getDay()]}, ${d.getDate()} ${MON3[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() || opts.year ? ' ' + d.getFullYear() : ''}`;
  return rel && !opts.noRel ? `${rel} · ${base}` : base;
}
function relTime(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  const d = new Date(ms); return `${d.getDate()} ${MON3[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}`;
}
function stamp() { const d = new Date(); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`; }

/* ---------- paths ---------- */
const P = {
  base: p => p.slice(p.lastIndexOf('/') + 1),
  dir: p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); },
  ext: p => { const b = P.base(p), i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i + 1).toLowerCase(); },
  stem: p => { const b = P.base(p), i = b.lastIndexOf('.'); return i <= 0 ? b : b.slice(0, i); },
  join: (...a) => a.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
  clean: p => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').split('/').filter(s => s && s !== '.' && s !== '..').join('/'),
  hidden: p => p.split('/').some(s => s.startsWith('.')),
};
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic']);
const TEXT_EXT = new Set(['md', 'txt', 'json', 'canvas', 'csv', 'css', 'js', 'html', 'yml', 'yaml', 'xml', 'tsv', 'log']);
const kindOf = p => { const e = P.ext(p); return e === 'md' ? 'md' : IMG_EXT.has(e) ? 'img' : TEXT_EXT.has(e) ? 'txt' : 'bin'; };
const badName = n => /[\\/:*?"<>|#^[\]]/.test(n);

/* ---------- icons (inline SVG, lucide-style) ---------- */
const IC = {
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 12v6M9 15h6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  cal: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  habit: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="m14.5 17.5 2 2 4-4.5"/>',
  notes: '<path d="M4 19.5V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14.5"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20M8 7h8M8 11h8M8 15h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  chevL: '<path d="M15 6l-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  moreV: '<circle cx="12" cy="5" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2zM22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12 3.5 3.5 0 0 0 6 19z"/>',
  sort: '<path d="M3 6h13M3 12h9M3 18h5M17 8V20M14 17l3 3 3-3"/>',
  collapse: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-3-2-5.5-3.5-7-.3 2-1.5 3-2.5 3 .5-3-1-6.5-4-8.5 0 3.5-4 6-4 12.5 0 4 3 7 7 7z"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  up: '<path d="M18 15l-6-6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  today: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/><circle cx="12" cy="15" r="2" fill="currentColor"/>',
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${IC[n] || ''}</svg>`;
const iconEl = (n, cls) => { const t = document.createElement('template'); t.innerHTML = icon(n, cls); return t.content.firstChild; };

/* ---------- toast / sheets / dialogs (alert/confirm/prompt are blocked in the sandbox) ---------- */
let toastT;
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
const overlayStack = [];
function openOverlay(el, onClose) {
  const bd = h('div', { class: 'backdrop' }, el);
  const close = () => { if (!bd.isConnected) return; bd.remove(); const i = overlayStack.indexOf(rec); if (i >= 0) overlayStack.splice(i, 1); onClose?.(); };
  const rec = { close };
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  document.body.append(bd); overlayStack.push(rec); Nav.pushBack(); return close;
}
/** options: [{label, icon, danger, onClick}] */
function actionSheet(title, options) {
  const sheet = h('div', { class: 'sheet' }, h('div', { class: 'grab' }), title ? h('h3', null, title) : null);
  let close;
  for (const o of options) {
    if (!o) continue;
    sheet.append(h('button', { class: 'opt' + (o.danger ? ' danger' : ''), onclick: () => { close(); o.onClick(); } }, o.icon ? iconEl(o.icon) : null, o.label));
  }
  close = openOverlay(sheet);
}
function formSheet(title, build, { okLabel = 'Save', onOk, danger, extra } = {}) {
  return new Promise(resolve => {
    const form = h('form', { class: 'form' });
    const sheet = h('div', { class: 'sheet' }, h('div', { class: 'grab' }), h('h3', null, title), form);
    let done = false;
    const close = openOverlay(sheet, () => { if (!done) resolve(null); });
    const api = build(form) || {};
    const actions = h('div', { class: 'actions' },
      extra ? h('button', { type: 'button', class: 'btn' + (extra.danger ? ' danger' : ''), onclick: () => { done = true; close(); resolve({ extra: true }); } }, extra.label) : null,
      h('button', { type: 'button', class: 'btn', onclick: () => close() }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'primary') }, okLabel));
    form.append(actions);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = api.value ? api.value() : true;
      if (v === undefined) return; // validation failed
      done = true; close(); resolve(v);
    });
    setTimeout(() => { const f = form.querySelector('input[type=text],textarea'); if (f && api.autofocus !== false) { f.focus(); f.select?.(); } }, 60);
  });
}
function promptText(title, { value = '', placeholder = '', okLabel = 'OK', hint } = {}) {
  return formSheet(title, form => {
    const inp = h('input', { type: 'text', value, placeholder, autocomplete: 'off', autocapitalize: 'sentences' });
    form.append(inp); if (hint) form.append(h('div', { class: 'hint' }, hint));
    return { value: () => inp.value.trim() || undefined };
  }, { okLabel });
}
function confirmBox(title, msg, okLabel = 'Delete', danger = true) {
  return formSheet(title, form => { form.append(h('p', { style: { color: 'var(--muted)', margin: '0', lineHeight: '1.5' } }, msg)); return { autofocus: false }; }, { okLabel, danger }).then(v => !!v);
}

/* ---------- back-button handling (PWA standalone only; the artifact frame forbids history paths) ---------- */
const Nav = {
  enabled: false, armed: false,
  init() {
    this.enabled = !window.claude && 'pushState' in history && !inFrame();
    if (!this.enabled) return;
    addEventListener('popstate', () => {
      this.armed = false;
      if (overlayStack.length) overlayStack[overlayStack.length - 1].close();
      else UI.closeTopScreen();
      if (overlayStack.length || UI.hasOpenScreen()) this.pushBack();
    });
  },
  // keep exactly one extra history entry while anything is open, so Android's back button closes it
  pushBack() { if (this.enabled && !this.armed) { history.pushState({ o: 1 }, ''); this.armed = true; } },
};
function inFrame() { try { return window.self !== window.top; } catch { return true; } }
