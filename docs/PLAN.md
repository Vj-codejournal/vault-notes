# Vault — Phase 1 plan: WaterTap, Android APK, Google Drive backup

Keep the repo's style: vanilla JS, no frameworks, the `h()` DOM helper, dense code, and `src/js/NN-name.js` files concatenated **in sorted filename order** by `build.mjs`.
`11-settings-main.js` calls `main()` at the very end, so new files must sort **before** it. `const` and `let` in later files would still be in TDZ when startup code runs.
The web build (GitHub Pages) must keep working; every native feature degrades to "unavailable" in a browser.

## 1. WaterTap (water tracking)

### Data: `.app/water-log/YYYY.json` (new file `src/js/05w-water.js`)
```
{ "YYYY-MM-DD": { "<entryId>": [ml, ts, src, delTs?] } }
```
- `src` is `'nfc' | 'manual' | 'adjust'`. If `delTs` is present, the entry is a tombstone (deleted), which keeps device merges correct.
- Extend `mergeAppJson` (in `06-sync.js`) for `^\.app\/water-log\/\d{4}\.json$`: union entries by id per day. A tombstone wins, using the larger `delTs`.
- The `Water` object API:
  - `entries(date)`: live entries sorted by ts.
  - `total(date)` in ml.
  - `add(date, ml, src, ts=Date.now())`, which returns an id.
  - `remove(date, id)` and `restore(date, id)` (for undo).
  - `goalMl()`.
  - `habit()`: the linked habit.
- **Linked habit:** setting `waterHabitId` (default `'h-water'`). After every change, call `Habits.setValue(habitId, date, total/1000)`, because the habit unit is litres. `goalMl()` is `habit.target * 1000` (fallback 2500). If no linked habit exists, the Water tab offers "Create Water habit (target 3.5 L)".
- **Habit card and day editor** for the linked habit (`10-ui-habits.js`):
  - `+` adds a `'manual'` entry of `step*1000` ml.
  - `−` tombstones the newest live entry of that day.
  - `dayEdit` setting a value adds an `'adjust'` entry for the difference.
  - Other habits are unchanged.
- **New settings** (in `DEFAULT_SETTINGS`): `waterHabitId: 'h-water'`, `tapMl: 100`.

### UI: 5th bottom tab "Water" (new file `src/js/10w-ui-water.js`, plus the tab in `07-ui-core.js`, CSS in `style.css`)
- **Glass:** an animated SVG glass that fills to total/goal (capped visually), with a gently moving wave and a smooth transition when the level changes. "1,300 ml" large, "of 3,500 ml · 37%" below, "Goal reached 🎉" at 100%. Use the existing dark theme variables.
- **Quick add:** `+{tapMl}`, `+250`, `Custom…` (formSheet with a number input).
- **Today's log:** time, ml, source icon (NFC / hand). Tap → action sheet to delete. Delete shows a toast with an **Undo** action, if the toast helper supports actions (add an optional action if not).
- **Month calendar:** like the Calendar tab's month grid. Each day shows a filled circle tinted by % of goal, with a check at ≥100%. Monthly stats: days goal met, average per day (elapsed days), month total. Tapping a day opens a sheet with that day's entries: delete, plus "Add entry" with amount and time.
- **Sticker section:** shown only when `NativeWater.available`. Tapping "Program NFC sticker" asks for the amount (default `tapMl`), shows "Hold the sticker to the back of the phone…", calls `NativeWater.writeTag(ml)`, and shows the result. It also has an editable "Amount per tap" setting.
- **Keeping native in step:**
  - On startup, on resume and on every water change, call `NativeWater.drain()` and add each pending tap with `Water.add(tap.day, tap.ml, 'nfc', tap.ts)`.
  - Then call `NativeWater.setMirror({ date: today, totalMl, goalMl, tapMl })`.

## 2. Native bridge contract (JS side in `src/js/06n-native.js`)
```js
const NativeWater = {
  available,            // true only inside the Capacitor Android app with the plugin present
  async drain(),        // -> [{ ts, ml, day:'YYYY-MM-DD' }] and clears native pending queue; [] on web
  async setMirror({ date, totalMl, goalMl, tapMl }),   // no-op on web
  async writeTag(ml),   // resolves when written; rejects Error(message) (incl. 'cancelled', 'NFC is off')
  async cancelWrite(),
  async nfcState(),     // -> { supported, enabled }
  onResume(fn),         // app resumed (Capacitor App 'resume' or visibilitychange) – web: visibilitychange
};
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
```
Plugins are accessed through `window.Capacitor.Plugins.<Name>`, since there is no bundler.

