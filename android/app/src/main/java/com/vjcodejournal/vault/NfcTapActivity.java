package com.vjcodejournal.vault;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.widget.Toast;
import org.json.JSONObject;

/**
 * Invisible activity launched by a "watertap://add?ml=N" NFC sticker.
 * Queues the tap for the web app, shows a toast with today's total, vibrates and closes.
 */
public class NfcTapActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        handle(getIntent());
        finish();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
        finish();
    }

    private void handle(Intent intent) {
        if (intent == null) return;
        Uri uri = intent.getData();
        if (uri == null) uri = uriFromNdef(intent);
        if (uri == null || !"watertap".equals(uri.getScheme())) return;
        int ml = -1;
        try {
            String q = uri.getQueryParameter("ml");
            if (q != null) ml = Integer.parseInt(q.trim());
        } catch (Exception ignored) {}
        if (ml < 1 || ml > 10000) ml = WaterStore.tapMl(this);

        JSONObject tap = WaterStore.addTap(this, ml);
        if (tap == null) return; // debounced (sticker held against the phone)
        int total = WaterStore.todayTotal(this), goal = WaterStore.goalMl(this);
        String msg = "+" + WaterStore.fmt(ml) + " ml · Today " + WaterStore.fmt(total) + (goal > 0 ? " / " + WaterStore.fmt(goal) : "") + " ml";
        Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_SHORT).show();
        WaterStore.vibrate(this, 60);
        WaterTapPlugin.notifyPending(tap);
    }

    @SuppressWarnings("deprecation")
    private static Uri uriFromNdef(Intent intent) {
        try {
            Parcelable[] raw = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES, NdefMessage.class)
                : intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
            if (raw == null) return null;
            for (Parcelable p : raw) for (NdefRecord r : ((NdefMessage) p).getRecords()) {
                Uri u = r.toUri();
                if (u != null && "watertap".equals(u.getScheme())) return u;
            }
        } catch (Exception ignored) {}
        return null;
    }
}
