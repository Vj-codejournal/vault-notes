package com.vjcodejournal.vault;

import android.accounts.Account;
import android.app.Activity;
import android.app.PendingIntent;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * Google Drive access token via Google Identity Services' AuthorizationClient (window.Capacitor.Plugins.DriveAuth).
 * authorize({interactive, email}) -> {accessToken, email?}. With interactive=false it never shows UI and rejects
 * with code "consent_required" when the user has to sign in / grant access first.
 * Needs an "Android" OAuth client (package + signing SHA-1) in the same Google Cloud project as the Drive API.
 */
@CapacitorPlugin(name = "DriveAuth")
public class DriveAuthPlugin extends Plugin {

    static final String SCOPE = "https://www.googleapis.com/auth/drive.file";
    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;

    @Override
    public void load() {
        // registered during the activity's onCreate (Capacitor loads plugins there), as the Activity Result API requires
        launcher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onResult);
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        Activity act = getActivity();
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        String email = call.getString("email");
        AuthorizationRequest.Builder b = AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(SCOPE)));
        if (email != null && !email.isEmpty()) b.setAccount(new Account(email, "com.google"));
        Identity.getAuthorizationClient(act)
            .authorize(b.build())
            .addOnSuccessListener(r -> {
                if (!r.hasResolution()) {
                    resolve(call, r);
                    return;
                }
                PendingIntent pi = r.getPendingIntent();
                if (!interactive || pi == null) {
                    call.reject("Google sign-in needed", "consent_required");
                    return;
                }
                if (pending != null) pending.reject("cancelled", "cancelled");
                pending = call;
                try {
                    launcher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
                } catch (Exception e) {
                    pending = null;
                    call.reject("Couldn't open Google sign-in: " + e.getMessage(), "auth_failed");
                }
            })
            .addOnFailureListener(e -> call.reject(message(e), "auth_failed"));
    }

    private void onResult(ActivityResult res) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (res.getData() == null) {
            call.reject("cancelled", "cancelled");
            return;
        }
        try {
            AuthorizationResult r = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(res.getData());
            resolve(call, r);
        } catch (ApiException e) {
            if (res.getResultCode() != Activity.RESULT_OK) call.reject("cancelled", "cancelled");
            else call.reject(message(e), "auth_failed");
        }
    }

    private void resolve(PluginCall call, AuthorizationResult r) {
        String token = r.getAccessToken();
        if (token == null) {
            call.reject("Google didn't return an access token", "auth_failed");
            return;
        }
        JSObject o = new JSObject().put("accessToken", token);
        try {
            GoogleSignInAccount acc = r.toGoogleSignInAccount();
            if (acc != null && acc.getEmail() != null) o.put("email", acc.getEmail());
        } catch (Exception ignored) {}
        call.resolve(o);
    }

    /** Drops a cached (expired or revoked) token so the next authorize() fetches a fresh one. */
    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.resolve();
            return;
        }
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {}
            call.resolve();
        }).start();
    }

    private static String message(Exception e) {
        if (e instanceof ApiException) {
            int code = ((ApiException) e).getStatusCode();
            if (code == 10) return "Google sign-in isn't set up for this app (DEVELOPER_ERROR 10): check the Android OAuth client's package name and SHA-1";
            if (code == 7) return "No internet connection";
            return "Google sign-in failed (code " + code + ")";
        }
        return e.getMessage() != null ? e.getMessage() : "Google sign-in failed";
    }
}
