/* ---------- Markdown rendering (marked + Obsidian extensions) ---------- */
const MD = (() => {
  const m = new marked.Marked({ gfm: true, breaks: true });
  const ctx = { from: '', depth: 0 };
  const splitAlias = s => { const i = s.indexOf('|'); return i < 0 ? [s.trim(), ''] : [s.slice(0, i).trim(), s.slice(i + 1).trim()]; };
  const isExternal = href => /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');

  function imgTag(path, alt, size) {
    const r = Vault.get(path);
    if (!r) return `<span class="wl missing">${esc(alt || path)}</span>`;
    let style = '';
    if (size) { const [w, hh] = size.split('x'); if (/^\d+$/.test(w)) style = ` style="width:${w}px${hh && /^\d+$/.test(hh) ? `;height:${hh}px;object-fit:cover` : ''}"`; }
    return `<img src="${esc(r.content)}" alt="${esc(alt || P.base(path))}" data-path="${esc(path)}" loading="lazy"${style}>`;
  }
  function renderWiki(t) {
    const path = Vault.resolve(t.target, ctx.from);
    const label = t.alias && !t.embed ? t.alias : t.target;
    if (t.embed) {
      if (path && Vault.get(path).kind === 'img') return imgTag(path, P.base(path), t.alias);
      if (path && Vault.get(path).kind === 'md' && ctx.depth < 1) {
        const sub = render(Vault.read(path), path, ctx.depth + 1, true);
        return `<div class="embed"><a class="wl" data-target="${esc(path)}">${esc(P.stem(path))}</a>${sub}</div>`;
      }
      if (!path && IMG_EXT.has(P.ext(t.target))) return `<span class="wl missing">${esc(t.target)}</span>`;
    }
    const hash = t.target.includes('#') ? t.target.slice(t.target.indexOf('#') + 1) : '';
    return `<a class="wl${path ? '' : ' missing'}" data-target="${esc(path || t.target)}"${hash ? ` data-hash="${esc(hash)}"` : ''}${path ? '' : ' data-missing="1"'}>${esc(label.replace(/#\^?/, ' › '))}</a>`;
  }

  m.use({
    extensions: [
      {
        name: 'wikilink', level: 'inline',
        start(src) { const i = src.search(/!?\[\[/); return i < 0 ? undefined : i; },
        tokenizer(src) { const r = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src); if (r) { const [target, alias] = splitAlias(r[2]); return { type: 'wikilink', raw: r[0], embed: !!r[1], target, alias }; } },
        renderer(t) { return renderWiki(t); },
      },
      {
        name: 'highlight', level: 'inline',
        start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
        tokenizer(src) { const r = /^==(?=\S)([^=\n]*?\S)==/.exec(src); if (r) return { type: 'highlight', raw: r[0], tokens: this.lexer.inlineTokens(r[1]) }; },
        renderer(t) { return '<mark>' + this.parser.parseInline(t.tokens) + '</mark>'; },
      },
      {
        name: 'tag', level: 'inline',
        start(src) { const r = /(^|[\s(])#[\p{L}\p{N}_\/-]*[\p{L}_\/-]/u.exec(src); return r ? r.index + r[1].length : undefined; },
        tokenizer(src) { const r = /^#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/u.exec(src); if (r) return { type: 'tag', raw: r[0], tag: r[1] }; },
        renderer(t) { return `<a class="tag" data-tag="${esc(t.tag)}">#${esc(t.tag)}</a>`; },
      },
    ],
    renderer: {
      checkbox({ checked }) { return `<input type="checkbox" class="task-cb"${checked ? ' checked' : ''}> `; },
      listitem(item) {
        const body = this.parser.parse(item.tokens, !!item.loose);
        return `<li${item.task ? ` class="task${item.checked ? ' done' : ''}"` : ''}>${body}</li>\n`;
      },
      image({ href, title, text }) {
        if (isExternal(href) && !href.startsWith('data:')) return `<img src="${esc(href)}" alt="${esc(text)}">`;
        if (href.startsWith('data:')) return `<img src="${esc(href)}" alt="${esc(text)}">`;
        const path = Vault.resolve(href, ctx.from);
        const sz = /\|(\d+(?:x\d+)?)$/.exec(text);
        return path ? imgTag(path, text, sz?.[1]) : `<span class="wl missing">${esc(text || href)}</span>`;
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (isExternal(href)) return /^(https?|mailto|tel):/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : inner;
        if (href.startsWith('#')) return `<a class="wl" data-target="${esc(ctx.from)}" data-hash="${esc(href.slice(1))}">${inner}</a>`;
        const path = Vault.resolve(href, ctx.from);
        return `<a class="wl${path ? '' : ' missing'}" data-target="${esc(path || href)}"${path ? '' : ' data-missing="1"'}>${inner}</a>`;
      },
    },
  });

  function splitFrontmatter(src) {
    const r = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(src);
    if (!r) return { fm: null, body: src, offset: 0 };
    return { fm: r[1], body: src.slice(r[0].length), offset: r[0].split('\n').length - 1 };
  }
  function fmHtml(fm) {
    const rows = fm.split('\n').filter(l => l.trim()).map(l => {
      const i = l.indexOf(':'); if (i < 0) return `<div>${esc(l)}</div>`;
      return `<div><b>${esc(l.slice(0, i))}</b>: ${esc(l.slice(i + 1).trim())}</div>`;
    });
    return `<div class="props">${rows.join('')}</div>`;
  }

  /** Render to an HTML string; each top-level block gets data-line so search hits can scroll to it. */
  function render(src, from = '', depth = 0, embedded = false) {
    const prev = { ...ctx }; ctx.from = from; ctx.depth = depth;
    try {
      const { fm, body, offset } = splitFrontmatter(src || '');
      const tokens = m.lexer(body);
      let line = offset, out = fm && !embedded ? fmHtml(fm) : '';
      for (const tok of tokens) {
        const arr = [tok]; arr.links = tokens.links;
        if (tok.type !== 'space') out += `<div class="blk" data-line="${line}">${m.parser(arr)}</div>`;
        line += (tok.raw.match(/\n/g) || []).length;
      }
      return out;
    } catch (e) { console.error(e); return `<pre>${esc(src)}</pre>`; }
    finally { Object.assign(ctx, prev); }
  }

  function postProcess(el) {
    // sanitize (notes can come from imported zips)
    el.querySelectorAll('script,iframe,object,embed,link,meta,base,form,style').forEach(n => n.remove());
    el.querySelectorAll('*').forEach(n => {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        if (/^(href|src|xlink:href|action)$/i.test(a.name) && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
    });
    // callouts:  > [!note] Title
    el.querySelectorAll('blockquote').forEach(bq => {
      const p = bq.firstElementChild; if (!p) return;
      const r = /^\s*\[!([\w-]+)\][+-]?\s*([^\n]*)/.exec(p.textContent); if (!r) return;
      const type = r[1].toLowerCase();
      const firstText = [...p.childNodes].find(n => n.nodeType === 3);
      if (firstText) firstText.textContent = firstText.textContent.replace(/^\s*\[![\w-]+\][+-]?\s*/, '');
      const div = h('div', { class: 'callout ' + type });
      const title = h('div', { class: 'callout-title' });
      // title = first line of p
      const brIdx = [...p.childNodes].findIndex(n => n.nodeName === 'BR');
      const titleNodes = brIdx < 0 ? [...p.childNodes] : [...p.childNodes].slice(0, brIdx);
      titleNodes.forEach(n => title.append(n));
      if (brIdx >= 0) p.firstChild?.nodeName === 'BR' && p.firstChild.remove();
      if (!title.textContent.trim()) title.textContent = type;
      div.append(title, ...bq.childNodes); if (!p.textContent.trim() && !p.querySelector('img')) p.remove();
      bq.replaceWith(div);
    });
    el.querySelectorAll('.embed input.task-cb').forEach(c => c.disabled = true);
  }

  /** line indices of "- [ ]" task items (outside code fences, after frontmatter) — matches checkbox DOM order */
  function taskLines(src) {
    const lines = src.split('\n'), out = []; let fence = null;
    const { offset } = splitFrontmatter(src);
    for (let i = offset; i < lines.length; i++) {
      const l = lines[i], f = /^\s*(```|~~~)/.exec(l);
      if (f) { fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1]; continue; }
      if (!fence && /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\](?:\s|$)/.test(l)) out.push(i);
    }
    return out;
  }
  return { render, postProcess, taskLines, splitFrontmatter };
})();

/** wrap occurrences of a regex in <mark class="hl"> inside an element's text nodes */
function highlightIn(el, re) {
  if (!re) return [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('mark,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const marks = [];
  for (const n of nodes) {
    re.lastIndex = 0; const txt = n.textContent; let mm, last = 0; const frag = document.createDocumentFragment(); let any = false;
    while ((mm = re.exec(txt))) {
      if (!mm[0]) { re.lastIndex++; continue; }
      any = true; frag.append(txt.slice(last, mm.index));
      const mk = h('mark', { class: 'hl' }, mm[0]); frag.append(mk); marks.push(mk); last = mm.index + mm[0].length;
    }
    if (any) { frag.append(txt.slice(last)); n.replaceWith(frag); }
  }
  return marks;
}
