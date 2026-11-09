/* ---------- App shell ---------- */
const UI = {
  tab: 'notes', screens: [], views: {}, stale: new Set(),
  init() {
    const app = $('#app');
    const tabs = [['notes', 'notes', 'Notes'], ['search', 'search', 'Search'], ['calendar', 'cal', 'Calendar'], ['habits', 'habit', 'Habits'], ['water', 'drop', 'Water']];
    for (const [id] of tabs) app.append(this.views[id] = h('section', { class: 'screen main hidden', id: 'v-' + id }));
    const nav = h('nav', { id: 'nav' });
    for (const [id, ic, label] of tabs) nav.append(h('button', { 'data-tab': id, onclick: () => this.show(id) }, iconEl(ic), label));
    document.body.append(nav);
    Vault.on(() => this.scheduleRefresh());
    document.addEventListener('focusout', () => setTimeout(() => { if (this.stale.size) this.scheduleRefresh(); }, 50));
    let initial = 'notes';
    try { initial = localStorage.getItem('tab') || 'notes'; } catch { }
    if (location.hash && ['notes', 'search', 'calendar', 'habits', 'water'].includes(location.hash.slice(1))) initial = location.hash.slice(1);
    this.show(initial);
  },
  show(id) {
    if (this.screens.length) while (this.screens.length) this.closeTopScreen();
    this.tab = id;
    for (const [k, v] of Object.entries(this.views)) v.classList.toggle('hidden', k !== id);
    $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === id));
    try { localStorage.setItem('tab', id); } catch { }
    this.render(id);
    if (id === 'search') setTimeout(() => $('#q')?.focus(), 50);
  },
  render(id) { ({ notes: renderNotes, search: renderSearch, calendar: renderCalendar, habits: renderHabits, water: renderWater })[id](this.views[id]); this.stale.delete(id); },
  scheduleRefresh: debounce(function () {
    const id = UI.tab, v = UI.views[id];
    const ae = document.activeElement;
    if (ae && v.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) { UI.stale.add(id); return; }
    const sc = v.querySelector('.scroll'), top = sc?.scrollTop;
    UI.render(id);
    const sc2 = v.querySelector('.scroll'); if (sc2 && top) sc2.scrollTop = top;
    for (const s of UI.screens) s.refresh?.();
  }, 120),
  pushScreen(el, { onClose, refresh } = {}) {
    el.classList.add('screen'); el.style.zIndex = 30 + this.screens.length;
    document.body.append(el);
    const rec = { el, onClose, refresh }; this.screens.push(rec); Nav.pushBack();
    $('#nav').classList.add('hidden');
    return () => this.closeScreen(rec);
  },
  closeScreen(rec) {
    const i = this.screens.indexOf(rec); if (i < 0) return;
    this.screens.splice(i, 1); try { rec.onClose?.(); } catch (e) { console.error(e); }
    rec.el.remove();
    if (!this.screens.length) { $('#nav').classList.remove('hidden'); this.scheduleRefresh(); }
  },
  closeTopScreen() { const r = this.screens[this.screens.length - 1]; if (!r) return false; this.closeScreen(r); return true; },
  hasOpenScreen() { return this.screens.length > 0; },
};
function topbar(left, title, right, leftAlign) {
  return h('header', { class: 'topbar' }, left, typeof title === 'string' ? h('h1', { class: leftAlign ? 'left' : '' }, title) : title, right);
}
const iconBtn = (ic, onclick, label, cls = '') => h('button', { class: 'iconbtn ' + cls, onclick, 'aria-label': label || ic, title: label || '' }, iconEl(ic));