## 3. Capacitor Android app
- `capacitor.config.json`: `appId: "com.vjcodejournal.vault"`, `appName: "Vault"`, `webDir: "dist"`.
- Capacitor **6** (JDK 17 is installed; 7+ needs JDK 21). devDependencies only: `@capacitor/cli`, `@capacitor/core`, `@capacitor/android`, `@capacitor/app` (and the Google sign-in plugin).
- npm scripts:
  - `"android": "node build.mjs && npx cap sync android"`
  - `"apk": "npm run android && cd android && gradlew.bat assembleDebug"`
- Commit the `android/` folder, except its build outputs.
- `registerSW()` must skip on native.
- **Native code** (Java, in `android/app/src/main/java/com/vjcodejournal/vault/`):
  - **`NfcTapActivity`:** transparent, `excludeFromRecents`, `noHistory`, `taskAffinity=""`. Intent filter `NDEF_DISCOVERED` with scheme `watertap`, host `add`.
    - Parses `ml` (1..10000, otherwise the mirror's `tapMl` or 100). Applies a 3 s debounce.
    - Appends `{ts, ml, day}` to a SharedPreferences JSON queue.
    - Toast: `+100 ml · Today 1,400 / 3,500 ml`. The total is the mirror total (if the mirror date is today) plus today's pending. Then vibrate 60 ms and finish.
  - **`WaterTapPlugin`** (`@CapacitorPlugin(name="WaterTap")`):
    - `drain`, `setMirror`, `nfcState`.
    - `writeTag`: enable reader mode on the activity, write an NDEF message of [URI `watertap://add?ml=N`, AAR `com.vjcodejournal.vault`], format if `NdefFormatable`, then disable reader mode.
    - `cancelWrite`.
    - Registered in `MainActivity`.
  - **Manifest:** NFC + VIBRATE permissions, `uses-feature nfc required=false`.

## 4. Google Drive auto-backup (`src/js/06d-drive.js`, plus a Settings section)
- **Shared zip builder:** refactor `exportVault` into `buildVaultZip()` → Blob. `exportVault` keeps downloading it.
- **Auth:** OAuth scope `https://www.googleapis.com/auth/drive.file`, so the app only sees the files it creates.
  - **Native:** a Capacitor 6-compatible Google sign-in plugin, giving an access token (silent refresh where possible).
  - **Web:** Google Identity Services token client, loaded on demand.
  - **Config:** the client IDs live in one config const `GOOGLE = { webClientId: '' }`. When it is empty, the Settings section shows "Not configured" with setup help.
- **Backup:**
  - Find or create the folder `Vault Backups` (cache its id in `IDB.kv`).
  - Multipart upload `vault-YYYY-MM-DD-HHmm.zip`, then delete all but the newest 10 in that folder.
  - Record `lastDriveBackup` in kv and update the status.
- **Auto:**
  - On startup and on resume, if Drive is connected and `now - lastDriveBackup >= intervalDays` (setting `driveEveryDays`, default 3; options 1/3/7), back up silently.
  - If a silent token isn't possible, show a toast "Drive backup due — tap Settings to back up".
- **Settings section "Google Drive backup":** status dot, account email, last backup (relTime), Connect / Disconnect, Back up now, Every N days, how-to-set-up text.
- **One-time setup (the user does this):**
  - In Google Cloud, create a project and enable the Drive API.
  - Configure the OAuth consent screen (External, Testing, add yourself as a test user).
  - Create an **Android** OAuth client (package `com.vjcodejournal.vault` + debug keystore SHA-1) and a **Web** client (authorized JS origin `https://vj-codejournal.github.io`).
  - Put the web client id in the config.

## 5. Phase 2 (not now): encrypted password vault
- WebCrypto. A random 256-bit data key (DEK) encrypts items with AES-GCM.
- The DEK is wrapped twice:
  - by a key from the master password (PBKDF2-SHA256, ≥600k iterations, random salt);
  - by a **recovery key** (random 128–256 bit, shown once as words or base32 for the user to write down).
- Stored as ciphertext only, in `.app/secrets.json`, so Drive backups and sync never hold plaintext.
- Auto-lock on background or timeout. Copy-to-clipboard clears after 30 s.

## Verification
- `node build.mjs` succeeds, and the web app still works in a browser (no native errors).
- `npm run apk` produces `android/app/build/outputs/apk/debug/app-debug.apk`.
