/* ---------- Search tab ---------- */
const SearchState = { q: '', sort: 'relevance', fuzzy: true, kind: 'all', recent: (() => { try { return JSON.parse(localStorage.getItem('recentSearches') || '[]'); } catch { return []; } })() };
function runSearchFor(q) { SearchState.q = q; UI.render('search'); }
function renderSearch(v) {
  const S = SearchState;
  const input = h('input', { id: 'q', type: 'search', placeholder: 'Search notes, text, images…', value: S.q, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const clear = iconBtn('x', () => { S.q = ''; input.value = ''; draw(); input.focus(); }, 'Clear', 'sm');
  const results = h('div', { class: 'scroll' });
  const chips = h('div', { class: 'chips' });
  v.replaceChildren(topbar(null, 'Search'), h('div', { class: 'searchbar' }, iconEl('search'), input, clear), chips, results);
  const chip = (label, on, fn) => h('button', { class: 'chip' + (on ? ' on' : ''), onclick: () => { fn(); draw(); } }, label);
  function drawChips() {
    chips.replaceChildren(
      chip('Best match', S.sort === 'relevance', () => S.sort = 'relevance'), chip('Recent', S.sort === 'modified', () => S.sort = 'modified'), chip('A–Z', S.sort === 'name', () => S.sort = 'name'),
      chip('Notes', S.kind === 'md', () => S.kind = S.kind === 'md' ? 'all' : 'md'), chip('Images', S.kind === 'img', () => S.kind = S.kind === 'img' ? 'all' : 'img'),
      chip(S.fuzzy ? 'Typo-tolerant ✓' : 'Exact words', S.fuzzy, () => S.fuzzy = !S.fuzzy));
  }
  const remember = debounce(q => { if (q.trim().length < 2) return; S.recent = [q, ...S.recent.filter(x => x !== q)].slice(0, 8); try { localStorage.setItem('recentSearches', JSON.stringify(S.recent)); } catch { } }, 1500);
  function draw() {
    drawChips(); clear.classList.toggle('hidden', !S.q);
    results.replaceChildren();
    if (!S.q.trim()) return drawHelp();
    const t0 = performance.now();
    const { results: res, total, partial } = Search.run(S.q, { fuzzy: S.fuzzy, sort: S.sort, kinds: S.kind === 'all' ? null : [S.kind] });
    const ms = Math.round(performance.now() - t0);
    results.append(h('div', { class: 'stat-line' }, total ? `${total} file${total > 1 ? 's' : ''} · ${res.reduce((a, r) => a + r.hits, 0)} matching lines · ${ms} ms${partial ? ' · showing partial matches' : ''}` : `No results · searched ${Search.size} files`));
    let shown = 0;
    const more = () => {
      for (const r of res.slice(shown, shown + 30)) results.insertBefore(resultEl(r), moreBtn);
      shown += 30; moreBtn.classList.toggle('hidden', shown >= res.length);
    };
    const moreBtn = h('button', { class: 'btn block', style: { margin: '6px 10px 120px', width: 'calc(100% - 20px)' }, onclick: more }, 'Show more');
    results.append(moreBtn); more();
    if (!res.length) { moreBtn.remove(); results.append(h('div', { class: 'empty' }, S.fuzzy ? 'Nothing found. Try fewer words, or check spelling.' : 'Nothing found. Try turning typo-tolerance on.')); }
    remember(S.q);
  }
  function resultEl(r) {
    const d = r.doc;
    const nameHtml = Search.snippetHtml(d.name, r.re);
    const card = h('div', { class: 'res' });
    const head = h('div', { class: 'res-h', onclick: () => openFile(r.path, { highlight: r.re, line: r.snippets[0]?.line }) },
      d.kind === 'img' ? h('img', { class: 'thumb', src: Vault.read(r.path) }) : iconEl('file'),
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { class: 'name', html: nameHtml }), h('div', { class: 'path' }, (P.dir(r.path) || 'Vault root') + ' · ' + relTime(d.mtime))),
      r.hits > r.snippets.length ? h('span', { class: 'meta', style: { color: 'var(--dim)', fontSize: '12px' } }, `+${r.hits - r.snippets.length}`) : null);
    card.append(head);
    for (const s of r.snippets) card.append(h('button', { class: 'snip', onclick: () => openFile(r.path, { highlight: r.re, line: s.line }), html: `<span class="ln">${s.line + 1}</span>` + Search.snippetHtml(s.text, r.re) }));
    return card;
  }
  function drawHelp() {
    if (S.recent.length) {
      results.append(h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Recent', h('button', { onclick: () => { S.recent = []; try { localStorage.removeItem('recentSearches'); } catch { } draw(); } }, 'Clear'))));
      const c = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }); S.recent.forEach(q => c.append(h('button', { class: 'chip', onclick: () => { S.q = q; input.value = q; draw(); } }, q))); results.append(c);
    }
    const tags = Search.allTags().slice(0, 30);
    if (tags.length) {
      results.append(h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Tags')));
      const c = h('div', { class: 'chips', style: { flexWrap: 'wrap' } }); tags.forEach(([t, n]) => c.append(h('button', { class: 'chip', onclick: () => { S.q = 'tag:' + t; input.value = S.q; draw(); } }, `#${t} · ${n}`))); results.append(c);
    }
    results.append(h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Search tips')), h('div', { class: 'search-help', html:
      `Searches every note’s text and every file name, live as you type.<br>
       <code>guitar scales</code> notes with both words (prefix &amp; typo-tolerant)<br>
       <code>"system design"</code> exact phrase<br>
       <code>-draft</code> exclude a word<br>
       <code>#project</code> or <code>tag:project</code> by tag<br>
       <code>path:Daily</code> only inside a folder<br>
       <code>file:meeting</code> match the file name` }));
  }
  input.addEventListener('input', debounce(() => { S.q = input.value; draw(); }, 90));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  draw();
}
