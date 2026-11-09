package com.vjcodejournal.vault;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // app-local plugins must be registered before super.onCreate() builds the bridge
        registerPlugin(WaterTapPlugin.class);
        registerPlugin(DriveAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