/* ---------- Notes tab: folder tree ---------- */
const Tree = {
  open: new Set(JSON.parse((() => { try { return localStorage.getItem('openFolders'); } catch { return null; } })() || '[]')),
  save() { try { localStorage.setItem('openFolders', JSON.stringify([...this.open])); } catch { } },
};
function renderNotes(v) {
  const s = Settings.get();
  v.replaceChildren(
    topbar(iconBtn('gear', openSettings, 'Settings'), 'Vault', h('div', { style: { display: 'flex' } },
      iconBtn('today', () => openDaily(todayStr()), "Today's note"),
      iconBtn('sort', () => actionSheet('Sort by', [
        { label: 'Name (A → Z)', icon: s.sort === 'name' ? 'check' : null, onClick: () => Settings.set({ sort: 'name' }) },
        { label: 'Modified (newest first)', icon: s.sort === 'mtime' ? 'check' : null, onClick: () => Settings.set({ sort: 'mtime' }) },
        { label: 'Collapse all folders', icon: 'collapse', onClick: () => { Tree.open.clear(); Tree.save(); UI.render('notes'); } },
      ]), 'Sort'),
      iconBtn('folderPlus', () => newFolder(''), 'New folder'))),
  );
  const sc = h('div', { class: 'scroll' }), tree = h('div', { class: 'tree' });
  sc.append(tree); v.append(sc);
  const files = Vault.files(), folders = Vault.folders();
  if (!files.length && !folders.size) tree.append(h('div', { class: 'empty' }, 'Your vault is empty.', h('br'), 'Tap + to create your first note.'));
  const children = dir => {
    const fs = [...folders].filter(f => P.dir(f) === dir).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    let fl = files.filter(f => P.dir(f.path) === dir);
    fl.sort(s.sort === 'mtime' ? (a, b) => b.mtime - a.mtime : (a, b) => P.base(a.path).localeCompare(P.base(b.path), undefined, { sensitivity: 'base', numeric: true }));
    return { fs, fl };
  };
  const walk = (dir, depth) => {
    const { fs, fl } = children(dir);
    for (const f of fs) {
      const open = Tree.open.has(f);
      const row = h('div', { class: 'row folder' + (open ? ' open' : ''), style: { paddingLeft: 10 + depth * 18 + 'px' } },
        iconEl('chev', 'chev'), h('span', { class: 'name' }, P.base(f)),
        h('button', { class: 'iconbtn sm', onclick: e => { e.stopPropagation(); folderMenu(f); } }, iconEl('more')));
      row.addEventListener('click', () => { open ? Tree.open.delete(f) : Tree.open.add(f); Tree.save(); UI.render('notes'); });
      onLongPress(row, () => folderMenu(f));
      tree.append(row);
      if (open) walk(f, depth + 1);
    }
    for (const r of fl) {
      const ext = P.ext(r.path);
      const row = h('div', { class: 'row', style: { paddingLeft: 10 + depth * 18 + 14 + 'px' } },
        iconEl(r.kind === 'img' ? 'image' : 'file'),
        h('span', { class: 'name' }, r.kind === 'md' ? P.stem(r.path) : P.base(r.path)),
        r.kind !== 'md' && r.kind !== 'img' ? h('span', { class: 'ext' }, ext.toUpperCase()) : null,
        s.sort === 'mtime' ? h('span', { class: 'meta' }, relTime(r.mtime)) : null);
      row.addEventListener('click', () => openFile(r.path));
      onLongPress(row, () => fileMenu(r.path));
      tree.append(row);
    }
  };
  walk('', 0);
  v.append(h('button', { class: 'fab', 'aria-label': 'New note', onclick: () => newNote('') }, iconEl('plus')));
}
function folderPicker(title, exclude) {
  return new Promise(resolve => {
    const sheet = h('div', { class: 'sheet' }, h('div', { class: 'grab' }), h('h3', null, title));
    let done = false;
    const close = openOverlay(sheet, () => { if (!done) resolve(null); });
    const list = ['', ...[...Vault.folders()].sort()].filter(f => !exclude || (f !== exclude && !f.startsWith(exclude + '/')));
    for (const f of list) sheet.append(h('button', { class: 'opt', style: { paddingLeft: 22 + (f ? f.split('/').length - 1 : 0) * 16 + 'px' }, onclick: () => { done = true; close(); resolve(f); } }, iconEl('folder'), f ? P.base(f) : 'Vault root'));
    sheet.append(h('button', { class: 'opt', onclick: async () => { const n = await promptText('New folder', { placeholder: 'Folder name' }); if (!n) return; done = true; close(); await Vault.mkdir(n); resolve(P.clean(n)); } }, iconEl('folderPlus'), 'New folder…'));
  });
}
async function newNote(dir, name) {
  name = name || await promptText('New note', { placeholder: 'Untitled', okLabel: 'Create', value: '' }) ;
  if (!name) return;
  if (badName(name)) return toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]');
  const p = Vault.uniquePath(dir, name.replace(/\.md$/i, ''), 'md');
  await Vault.write(p, '');
  if (dir) { Tree.open.add(dir); Tree.save(); }
  openFile(p, { mode: 'edit' });
}
async function newFolder(dir) {
  const name = await promptText('New folder', { placeholder: 'Folder name', okLabel: 'Create' });
  if (!name) return; if (badName(name)) return toast('Invalid folder name');
  const p = P.join(dir, name); if (Vault.folderExists(p)) return toast('Folder already exists');
  await Vault.mkdir(p); if (dir) Tree.open.add(dir); Tree.open.add(p); Tree.save(); UI.render('notes');
}
function folderMenu(f) {
  actionSheet(P.base(f), [
    { label: 'New note here', icon: 'filePlus', onClick: () => newNote(f) },
    { label: 'New folder here', icon: 'folderPlus', onClick: () => newFolder(f) },
    { label: 'Add image here', icon: 'image', onClick: () => pickImages(f) },
    { label: 'Rename', icon: 'edit', onClick: async () => { const n = await promptText('Rename folder', { value: P.base(f) }); if (!n || n === P.base(f)) return; if (badName(n)) return toast('Invalid name'); try { await Vault.rename(f, P.join(P.dir(f), n)); } catch (e) { toast(e.message); } } },
    { label: 'Move to…', icon: 'move', onClick: async () => { const d = await folderPicker('Move folder to', f); if (d == null) return; try { await Vault.rename(f, P.join(d, P.base(f))); } catch (e) { toast(e.message); } } },
    { label: 'Delete folder', icon: 'trash', danger: true, onClick: async () => { const n = Vault.files({ hidden: true }).filter(r => r.path.startsWith(f + '/')).length; if (await confirmBox('Delete folder?', `"${f}" and ${n} file(s) inside will be deleted.`)) { await Vault.remove(f); toast('Folder deleted'); } } },
  ]);
}
function fileMenu(p) {
  const r = Vault.get(p); if (!r) return;
  actionSheet(P.base(p), [
    { label: 'Open', icon: 'eye', onClick: () => openFile(p) },
    { label: 'Rename', icon: 'edit', onClick: () => renameFile(p) },
    { label: 'Move to…', icon: 'move', onClick: async () => { const d = await folderPicker('Move to'); if (d == null) return; try { await Vault.rename(p, P.join(d, P.base(p))); toast('Moved'); } catch (e) { toast(e.message); } } },
    r.kind === 'md' ? { label: 'Duplicate', icon: 'copy', onClick: async () => { const np = Vault.uniquePath(P.dir(p), P.stem(p) + ' copy', 'md'); await Vault.write(np, r.content); toast('Duplicated'); } } : null,
    r.kind === 'img' ? { label: 'Copy embed link', icon: 'link', onClick: () => copyText(`![[${P.base(p)}]]`) } : null,
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete file?', `"${P.base(p)}" will be deleted.`)) { await Vault.remove(p); toast('Deleted'); } } },
  ]);
}
async function renameFile(p) {
  const isMd = P.ext(p) === 'md';
  const n = await promptText('Rename', { value: isMd ? P.stem(p) : P.base(p), hint: isMd ? 'Links to this note will be updated.' : '' });
  if (!n) return null; if (badName(n)) { toast('Invalid name'); return null; }
  const np = P.join(P.dir(p), isMd ? n.replace(/\.md$/i, '') + '.md' : n);
  if (np === p) return p;
  try { await Vault.rename(p, np); return np; } catch (e) { toast(e.message); return null; }
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch { toast('Copy blocked here: ' + t, 4000); } }

