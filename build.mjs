// Builds dist/: one self-contained index.html + PWA files. No dependencies: `node build.mjs`
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const r = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const jsDir = new URL('./src/js/', import.meta.url);
const app = readdirSync(jsDir).filter(f => f.endsWith('.js')).sort().map(f => `// ---- ${f} ----\n` + readFileSync(new URL(f, jsDir), 'utf8')).join('\n');
const html = r('./src/index.template.html')
  .replace('/*CSS*/', () => r('./src/style.css'))
  .replace('/*MARKED*/', () => r('./src/vendor/marked.umd.js').replace(/\/\/# sourceMappingURL=.*$/m, ''))
  .replace('/*APP*/', () => app);
const version = createHash('sha1').update(html).digest('hex').slice(0, 10);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/index.html', import.meta.url), html);
writeFileSync(new URL('./dist/sw.js', import.meta.url), r('./src/sw.template.js').replace('__VERSION__', version));
const pub = new URL('./src/public/', import.meta.url);
for (const f of readdirSync(pub)) copyFileSync(new URL(f, pub), new URL('./dist/' + f, import.meta.url));
console.log(`built dist/index.html (${(html.length / 1024).toFixed(0)} KB), version ${version}`);
