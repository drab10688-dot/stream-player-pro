package com.omnisync.tv.plugins.vlcplayer;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "VlcPlayer")
public class VlcPlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "");
        
        if (url == null || url.isEmpty()) {
            call.reject("URL is required");
            return;
        }

        Intent intent = new Intent(getContext(), VlcPlayerActivity.class);
        intent.putExtra("url", url);
        intent.putExtra("title", title);
        getActivity().startActivity(intent);
        
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent("com.omnisync.tv.VLC_STOP");
        getContext().sendBroadcast(intent);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        Intent intent = new Intent("com.omnisync.tv.VLC_PAUSE");
        getContext().sendBroadcast(intent);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        Intent intent = new Intent("com.omnisync.tv.VLC_RESUME");
        getContext().sendBroadcast(intent);
        call.resolve();
    }

    @PluginMethod
    public void isPlaying(PluginCall call) {
        // State is managed by the activity
        call.resolve(new com.getcapacitor.JSObject().put("playing", false));
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        int volume = call.getInt("volume", 100);
        Intent intent = new Intent("com.omnisync.tv.VLC_VOLUME");
        intent.putExtra("volume", volume);
        getContext().sendBroadcast(intent);
        call.resolve();
    }
}
