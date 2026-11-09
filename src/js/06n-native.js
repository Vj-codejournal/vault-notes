/* ---------- Native bridge (Capacitor Android app). In a browser every native feature reports "unavailable". ----------
   Plugins come from window.Capacitor.Plugins.<Name> (injected by the native shell; no bundler/imports). */
const IS_NATIVE = !!window.Capacitor?.isNativePlatform?.();
const capPlugin = name => (IS_NATIVE && window.Capacitor?.Plugins?.[name]) || null;
const NativeWater = (() => {
  const wt = capPlugin('WaterTap'), app = capPlugin('App'), fns = new Set();
  let hooked = false;
  // App 'resume' (onResume, also after the NFC activity covered us), visibilitychange, and WaterTap 'pending'
  // (a sticker was tapped while the app is open) can arrive together: coalesce them into one call.
  const fire = debounce(() => fns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }), 200);
  const hook = () => {
    if (hooked) return; hooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fire(); });
    try { app?.addListener('resume', fire); } catch (e) { console.warn('App.resume', e); }
    try { wt?.addListener('pending', fire); } catch (e) { console.warn('WaterTap.pending', e); }
  };
  const err = e => e instanceof Error ? e : new Error(e?.message || String(e));
  return {
    available: !!wt,
    async drain() {
      if (!wt) return [];
      const r = await wt.drain();
      return (r?.taps || []).filter(t => t && t.ml > 0 && /^\d{4}-\d\d-\d\d$/.test(t.day)).map(t => ({ ts: +t.ts || Date.now(), ml: +t.ml, day: t.day }));
    },
    async setMirror({ date, totalMl, goalMl, tapMl }) { if (wt) await wt.setMirror({ date, totalMl: Math.round(totalMl) || 0, goalMl: Math.round(goalMl) || 0, tapMl: Math.round(tapMl) || 100 }); },
    async writeTag(ml) {
      if (!wt) throw new Error('NFC is only available in the Android app');
      try { await wt.writeTag({ ml: Math.round(ml) }); } catch (e) { throw err(e); }
    },
    async cancelWrite() { if (wt) await wt.cancelWrite().catch(() => { }); },
    async nfcState() { if (!wt) return { supported: false, enabled: false }; const r = await wt.nfcState(); return { supported: !!r?.supported, enabled: !!r?.enabled }; },
    onResume(fn) { hook(); fns.add(fn); return () => fns.delete(fn); },
  };
})();
// Android back button: let the web history close sheets/screens (Nav keeps one entry while anything is open);
// at the root, send the app to the background like a normal Android app instead of doing nothing.
if (IS_NATIVE) try {
  const app = capPlugin('App');
  app?.addListener('backButton', ({ canGoBack } = {}) => { if (canGoBack) history.back(); else (app.minimizeApp || app.exitApp).call(app); });
} catch (e) { console.warn('backButton', e); }
