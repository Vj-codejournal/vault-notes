/* ---------- Settings ---------- */
function openSettings() {
  const el = h('section', { id: 'settings', class: 'settings' });
  const body = h('div', { class: 'scroll' });
  const close = UI.pushScreen(el, { refresh: () => draw() });
  const onCloud = () => draw(); Cloud.listeners.add(onCloud); Drive.listeners.add(onCloud);
  const prevClose = UI.screens[UI.screens.length - 1]; prevClose.onClose = () => { Cloud.listeners.delete(onCloud); Drive.listeners.delete(onCloud); };
  el.append(topbar(iconBtn('back', () => close(), 'Back'), 'Settings', h('div', { style: { width: '42px' } })), body);
  async function draw() {
    const s = Settings.get(), files = Vault.files(), notes = files.filter(f => f.kind === 'md'), imgs = files.filter(f => f.kind === 'img');
    const bytes = Vault.files({ hidden: true }).reduce((a, r) => a + (r.content?.length || 0), 0);
    const last = await IDB.kvGet('lastExport');
    const item = (title, sub, onclick, right) => h('div', { class: 'item', onclick }, h('div', { class: 'txt' }, title, sub ? h('small', null, sub) : null), right || (onclick ? iconEl('chev') : null));
    const dotCls = { ok: 'ok', busy: 'busy', err: 'err' }[Cloud.status] || '';
    const top = body.scrollTop;
    body.replaceChildren(
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Storage')),
      h('div', { class: 'card', style: { margin: '0 12px' } },
        item('On this device', `${notes.length} notes · ${imgs.length} images · ${(bytes / 1048576).toFixed(1)} MB${IDB.ok ? '' : ' · ⚠ browser storage unavailable — changes are kept only while open'}`),
        window.claude ? h('div', { class: 'item' }, h('div', { class: 'txt' }, h('span', null, h('span', { class: 'sync-dot ' + dotCls }), 'Cloud backup'), h('small', null, Cloud.msg || 'Off'))) : null,
        item('Export vault (.zip)', last ? 'Last backup ' + relTime(last) : 'Obsidian-compatible: folders, .md files, images', () => exportVault().catch(e => toast('Export failed: ' + e.message)), iconEl('download')),
        item('Import .zip', 'Bring in an Obsidian vault or a backup', () => importFlow(), iconEl('upload'))),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Google Drive backup')),
      h('div', { class: 'card', style: { margin: '0 12px' } }, driveSettingsRows(item)),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Notes')),
      h('div', { class: 'card', style: { margin: '0 12px' } },
        item('Daily notes folder', s.dailyFolder, async () => { const v = await promptText('Daily notes folder', { value: s.dailyFolder }); if (v && !badName(v.replace(/\//g, ''))) await Settings.set({ dailyFolder: P.clean(v) }); }),
        item('Attachments folder', s.attachFolder, async () => { const v = await promptText('Folder for new images', { value: s.attachFolder }); if (v) await Settings.set({ attachFolder: P.clean(v) }); }),
        item('Open notes in', s.readDefault ? 'Reading view' : 'Editing view', () => Settings.set({ readDefault: !s.readDefault })),
        item('Image size limit', `Images are resized to ${s.imgMax}px and compressed`, () => actionSheet('Max image size', [1024, 1600, 2400].map(n => ({ label: n + ' px', icon: n === s.imgMax ? 'check' : null, onClick: () => Settings.set({ imgMax: n }) }))))),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Calendar & habits')),
      h('div', { class: 'card', style: { margin: '0 12px' } },
        item('Week starts on', DOW3[s.weekStart], () => actionSheet('Week starts on', [1, 0, 6].map(d => ({ label: DOW3[d], icon: d === s.weekStart ? 'check' : null, onClick: () => Settings.set({ weekStart: d }) }))))),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Install on your phone')),
      h('div', { class: 'card', style: { margin: '0 12px' } }, h('div', { class: 'note-prev', style: { maxHeight: 'none' } },
        'Android (Chrome): open the app’s link → ⋮ menu → “Add to Home screen” / “Install app”. It then opens full-screen like a normal app and works offline.\n\nKeep a backup: use “Export vault” now and then — it saves a normal Obsidian-style folder as a .zip.')),
      h('div', { class: 'pad' }, h('div', { class: 'section-h' }, 'Danger zone')),
      h('div', { class: 'card', style: { margin: '0 12px 120px' } },
        item('Delete everything', 'Removes all notes, images and habits from this device', async () => { if (await confirmBox('Delete the whole vault?', 'Export a backup first — this cannot be undone.', 'Delete everything')) { for (const r of Vault.all()) await Vault.remove(r.path); toast('Vault cleared'); } })),
    );
    body.scrollTop = top;
  }
  draw();
}
async function importFlow() {
  const inp = h('input', { type: 'file', accept: '.zip,application/zip', style: { display: 'none' } });
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; inp.remove(); if (!f) return;
    const r = await formSheet('Import ' + f.name, form => { form.append(h('p', { style: { color: 'var(--muted)', lineHeight: '1.5', margin: 0 } }, 'Merge adds the zip’s files and overwrites files with the same path. Replace deletes the current vault first.')); return { autofocus: false, value: () => 'merge' }; }, { okLabel: 'Merge', extra: { label: 'Replace' } });
    if (!r) return;
    toast('Importing…', 10000);
    try { const n = await importVault(f, r.extra ? 'replace' : 'merge'); toast(`Imported ${n} files`); } catch (e) { toast('Import failed: ' + e.message, 4000); }
  });
  document.body.append(inp); inp.click();
}

/* ---------- first run ---------- */
const WELCOME = `# Welcome to your vault 👋

This works like Obsidian: every note is a plain **Markdown** file inside folders. Export the vault as a .zip any time (Settings ⚙) and open it in Obsidian.

## Writing
- Link notes with \`[[Note name]]\` → [[Ideas]]  (tap a missing link to create it)
- Tag with #inbox or #project/app
- Images: tap the 🖼 button in the editor; they're saved in \`attachments/\` and embedded as \`![[image.webp]]\`
- ==Highlight==, **bold**, *italic*, \`code\`, > quotes, tables
- Tasks you can tick in reading view:
- [ ] Try the calendar tab
- [ ] Set up my habits
- [x] Open the app

> [!tip] Search
> The Search tab looks inside **every note**, file name and image name. It handles typos, partial words, "exact phrases", -exclusions, #tags and path:folder filters.

## Calendar
Each day has events, to-dos and a daily note. They live in \`Daily Notes/YYYY-MM-DD.md\`, so search finds them too.

## Habits
Tick habits on the Habits tab or from any day in the calendar. **Overall** shows a GitHub-style heatmap per habit; tap one for streaks and a full-year view.
`;
async function seedVault() {
  await Vault.write('Welcome.md', WELCOME, { mtime: 1, ctime: 1 });
  await Vault.write(HABITS_PATH, Habits.seed(), { mtime: 1, ctime: 1 });
}

function registerSW() {
  if (IS_NATIVE || window.claude || inFrame() || !('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}

async function main() {
  Nav.init();
  await Vault.init();
  let seeded = false; try { seeded = !!(await IDB.kvGet('seeded')); } catch { }
  if (!seeded && !Vault.map.size) { await seedVault(); }
  await IDB.kvSet('seeded', 1);
  UI.init();
  Water.start();
  Cloud.init();
  Drive.init().catch(e => console.warn('drive', e));
  registerSW();
  (window.requestIdleCallback || setTimeout)(() => Search.build());
  // re-render when the day changes (app left open overnight)
  let day = todayStr();
  setInterval(() => { if (todayStr() !== day) { day = todayStr(); HabState.date = day; CalState.sel = day; UI.scheduleRefresh(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && todayStr() !== day) { day = todayStr(); HabState.date = day; UI.scheduleRefresh(); } });
}
main().catch(e => { console.error(e); document.body.append(h('pre', { style: { color: '#f66', padding: '20px', whiteSpace: 'pre-wrap' } }, 'Startup error: ' + (e.stack || e))); });
