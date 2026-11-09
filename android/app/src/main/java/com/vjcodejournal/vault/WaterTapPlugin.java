package com.vjcodejournal.vault;

import android.app.Activity;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Bundle;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

/**
 * JS bridge for WaterTap (window.Capacitor.Plugins.WaterTap):
 * drain() / setMirror() / nfcState() / writeTag({ml}) / cancelWrite(), plus a "pending" event when a sticker
 * is tapped while the app is running.
 */
@CapacitorPlugin(name = "WaterTap")
public class WaterTapPlugin extends Plugin {

    private static WeakReference<WaterTapPlugin> instance = new WeakReference<>(null);
    private static final int READER_FLAGS =
        NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V;

    private PluginCall writeCall;
    private NdefMessage writeMsg;

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    /** Called by NfcTapActivity after it queued a tap, so an open app can drain it right away. */
    static void notifyPending(JSONObject tap) {
        WaterTapPlugin p = instance.get();
        if (p == null) return;
        try {
            p.notifyListeners("pending", new JSObject(tap.toString()));
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void drain(PluginCall call) {
        try {
            call.resolve(new JSObject().put("taps", new JSArray(WaterStore.drain(getContext()).toString())));
        } catch (Exception e) {
            call.reject("drain failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setMirror(PluginCall call) {
        JSObject m = new JSObject();
        m.put("date", call.getString("date", ""));
        m.put("totalMl", call.getInt("totalMl", 0));
        m.put("goalMl", call.getInt("goalMl", 0));
        m.put("tapMl", call.getInt("tapMl", 100));
        WaterStore.setMirror(getContext(), m);
        call.resolve();
    }

    @PluginMethod
    public void nfcState(PluginCall call) {
        NfcAdapter a = NfcAdapter.getDefaultAdapter(getContext());
        call.resolve(new JSObject().put("supported", a != null).put("enabled", a != null && a.isEnabled()));
    }

    @PluginMethod
    public void writeTag(PluginCall call) {
        NfcAdapter a = NfcAdapter.getDefaultAdapter(getContext());
        if (a == null) {
            call.reject("NFC is not supported on this phone");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("NFC is off");
            return;
        }
        Integer ml = call.getInt("ml");
        if (ml == null) ml = WaterStore.tapMl(getContext());
        if (ml < 1 || ml > 10000) {
            call.reject("Amount must be between 1 and 10000 ml");
            return;
        }
        NdefMessage msg = new NdefMessage(
            new NdefRecord[] {
                NdefRecord.createUri("watertap://add?ml=" + ml),
                NdefRecord.createApplicationRecord(getContext().getPackageName())
            }
        );
        PluginCall prev;
        synchronized (this) {
            prev = writeCall;
            writeCall = call;
            writeMsg = msg;
        }
        if (prev != null) prev.reject("cancelled");
        enableReader();
    }

    @PluginMethod
    public void cancelWrite(PluginCall call) {
        PluginCall prev;
        synchronized (this) {
            prev = writeCall;
            writeCall = null;
            writeMsg = null;
        }
        disableReader();
        if (prev != null) prev.reject("cancelled");
        call.resolve();
    }

    private void enableReader() {
        Activity act = getActivity();
        if (act == null) return;
        act.runOnUiThread(() -> {
            NfcAdapter a = NfcAdapter.getDefaultAdapter(getContext());
            if (a == null) return;
            Bundle opts = new Bundle();
            opts.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250);
            try {
                a.enableReaderMode(act, this::onTag, READER_FLAGS, opts);
            } catch (Exception e) {
                fail("Couldn't start NFC: " + e.getMessage());
            }
        });
    }

    private void disableReader() {
        Activity act = getActivity();
        if (act == null) return;
        act.runOnUiThread(() -> {
            NfcAdapter a = NfcAdapter.getDefaultAdapter(getContext());
            try {
                if (a != null) a.disableReaderMode(act);
            } catch (Exception ignored) {}
        });
    }

    private void fail(String msg) {
        PluginCall c;
        synchronized (this) {
            c = writeCall;
            writeCall = null;
            writeMsg = null;
        }
        if (c != null) c.reject(msg);
    }

    /** Reader-mode callback (binder thread). */
    private void onTag(Tag tag) {
        NdefMessage msg;
        PluginCall call;
        synchronized (this) {
            call = writeCall;
            msg = writeMsg;
        }
        if (call == null || msg == null) return;
        String err = write(tag, msg);
        synchronized (this) {
            if (writeCall != call) return; // cancelled meanwhile
            writeCall = null;
            writeMsg = null;
        }
        disableReader();
        if (err == null) {
            WaterStore.vibrate(getContext(), 60);
            call.resolve(new JSObject().put("ok", true));
        } else {
            call.reject(err);
        }
    }

    private static String write(Tag tag, NdefMessage msg) {
        try {
            Ndef ndef = Ndef.get(tag);
            if (ndef != null) {
                ndef.connect();
                try {
                    if (!ndef.isWritable()) return "This sticker is read-only";
                    int size = msg.toByteArray().length;
                    if (ndef.getMaxSize() < size) return "Sticker too small (" + ndef.getMaxSize() + " bytes, need " + size + ")";
                    ndef.writeNdefMessage(msg);
                    return null;
                } finally {
                    try {
                        ndef.close();
                    } catch (Exception ignored) {}
                }
            }
            NdefFormatable f = NdefFormatable.get(tag);
            if (f != null) {
                f.connect();
                try {
                    f.format(msg);
                    return null;
                } finally {
                    try {
                        f.close();
                    } catch (Exception ignored) {}
                }
            }
            return "This sticker doesn't support NDEF";
        } catch (IOException e) {
            return "Lost contact with the sticker — hold it still and try again";
        } catch (FormatException e) {
            return "Couldn't format the sticker";
        } catch (Exception e) {
            return "Write failed: " + e.getMessage();
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        boolean writing;
        synchronized (this) {
            writing = writeCall != null;
        }
        if (writing) enableReader(); // the system drops reader mode when the activity pauses
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        fail("cancelled");
        if (instance.get() == this) instance = new WeakReference<>(null);
    }
}
