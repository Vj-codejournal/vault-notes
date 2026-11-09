/* ---------- Google Drive auto-backup ----------
   Scope drive.file: the app only sees files it created. Zips go to "Vault Backups"; the newest DRIVE_KEEP are kept.
   Android app: native DriveAuth plugin (Google Identity AuthorizationClient), silent after the first consent.
   Browser: Google Identity Services token client (popup, so only on a tap; auto backup reuses a still-valid token). */
const GOOGLE = {
  // OAuth client of type "Web application" (…apps.googleusercontent.com). Empty = Drive backup "Not configured" on the web.
  // The Android app needs no id here: Google matches its "Android" client by package name + signing SHA-1.
  webClientId: '',
};
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file', DRIVE_FOLDER = 'Vault Backups', DRIVE_KEEP = 10;
const authErr = (msg, code) => Object.assign(new Error(msg), { code });
let gisP;
const loadGis = () => gisP ||= new Promise((res, rej) => {
  if (window.google?.accounts?.oauth2) return res();
  document.head.append(h('script', { src: 'https://accounts.google.com/gsi/client', async: true, onload: () => res(), onerror: () => { gisP = null; rej(new Error('Couldn’t load Google sign-in (offline?)')); } }));
});
const Drive = {
  connected: false, email: '', last: 0, busy: false, status: '', msg: '', tok: '', exp: 0, nagAt: 0, listeners: new Set(),
  set(status, msg = '') { this.status = status; this.msg = msg; this.listeners.forEach(f => f()); },
  auth() { return capPlugin('DriveAuth'); },
  configured() { return IS_NATIVE ? !!this.auth() : !!GOOGLE.webClientId; },
  everyDays() { const n = +Settings.get().driveEveryDays; return [1, 3, 7].includes(n) ? n : 3; },
  async init() {
    const d = await IDB.kvGet('drive');
    this.connected = !!d; this.email = d?.email || ''; this.last = (await IDB.kvGet('lastDriveBackup')) || 0;
    const t = !IS_NATIVE && await IDB.kvGet('driveTok'); if (t?.exp > Date.now()) { this.tok = t.t; this.exp = t.exp; }
    NativeWater.onResume(() => this.auto());
    setTimeout(() => this.auto(), 4000);
  },
  /** startup / resume: back up silently when one is due */
  auto() {
    if (!this.connected || this.busy || !this.configured() || navigator.onLine === false) return;
    if (Date.now() - this.last >= this.everyDays() * 864e5) this.backup({ quiet: true });
  },
  async token(interactive) {
    if (this.tok && Date.now() < this.exp - 120000) return this.tok;
    if (IS_NATIVE) {
      const r = await this.auth().authorize({ interactive: !!interactive, email: this.email || undefined }).catch(e => { throw authErr(e?.message || String(e), e?.code); });
      if (r.email && !this.email) this.email = r.email;
      this.tok = r.accessToken; this.exp = Date.now() + 50 * 60000; return this.tok;
    }
    if (!interactive) throw authErr('Google sign-in needed', 'consent_required');
    await loadGis();
    const r = await new Promise((res, rej) => google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE.webClientId, scope: DRIVE_SCOPE, login_hint: this.email || undefined,
      callback: r => r.error ? rej(authErr(r.error_description || r.error, r.error)) : res(r),
      error_callback: e => rej(authErr(e?.type === 'popup_closed' ? 'cancelled' : e?.message || 'Google sign-in failed', e?.type === 'popup_closed' ? 'cancelled' : e?.type)),
    }).requestAccessToken());
    if (!google.accounts.oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) throw authErr('Drive access wasn’t granted — tick the Google Drive box when connecting', 'denied');
    this.tok = r.access_token; this.exp = Date.now() + (+r.expires_in || 3600) * 1000;
    await IDB.kvSet('driveTok', { t: this.tok, exp: this.exp });
    return this.tok;
  },
  async dropToken() {
    const t = this.tok; this.tok = ''; this.exp = 0;
    if (IS_NATIVE) { if (t) await this.auth()?.clearToken({ token: t }).catch(() => { }); } else await IDB.kvSet('driveTok', null);
  },
  async api(method, path, opts = {}, retry = true) {
    const tok = await this.token(opts.interactive);
    let res;
    try { res = await fetch(/^https:/.test(path) ? path : 'https://www.googleapis.com/drive/v3/' + path, { method, body: opts.body, headers: { Authorization: 'Bearer ' + tok, ...(opts.type ? { 'Content-Type': opts.type } : {}) } }); }
    catch { throw authErr('Can’t reach Google Drive (offline?)', 'offline'); }
    if (res.status === 401 && retry) { await this.dropToken(); return this.api(method, path, opts, false); }
    if (!res.ok) { let m = 'HTTP ' + res.status; try { m = (await res.json()).error?.message || m; } catch { } throw Object.assign(new Error('Drive: ' + m), { status: res.status }); }
    return res.status === 204 ? null : res.json().catch(() => null);
  },
  async folderId(interactive) {
    let id = await IDB.kvGet('driveFolderId');
    if (id) { try { const f = await this.api('GET', `files/${id}?fields=id,trashed`, { interactive }); if (f && !f.trashed) return id; } catch (e) { if (e.status !== 404) throw e; } }
    const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    id = (await this.api('GET', `files?q=${q}&spaces=drive&fields=files(id)`, { interactive }))?.files?.[0]?.id
      || (await this.api('POST', 'files?fields=id', { interactive, type: 'application/json', body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).id;
    await IDB.kvSet('driveFolderId', id); return id;
  },
  async prune(folder) {
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
    const files = ((await this.api('GET', `files?q=${q}&orderBy=createdTime%20desc&pageSize=100&fields=files(id,name)`))?.files || []).filter(f => /^vault-.*\.zip$/.test(f.name));
    for (const f of files.slice(DRIVE_KEEP)) await this.api('DELETE', 'files/' + f.id).catch(e => console.warn('drive prune', e));
  },
  async backup({ interactive = false, quiet = false } = {}) {
    if (this.busy) return;
    this.busy = true; this.set('busy', 'Backing up…');
    try {
      const folder = await this.folderId(interactive), blob = await buildVaultZip(), d = new Date();
      const name = `vault-${todayStr()}-${pad2(d.getHours())}${pad2(d.getMinutes())}.zip`, b = 'vault-' + uid();
      const meta = JSON.stringify({ name, parents: [folder], mimeType: 'application/zip' });
      const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/zip\r\n\r\n`, blob, `\r\n--${b}--\r\n`]);
      await this.api('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { body, type: 'multipart/related; boundary=' + b });
      await this.prune(folder).catch(e => console.warn('drive prune', e));
      this.last = Date.now(); await IDB.kvSet('lastDriveBackup', this.last);
      this.busy = false; this.set('ok');
      if (!quiet) toast('Backed up to Google Drive');
    } catch (e) {
      this.busy = false;
      if (e.code === 'cancelled') return this.set('');
      if (e.code === 'consent_required') {
        this.set('err', 'Backup due — tap “Back up now”');
        if (quiet && Date.now() - this.nagAt > 6 * 3600e3) { this.nagAt = Date.now(); toast('Drive backup due — tap Settings to back up', 4000); }
        return;
      }
      console.warn('drive backup', e); this.set('err', e.message);
      if (!quiet) toast('Drive backup failed: ' + e.message, 4000);
    }
  },
  async connect() {
    if (this.busy) return;
    this.busy = true; this.email = ''; this.set('busy', 'Connecting…');
    try {
      await this.dropToken(); await IDB.kvSet('driveFolderId', null);
      await this.token(true);
      try { this.email = (await this.api('GET', 'about?fields=user(emailAddress)'))?.user?.emailAddress || this.email; } catch (e) { console.warn('drive about', e); }
      this.connected = true; await IDB.kvSet('drive', { email: this.email, at: Date.now() });
    } catch (e) {
      this.busy = false;
      if (e.code === 'cancelled') return this.set('');
      this.set('err', e.message); toast('Couldn’t connect Google Drive: ' + e.message, 5000); return;
    }
    this.busy = false;
    await this.backup({ interactive: true });
  },
  async disconnect() {
    const t = this.tok;
    if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST', mode: 'no-cors' }).catch(() => { });
    await this.dropToken();
    this.connected = false; this.email = '';
    for (const k of ['drive', 'driveFolderId', 'driveTok']) await IDB.kvSet(k, null);
    this.set(''); toast('Google Drive disconnected');
  },
};

/* Settings → "Google Drive backup" rows (item = the Settings row helper) */
function driveSettingsRows(item) {
  const D = Drive, ok = D.configured(), every = D.everyDays(), days = n => n === 1 ? 'Every day' : `Every ${n} days`;
  if (ok && !IS_NATIVE) loadGis().catch(() => { }); // preload so the sign-in popup opens straight from the tap
  const dot = !ok || !D.connected && D.status !== 'busy' ? '' : { busy: 'busy', err: 'err' }[D.status] || 'ok';
  const sub = !ok ? 'Not configured — see “How to set up” below' : D.status === 'busy' || D.status === 'err' ? D.msg
    : D.connected ? `${D.email || 'Connected'} · ${D.last ? 'last backup ' + relTime(D.last) : 'no backup yet'}` : 'Not connected';
  return [
    h('div', { class: 'item' }, h('div', { class: 'txt' }, h('span', null, h('span', { class: 'sync-dot ' + dot }), 'Google Drive'), h('small', null, sub))),
    ok && !D.connected ? item('Connect Google Drive', `Saves a .zip of the vault to “${DRIVE_FOLDER}” in your Drive`, () => D.connect(), iconEl('cloud')) : null,
    ok && D.connected ? item('Back up now', `Keeps the newest ${DRIVE_KEEP} backups`, () => D.backup({ interactive: true }), iconEl('upload')) : null,
    ok && D.connected ? item('Automatic backup', days(every), () => actionSheet('Back up to Drive', [1, 3, 7].map(n => ({ label: days(n), icon: n === every ? 'check' : null, onClick: () => Settings.set({ driveEveryDays: n }) })))) : null,
    ok && D.connected ? item('Disconnect', D.email || 'Stop backing up to Google Drive', async () => { if (await confirmBox('Disconnect Google Drive?', 'Automatic backups stop. Backups already in your Drive stay there.', 'Disconnect')) D.disconnect(); }) : null,
    item('How to set up', ok ? 'Google Cloud project and OAuth clients' : 'One-time setup in Google Cloud — tap for the steps', driveHelp),
  ];
}
function driveHelp() {
  formSheet('Google Drive setup', form => {
    form.append(h('div', { class: 'note-prev', style: { maxHeight: 'none', padding: '0', userSelect: 'text' } },
      `One-time setup, about 10 minutes:

1. console.cloud.google.com → create a project → APIs & Services → Library → enable “Google Drive API”.

2. OAuth consent screen: External, Testing. Add your Google account as a test user. Scope: …/auth/drive.file (the app only sees the backups it creates).

3. Credentials → Create credentials → OAuth client ID:
• Android: package com.vjcodejournal.vault + the SHA-1 of the key that signs the APK (debug key: keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android).
• Web application: authorized JavaScript origin https://vj-codejournal.github.io (add http://localhost:8080 for local testing).

4. Put the Web client ID into GOOGLE.webClientId in src/js/06d-drive.js and rebuild. The Android app needs no ID in the code.

Then: Settings → Connect Google Drive. Backups run when the app starts or comes back to the front and one is due.`));
    return { autofocus: false };
  }, { okLabel: 'OK' });
}