function openFile(p, opts = {}) {
  const r = Vault.get(p); if (!r) return toast('File not found');
  if (r.kind === 'img') return openImage(p);
  if (r.kind === 'bin') return actionSheet(P.base(p), [{ label: 'Preview not supported — delete?', icon: 'trash', danger: true, onClick: () => Vault.remove(p) }]);
  openEditor(p, opts);
}
async function openDaily(date) {
  const p = Daily.path(date);
  if (!Vault.exists(p)) await Vault.write(p, '');
  openEditor(p, { mode: 'edit' });
}

/* ---------- image picking ---------- */
function pickImages(dir, onDone) {
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  inp.addEventListener('change', async () => {
    const out = [];
    for (const f of inp.files) {
      const { url, ext } = await prepareImage(f);
      const base = /^image\.|^IMG|^\d|^Screenshot/i.test(f.name) || !f.name ? `Pasted image ${stamp()}` : P.stem(f.name).replace(/[\\/:*?"<>|#^[\]]/g, ' ');
      const p = Vault.uniquePath(dir ?? Settings.get().attachFolder, base, ext);
      await Vault.write(p, url, { kind: 'img' }); out.push(p);
    }
    inp.remove(); if (out.length) { toast(`${out.length} image(s) added`); onDone?.(out); }
  });
  document.body.append(inp); inp.click();
}

/* ---------- image viewer ---------- */
function openImage(p) {
  const r = Vault.get(p);
  const el = h('section', { id: 'imgview' });
  const close = UI.pushScreen(el);
  el.append(topbar(iconBtn('back', () => close(), 'Back'), P.base(p), iconBtn('more', () => fileMenu(p), 'More')),
    h('div', { class: 'crumbs' }, P.dir(p) || 'Vault root'),
    h('div', { class: 'imgview' }, h('img', { src: r.content, alt: P.base(p) })));
  // show where this image is used
  const users = Vault.notes().filter(n => n.content.includes(P.base(p)));
  if (users.length) el.append(h('div', { class: 'backlinks', style: { margin: '0 18px 30px' } }, h('h4', null, 'Embedded in'), users.map(u => h('button', { onclick: () => openEditor(u.path) }, P.stem(u.path)))));
}

/* ---------- editor ---------- */
function openEditor(path, opts = {}) {
  let cur = path, rec = Vault.get(path);
  const isMd = rec.kind === 'md';
  let mode = opts.mode || (isMd && (Settings.get().readDefault && rec.content.trim()) ? 'read' : 'edit');
  if (!isMd) mode = 'edit';
  let lastSaved = rec.content;
  const el = h('section', { id: 'editor' });
  const title = h('input', { class: 'titlein', value: isMd ? P.stem(path) : P.base(path), autocomplete: 'off', enterkeyhint: 'done' });
  const crumbs = h('div', { class: 'crumbs' });
  const ta = h('textarea', { id: 'ed-text', spellcheck: 'true', autocapitalize: 'sentences', placeholder: 'Start writing…  [[ to link, # to tag' });
  const view = h('div', { class: 'scroll' });
  const toolsBar = h('div', { class: 'edtools' });
  const modeT = h('div', { class: 'mode-toggle' });
  const save = debounce(async () => { if (ta.value !== lastSaved && Vault.exists(cur)) { lastSaved = ta.value; await Vault.write(cur, ta.value); } }, 500);
  const close = UI.pushScreen(el, {
    onClose: () => { save.flush(); },
    refresh: () => {
      const r = Vault.get(cur);
      if (!r) { if (!renaming) close(); return; }
      if (r.content !== lastSaved && r.content !== ta.value) { lastSaved = r.content; ta.value = r.content; if (mode === 'read') renderRead(); }
      else if (mode === 'read') renderRead(true);
    },
  });
  let renaming = false;
  const setCrumbs = () => { crumbs.textContent = (P.dir(cur) || 'Vault root') + (Daily.isDailyPath(cur) ? '  ·  ' + prettyDate(Daily.isDailyPath(cur)) : ''); };
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', async () => {
    const n = title.value.trim(), curName = isMd ? P.stem(cur) : P.base(cur);
    if (!n || n === curName) { title.value = curName; return; }
    if (badName(n)) { toast('Names can’t contain \\ / : * ? " < > | # ^ [ ]'); title.value = curName; return; }
    save.flush(); renaming = true;
    try { cur = await Vault.rename(cur, P.join(P.dir(cur), isMd ? n + '.md' : n)); setCrumbs(); toast('Renamed'); }
    catch (e) { toast(e.message); title.value = curName; }
    renaming = false;
  });
  const setMode = m => {
    if (mode !== m && m === 'edit') hlRe = null;
    mode = m; save.flush();
    $$('button', modeT).forEach(b => b.classList.toggle('on', b.dataset.m === m));
    ta.classList.toggle('hidden', m !== 'edit'); toolsBar.classList.toggle('hidden', m !== 'edit');
    view.classList.toggle('hidden', m !== 'read');
    if (m === 'read') renderRead(); else setTimeout(() => ta.focus({ preventScroll: true }), 30);
  };
  if (isMd) for (const [m, l] of [['edit', 'Edit'], ['read', 'Read']]) modeT.append(h('button', { 'data-m': m, onclick: () => setMode(m) }, l));
  el.append(
    topbar(iconBtn('back', () => close(), 'Back'), title, h('div', { style: { display: 'flex', alignItems: 'center', gap: '2px' } }, isMd ? modeT : null, iconBtn('moreV', () => editorMenu(), 'More'))),
    crumbs, ta, view, toolsBar);
  setCrumbs();
  ta.value = rec.content;
  ta.addEventListener('input', () => { save(); suggest(); });
  ta.addEventListener('blur', () => { save.flush(); setTimeout(() => sugEl.remove(), 150); });

  /* -- read mode -- */
  let hlRe = opts.highlight ? new RegExp(opts.highlight.source, opts.highlight.flags) : null;
  function renderRead(keepScroll) {
    const top = view.scrollTop;
    const src = ta.value;
    const md = h('div', { class: 'md' }); md.innerHTML = MD.render(src, cur); MD.postProcess(md);
    view.replaceChildren(md, backlinksEl());
    if (keepScroll) view.scrollTop = top;
    // checkbox toggling writes back to the source line
    const lines = MD.taskLines(src);
    $$('input.task-cb', md).filter(c => !c.closest('.embed')).forEach((cb, i) => {
      cb.addEventListener('click', async e => {
        const li = lines[i]; if (li == null) return;
        const arr = ta.value.split('\n');
        arr[li] = arr[li].replace(/\[([ xX])\]/, (_, c) => c === ' ' ? '[x]' : '[ ]');
        ta.value = arr.join('\n'); lastSaved = ta.value; await Vault.write(cur, ta.value);
        cb.closest('li')?.classList.toggle('done', cb.checked);
      });
    });
    if (!src.trim()) md.append(h('div', { class: 'empty' }, 'Empty note — tap Edit to write.'));
    if (hlRe && keepScroll) highlightIn(md, hlRe);
  }
  view.addEventListener('click', async e => {
    const a = e.target.closest('a.wl, a.tag, img[data-path]');
    if (!a) return;
    e.preventDefault();
    if (a.matches('img')) return openImage(a.dataset.path);
    if (a.classList.contains('tag')) { UI.show('search'); runSearchFor('tag:' + a.dataset.tag); return; }
    const t = a.dataset.target;
    if (a.dataset.missing) {
      const name = P.base(t).replace(/\.md$/i, '');
      if (await confirmBox(`Create "${name}"?`, 'This note doesn’t exist yet.', 'Create', false)) {
        const np = t.includes('/') ? P.clean(t.replace(/\.md$/i, '') + '.md') : Vault.uniquePath(P.dir(cur), name, 'md');
        await Vault.write(np, ''); openEditor(np, { mode: 'edit' });
      }
      return;
    }
    if (t === cur && a.dataset.hash) return scrollToHeading(a.dataset.hash);
    openFile(t, { hash: a.dataset.hash });
  });
  function scrollToHeading(hash) {
    const want = Search.norm(hash.replace(/^\^/, ''));
    const hd = $$('h1,h2,h3,h4,h5,h6', view).find(x => Search.norm(x.textContent).trim() === want.trim());
    if (hd) { hd.scrollIntoView({ block: 'start' }); hd.classList.add('flash'); }
  }
  function backlinksEl() {
    const name = P.stem(cur).toLowerCase(), out = [];
    for (const n of Vault.notes()) {
      if (n.path === cur || !n.content.includes('[[')) continue;
      const lines = n.content.split('\n'); const hits = [];
      lines.forEach((l, i) => { for (const m of l.matchAll(/\[\[([^\]|#]+)/g)) if (Vault.resolve(m[1].trim(), n.path) === cur || m[1].trim().toLowerCase() === name) { hits.push(i); break; } });
      if (hits.length) out.push({ n, line: hits[0], text: lines[hits[0]] });
    }
    if (!out.length) return h('div', { class: 'backlinks' }, h('h4', null, 'No backlinks'));
    return h('div', { class: 'backlinks' }, h('h4', null, `Linked mentions · ${out.length}`),
      out.map(o => h('button', { onclick: () => openEditor(o.n.path, { line: o.line }) }, P.stem(o.n.path), h('small', null, o.text.trim().slice(0, 120)))));
  }

  /* -- edit toolbar -- */
  const insert = (before, after = '', placeholder = '') => {
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || placeholder;
    const text = before + sel + after;
    if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, s, e, 'end');
    const ns = s + before.length; ta.setSelectionRange(ns, ns + sel.length);
    save(); suggest();
  };
  // images go on their own line (replacing an empty list marker left by list continuation)
  const insertImages = ps => {
    ta.focus();
    const txt = ps.map(p => `![[${P.base(p)}]]`).join('\n');
    const v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf('\n', s - 1) + 1, before = v.slice(ls, s);
    if (/^\s*(?:[-*+] (?:\[[ xX]\] )?|\d+\. )$/.test(before)) { ta.setSelectionRange(ls, s); insert(txt + '\n'); }
    else insert((before.trim() ? '\n' : '') + txt + '\n');
  };
  const linePrefix = prefix => {
    ta.focus();
    const v = ta.value, s = ta.selectionStart, ls = v.lastIndexOf('\n', s - 1) + 1;
    const lineEnd = v.indexOf('\n', s), line = v.slice(ls, lineEnd < 0 ? v.length : lineEnd);
    ta.setSelectionRange(ls, ls + line.length);
    let nl;
    if (prefix.startsWith('#')) { const m = /^(#{1,6})\s/.exec(line); const lvl = m ? m[1].length : 0; nl = (lvl >= 3 ? '' : '#'.repeat(lvl + 1) + ' ') + line.replace(/^#{1,6}\s/, ''); }
    else nl = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line.replace(/^(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/, '');
    if (!document.execCommand('insertText', false, nl)) ta.setRangeText(nl, ls, ls + line.length, 'end');
    const pos = ls + nl.length; ta.setSelectionRange(pos, pos); save();
  };
  const tools = [
    ['[[ ]]', () => insert('[[', ']]')], ['#', () => insert('#')], ['H', () => linePrefix('#')],
    ['☐', () => linePrefix('- [ ] ')], ['•', () => linePrefix('- ')], ['B', () => insert('**', '**', 'bold')], ['I', () => insert('*', '*', 'italic')],
    ['==', () => insert('==', '==', 'highlight')], [icon('image'), () => pickImages(null, insertImages)],
    [icon('link'), () => insert('[', '](https://)', 'text')], ['</>', () => insert('`', '`', 'code')], ['❝', () => linePrefix('> ')],
    ['—', () => insert('\n---\n')], [icon('today'), () => insert(`[[${todayStr()}]]`)],
    ['↶', () => { ta.focus(); document.execCommand('undo'); save(); }], ['↷', () => { ta.focus(); document.execCommand('redo'); save(); }],
  ];
  for (const [l, fn] of tools) { const b = h('button', { type: 'button', html: l.startsWith('<svg') ? l : esc(l) }); b.addEventListener('pointerdown', e => e.preventDefault()); b.addEventListener('click', fn); toolsBar.append(b); }
  ta.addEventListener('keydown', e => {
    // continue lists on Enter
    if (e.key !== 'Enter' || e.shiftKey) return;
    const v = ta.value, s = ta.selectionStart; if (s !== ta.selectionEnd) return;
    const ls = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(ls, s);
    const m = /^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )(.*)$/.exec(line); if (!m) return;
    e.preventDefault();
    if (!m[4].trim()) { ta.setSelectionRange(ls, s); document.execCommand('insertText', false, '') || ta.setRangeText('', ls, s, 'end'); save(); return; }
    let mk = m[2]; if (m[3]) mk = (+m[3] + 1) + '. '; mk = mk.replace(/\[[xX]\]/, '[ ]');
    if (!document.execCommand('insertText', false, '\n' + m[1] + mk)) ta.setRangeText('\n' + m[1] + mk, s, s, 'end');
    save();
  });

  /* -- [[ autocomplete -- */
  const sugEl = h('div', { class: 'suggest' });
  function suggest() {
    const s = ta.selectionStart, before = ta.value.slice(Math.max(0, s - 80), s);
    const m = /!?\[\[([^\]\n|]*)$/.exec(before);
    if (!m) { sugEl.remove(); return; }
    const q = Search.norm(m[1]);
    const all = Vault.files().filter(r => r.kind === 'md' || r.kind === 'img');
    const scored = all.map(r => { const n = Search.norm(r.kind === 'md' ? P.stem(r.path) : P.base(r.path)); const i = n.indexOf(q); return { r, sc: !q ? -r.mtime / 1e13 : i === 0 ? 0 : i > 0 ? 1 + i / 100 : null }; })
      .filter(x => x.sc !== null).sort((a, b) => a.sc - b.sc).slice(0, 8);
    sugEl.replaceChildren();
    if (!scored.length) { sugEl.append(h('button', { type: 'button', onpointerdown: e => e.preventDefault(), onclick: () => pick(m[1]) }, `Create link “${m[1]}”`)); }
    for (const { r } of scored) {
      const name = r.kind === 'md' ? P.stem(r.path) : P.base(r.path);
      sugEl.append(h('button', { type: 'button', onpointerdown: e => e.preventDefault(), onclick: () => pick(name) }, name, P.dir(r.path) ? h('small', null, P.dir(r.path)) : null));
    }
    if (!sugEl.isConnected) el.append(sugEl);
    function pick(name) {
      const pos = ta.selectionStart, start = pos - m[1].length;
      const afterClose = ta.value.slice(pos, pos + 2) === ']]';
      ta.setSelectionRange(start, pos);
      const txt = name + (afterClose ? '' : ']]');
      if (!document.execCommand('insertText', false, txt)) ta.setRangeText(txt, start, pos, 'end');
      const np = start + name.length + 2; ta.setSelectionRange(np, np);
      sugEl.remove(); save();
    }
  }

  function editorMenu() {
    actionSheet(P.base(cur), [
      isMd ? { label: 'Insert image', icon: 'image', onClick: () => { setMode('edit'); pickImages(null, insertImages); } } : null,
      { label: 'Rename', icon: 'edit', onClick: async () => { save.flush(); renaming = true; const np = await renameFile(cur); renaming = false; if (np) { cur = np; title.value = isMd ? P.stem(np) : P.base(np); setCrumbs(); } } },
      { label: 'Move to…', icon: 'move', onClick: async () => { save.flush(); const d = await folderPicker('Move to'); if (d == null) return; renaming = true; try { cur = await Vault.rename(cur, P.join(d, P.base(cur))); setCrumbs(); toast('Moved'); } catch (e) { toast(e.message); } renaming = false; } },
      { label: 'Find in this note', icon: 'search', onClick: async () => { const q = await promptText('Find in note', { placeholder: 'text' }); if (q) { setMode('read'); const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); const mk = highlightIn(view.querySelector('.md'), re); if (mk[0]) mk[0].scrollIntoView({ block: 'center' }); toast(`${mk.length} match(es)`); } } },
      { label: 'Copy text', icon: 'copy', onClick: () => copyText(ta.value) },
      { label: `Info · ${ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0} words · edited ${relTime(Vault.get(cur)?.mtime || Date.now())}`, icon: 'clock', onClick: () => { } },
      { label: 'Delete note', icon: 'trash', danger: true, onClick: async () => { if (await confirmBox('Delete note?', `"${P.base(cur)}" will be deleted.`)) { save.cancel(); renaming = true; await Vault.remove(cur); close(); toast('Deleted'); } } },
    ]);
  }

  setMode(mode);
  if (!isMd) modeT.remove();
  // jump to a line / highlight search terms
  if (opts.line != null || opts.highlight) {
    if (mode === 'read') {
      requestAnimationFrame(() => {
        const md = view.querySelector('.md');
        let target = null;
        if (opts.line != null) { for (const b of $$('.blk', md)) { if (+b.dataset.line <= opts.line) target = b; else break; } }
        let marks = [];
        if (opts.highlight) { opts.highlight.lastIndex = 0; marks = highlightIn(md, new RegExp(opts.highlight.source, opts.highlight.flags)); }
        const mk = target ? marks.find(m => target.contains(m)) : marks[0];
        (mk || target)?.scrollIntoView({ block: 'center' });
        target?.classList.add('flash');
      });
    } else {
      const lines = ta.value.split('\n'); let pos = 0; for (let i = 0; i < Math.min(opts.line || 0, lines.length); i++) pos += lines[i].length + 1;
      setTimeout(() => { ta.focus(); ta.setSelectionRange(pos, pos); ta.blur(); ta.focus(); }, 60);
    }
  }
  if (opts.hash) requestAnimationFrame(() => scrollToHeading(opts.hash));
  return el;
}
