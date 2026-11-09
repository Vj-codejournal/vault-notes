package com.vjcodejournal.vault;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Shared state between NfcTapActivity (writes taps) and WaterTapPlugin (drains them into the web app). */
final class WaterStore {

    static final String PREFS = "watertap";
    private static final String K_PENDING = "pending", K_MIRROR = "mirror", K_LAST = "lastTap";
    static final long DEBOUNCE_MS = 3000;

    private WaterStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static JSONObject mirror(Context c) {
        try {
            return new JSONObject(prefs(c).getString(K_MIRROR, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static void setMirror(Context c, JSONObject m) {
        prefs(c).edit().putString(K_MIRROR, m.toString()).apply();
    }

    static synchronized JSONArray pending(Context c) {
        try {
            return new JSONArray(prefs(c).getString(K_PENDING, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Returns the queued taps and clears the queue. */
    static synchronized JSONArray drain(Context c) {
        JSONArray a = pending(c);
        prefs(c).edit().putString(K_PENDING, "[]").commit();
        return a;
    }

    static int tapMl(Context c) {
        int ml = mirror(c).optInt("tapMl", 100);
        return ml >= 1 && ml <= 10000 ? ml : 100;
    }

    /** Queues a tap. Returns the queued entry, or null if debounced. */
    static synchronized JSONObject addTap(Context c, int ml) {
        long now = System.currentTimeMillis();
        SharedPreferences p = prefs(c);
        if (now - p.getLong(K_LAST, 0) < DEBOUNCE_MS) return null;
        JSONArray a = pending(c);
        JSONObject e = new JSONObject();
        try {
            e.put("ts", now).put("ml", ml).put("day", today());
        } catch (JSONException ignored) {}
        a.put(e);
        p.edit().putString(K_PENDING, a.toString()).putLong(K_LAST, now).commit();
        return e;
    }

    /** Today's total as the app last reported it, plus taps not yet drained into the app. */
    static int todayTotal(Context c) {
        String t = today();
        JSONObject m = mirror(c);
        int total = t.equals(m.optString("date")) ? m.optInt("totalMl", 0) : 0;
        JSONArray a = pending(c);
        for (int i = 0; i < a.length(); i++) {
            JSONObject e = a.optJSONObject(i);
            if (e != null && t.equals(e.optString("day"))) total += e.optInt("ml", 0);
        }
        return total;
    }

    static int goalMl(Context c) {
        return mirror(c).optInt("goalMl", 0);
    }

    static String fmt(int n) {
        return String.format(Locale.US, "%,d", n);
    }

    @SuppressWarnings("deprecation")
    static void vibrate(Context c, long ms) {
        try {
            Vibrator v = (Vibrator) c.getSystemService(Context.VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(ms);
        } catch (Exception ignored) {}
    }
}
