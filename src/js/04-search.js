/* ---------- Full-text search: inverted index + prefix/substring/typo-tolerant matching ---------- */
const Search = (() => {
  const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const TOK = /[\p{L}\p{N}]+/gu;
  const tokenize = s => norm(s).match(TOK) || [];
  const docs = new Map();   // path -> {path, name, nameN, kind, lines, counts:Map, tags:Set, headings:Set(lineIdx), mtime}
  const vocab = new Map();  // token -> Set(path)
  let built = false;

  function tagsOf(text) {
    const s = new Set();
    for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_\/-]*[\p{L}_\/-][\p{L}\p{N}_\/-]*)/gu)) s.add(norm(m[1]));
    const { fm } = MD.splitFrontmatter(text);
    if (fm) {
      const r = /^tags?:\s*(.*)$/mi.exec(fm);
      if (r) {
        let list = r[1].trim();
        if (!list) { const after = fm.slice(r.index + r[0].length).split('\n'); for (const l of after) { const x = /^\s*-\s*(.+)$/.exec(l); if (!x) break; s.add(norm(x[1].replace(/^#/, '').trim())); } }
        else list.replace(/[[\]]/g, '').split(/[,\s]+/).filter(Boolean).forEach(t => s.add(norm(t.replace(/^#/, ''))));
      }
    }
    return s;
  }
  function add(rec) {
    if (rec.deleted || rec.kind === 'folder' || P.hidden(rec.path)) return;
    const name = rec.kind === 'md' ? P.stem(rec.path) : P.base(rec.path);
    const text = rec.kind === 'md' || rec.kind === 'txt' ? rec.content : '';
    const lines = text ? text.split('\n') : [];
    const counts = new Map();
    for (const t of tokenize(name + ' ' + text)) counts.set(t, (counts.get(t) || 0) + 1);
    const headings = new Set(); lines.forEach((l, i) => { if (/^#{1,6}\s/.test(l)) headings.add(i); });
    const d = { path: rec.path, name, nameN: norm(name), pathN: norm(rec.path), kind: rec.kind, lines, textN: norm(text), counts, tags: tagsOf(text), headings, mtime: rec.mtime };
    docs.set(rec.path, d);
    for (const t of counts.keys()) { let s = vocab.get(t); if (!s) vocab.set(t, s = new Set()); s.add(rec.path); }
  }
  function remove(path) {
    const d = docs.get(path); if (!d) return;
    for (const t of d.counts.keys()) { const s = vocab.get(t); if (s) { s.delete(path); if (!s.size) vocab.delete(t); } }
    docs.delete(path);
  }
  function build() { docs.clear(); vocab.clear(); for (const r of Vault.files()) add(r); built = true; }
  Vault.on(ev => { if (!built) return; remove(ev.path); if (ev.type === 'write') add(ev.rec); });

  // bounded Damerau-Levenshtein (returns > max early)
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const n = a.length, m = b.length; let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
      const cur = [i]; let rowMin = i;
      for (let j = 1; j <= m; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[m];
  }
  /** expand a query term to vocabulary tokens with weights */
  function expand(term, fuzzy) {
    const out = new Map();
    if (vocab.has(term)) out.set(term, 1);
    const maxD = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
    for (const tok of vocab.keys()) {
      if (tok === term) continue;
      if (tok.startsWith(term)) out.set(tok, Math.max(out.get(tok) || 0, 0.8 - Math.min(0.3, (tok.length - term.length) * 0.03)));
      else if (term.length >= 3 && tok.includes(term)) out.set(tok, Math.max(out.get(tok) || 0, 0.55));
      else if (fuzzy && maxD && tok.length >= 3) {
        const d = dist(term, tok.length > term.length + maxD ? tok.slice(0, term.length + 1) : tok, maxD);
        if (d <= maxD) out.set(tok, Math.max(out.get(tok) || 0, tok.length > term.length + maxD ? 0.35 : (d === 1 ? 0.5 : 0.35)));
      }
    }
    return out;
  }

  function parse(q) {
    const res = { terms: [], phrases: [], not: [], notPhrases: [], tags: [], paths: [], files: [], raw: q.trim() };
    const re = /(-?)(?:(tag|path|file|in):)?(?:"([^"]*)"?|(\S+))/gi; let m;
    while ((m = re.exec(q))) {
      const neg = !!m[1], op = (m[2] || '').toLowerCase(), phrase = m[3], word = m[4];
      const val = phrase ?? word; if (!val) continue;
      if (op === 'tag' || (!op && word && /^#[\p{L}\p{N}_\/-]+$/u.test(word))) { res.tags.push(norm(val.replace(/^#/, ''))); continue; }
      if (op === 'path' || op === 'in') { res.paths.push(norm(val)); continue; }
      if (op === 'file') { res.files.push(norm(val)); continue; }
      if (phrase != null) { const p = norm(phrase).replace(/\s+/g, ' ').trim(); if (p) (neg ? res.notPhrases : res.phrases).push(p); continue; }
      const toks = tokenize(val);
      if (neg) res.not.push(...toks); else res.terms.push(...toks);
    }
    return res;
  }

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** returns {results:[{path, doc, score, snippets:[{line, text}], hits}], total, partial} */
  function run(q, { fuzzy = true, sort = 'relevance', kinds = null } = {}) {
    if (!built) build();
    const Q = parse(q);
    if (!Q.terms.length && !Q.phrases.length && !Q.tags.length && !Q.paths.length && !Q.files.length) return { results: [], total: 0, Q };
    const termMaps = Q.terms.map(t => expand(t, fuzzy));
    const filterOk = d => {
      if (kinds && !kinds.includes(d.kind === 'txt' ? 'md' : d.kind)) return false;
      if (Q.tags.length && !Q.tags.every(t => [...d.tags].some(x => x === t || x.startsWith(t + '/') || x.startsWith(t)))) return false;
      if (Q.paths.length && !Q.paths.every(p => d.pathN.includes(p))) return false;
      if (Q.files.length && !Q.files.every(f => d.nameN.includes(f))) return false;
      if (Q.phrases.length && !Q.phrases.every(p => d.textN.replace(/\s+/g, ' ').includes(p) || d.nameN.includes(p))) return false;
      if (Q.notPhrases.some(p => d.textN.replace(/\s+/g, ' ').includes(p))) return false;
      if (Q.not.some(t => d.counts.has(t))) return false;
      return true;
    };
    const scoreDoc = (d, strict) => {
      let score = 0, matchedTerms = 0; const toks = new Set();
      Q.terms.forEach((t, i) => {
        let best = 0, tf = 0;
        for (const [tok, w] of termMaps[i]) { const c = d.counts.get(tok); if (c) { toks.add(tok); if (w > best) best = w; tf += c * w; } }
        if (d.nameN.includes(t)) { best = Math.max(best, 1); score += 8; }
        if (best) { matchedTerms++; score += best * (2 + Math.log2(1 + tf)); }
      });
      if (strict && matchedTerms < Q.terms.length) return null;
      if (!strict && Q.terms.length && !matchedTerms) return null;
      const whole = norm(Q.raw);
      if (Q.terms.length > 1 && d.textN.includes(Q.terms.join(' '))) score += 6;
      if (d.nameN === whole) score += 25; else if (Q.terms.length && d.nameN.startsWith(Q.terms[0])) score += 4;
      score += Q.phrases.length * 6 + Q.tags.length * 3;
      // heading hits
      for (const li of d.headings) { const ln = norm(d.lines[li]); if (Q.terms.some(t => ln.includes(t))) score += 2; }
      score += 1.5 * Math.exp(-(Date.now() - d.mtime) / (86400000 * 30));
      score *= strict ? 1 : matchedTerms / Q.terms.length;
      return { score, toks };
    };
    let partial = false, out = [];
    for (const d of docs.values()) {
      if (!filterOk(d)) continue;
      const s = scoreDoc(d, true); if (s) out.push({ d, ...s });
    }
    if (!out.length && Q.terms.length > 1) {
      partial = true;
      for (const d of docs.values()) { if (!filterOk(d)) continue; const s = scoreDoc(d, false); if (s) out.push({ d, ...s }); }
    }
    if (sort === 'modified') out.sort((a, b) => b.d.mtime - a.d.mtime);
    else if (sort === 'name') out.sort((a, b) => a.d.name.localeCompare(b.d.name));
    else out.sort((a, b) => b.score - a.score);

    const results = out.slice(0, 200).map(({ d, score, toks }) => {
      const alts = [...toks].sort((a, b) => b.length - a.length).map(escRe);
      const parts = [...Q.phrases.map(p => escRe(p).replace(/ /g, '\\s+')), ...(alts.length ? [`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`] : [])];
      // also highlight the raw terms as substrings (handles accents / partial words)
      Q.terms.forEach(t => { if (t.length >= 2) parts.push(escRe(t)); });
      const re = parts.length ? new RegExp(parts.join('|'), 'giu') : null;
      const tagRe = Q.tags.length ? new RegExp(Q.tags.map(t => '#' + escRe(t)).join('|'), 'giu') : null;
      const snippets = []; let hits = 0;
      d.lines.forEach((line, i) => {
        const n = norm(line);
        let hit = false;
        if (re) { re.lastIndex = 0; if (re.test(n) || (re.lastIndex = 0, re.test(line))) hit = true; }
        if (!hit && tagRe) { tagRe.lastIndex = 0; hit = tagRe.test(line); }
        if (hit) { hits++; if (snippets.length < 3) snippets.push({ line: i, text: line }); }
      });
      return { path: d.path, doc: d, score, snippets, hits, re: re || tagRe };
    });
    return { results, total: out.length, partial, Q };
  }

  /** HTML for a snippet line with highlights, trimmed around the first hit */
  function snippetHtml(text, re) {
    let s = text.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)/, '');
    if (re) {
      re.lastIndex = 0; const m = re.exec(s);
      if (m && m.index > 60) s = '…' + s.slice(m.index - 40);
    }
    if (s.length > 180) s = s.slice(0, 180) + '…';
    if (!re) return esc(s);
    re.lastIndex = 0; let out = '', last = 0, m;
    while ((m = re.exec(s))) { if (!m[0]) { re.lastIndex++; continue; } out += esc(s.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
    return out + esc(s.slice(last));
  }
  function allTags() {
    if (!built) build();
    const c = new Map(); for (const d of docs.values()) for (const t of d.tags) c.set(t, (c.get(t) || 0) + 1);
    return [...c].sort((a, b) => b[1] - a[1]);
  }
  return { run, build, snippetHtml, allTags, norm, parse, get size() { return docs.size; } };
})();
