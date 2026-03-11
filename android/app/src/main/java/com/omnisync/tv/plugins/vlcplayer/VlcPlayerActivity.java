package com.omnisync.tv.plugins.vlcplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

import java.util.ArrayList;

public class VlcPlayerActivity extends AppCompatActivity {

    private LibVLC libVLC;
    private MediaPlayer mediaPlayer;
    private VLCVideoLayout videoLayout;
    
    // Controls
    private View controlsOverlay;
    private ImageButton btnPlayPause;
    private ImageButton btnBack;
    private TextView txtTitle;
    private TextView txtTime;
    private ProgressBar loadingSpinner;
    private SeekBar seekBar;
    
    private Handler handler = new Handler(Looper.getMainLooper());
    private boolean controlsVisible = true;
    private static final int CONTROLS_HIDE_DELAY = 5000;
    
    private final Runnable hideControlsRunnable = () -> hideControls();
    private final Runnable updateProgressRunnable = new Runnable() {
        @Override
        public void run() {
            updateProgress();
            handler.postDelayed(this, 1000);
        }
    };

    private BroadcastReceiver commandReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent.getAction() == null) return;
            switch (intent.getAction()) {
                case "com.omnisync.tv.VLC_STOP":
                    finish();
                    break;
                case "com.omnisync.tv.VLC_PAUSE":
                    if (mediaPlayer != null && mediaPlayer.isPlaying()) mediaPlayer.pause();
                    break;
                case "com.omnisync.tv.VLC_RESUME":
                    if (mediaPlayer != null && !mediaPlayer.isPlaying()) mediaPlayer.play();
                    break;
                case "com.omnisync.tv.VLC_VOLUME":
                    int vol = intent.getIntExtra("volume", 100);
                    if (mediaPlayer != null) mediaPlayer.setVolume(vol);
                    break;
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Fullscreen immersive
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = 
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        
        setContentView(createLayout());
        
        // Register broadcast receiver
        IntentFilter filter = new IntentFilter();
        filter.addAction("com.omnisync.tv.VLC_STOP");
        filter.addAction("com.omnisync.tv.VLC_PAUSE");
        filter.addAction("com.omnisync.tv.VLC_RESUME");
        filter.addAction("com.omnisync.tv.VLC_VOLUME");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(commandReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(commandReceiver, filter);
        }

        String url = getIntent().getStringExtra("url");
        String title = getIntent().getStringExtra("title");
        
        if (title != null && txtTitle != null) {
            txtTitle.setText(title);
        }

        initVLC(url);
        scheduleHideControls();
    }

    private View createLayout() {
        // Main container
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF000000);
        root.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // VLC Video Layout
        videoLayout = new VLCVideoLayout(this);
        videoLayout.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(videoLayout);

        // Loading spinner
        loadingSpinner = new ProgressBar(this);
        FrameLayout.LayoutParams spinnerParams = new FrameLayout.LayoutParams(
            dpToPx(48), dpToPx(48));
        spinnerParams.gravity = android.view.Gravity.CENTER;
        loadingSpinner.setLayoutParams(spinnerParams);
        root.addView(loadingSpinner);

        // Controls overlay
        controlsOverlay = createControlsOverlay();
        root.addView(controlsOverlay);

        // Touch/click listener to toggle controls
        root.setOnClickListener(v -> toggleControls());
        root.setFocusable(true);
        root.setFocusableInTouchMode(true);

        return root;
    }

    private View createControlsOverlay() {
        FrameLayout overlay = new FrameLayout(this);
        overlay.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        // Top bar (title + back)
        FrameLayout topBar = new FrameLayout(this);
        FrameLayout.LayoutParams topParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, dpToPx(56));
        topParams.gravity = android.view.Gravity.TOP;
        topBar.setLayoutParams(topParams);
        topBar.setBackgroundColor(0x80000000);
        topBar.setPadding(dpToPx(8), dpToPx(8), dpToPx(16), dpToPx(8));

        btnBack = new ImageButton(this);
        btnBack.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        btnBack.setBackgroundColor(0x00000000);
        btnBack.setColorFilter(0xFFFFFFFF);
        FrameLayout.LayoutParams backParams = new FrameLayout.LayoutParams(dpToPx(40), dpToPx(40));
        backParams.gravity = android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL;
        btnBack.setLayoutParams(backParams);
        btnBack.setOnClickListener(v -> finish());
        btnBack.setFocusable(true);
        topBar.addView(btnBack);

        txtTitle = new TextView(this);
        txtTitle.setTextColor(0xFFFFFFFF);
        txtTitle.setTextSize(16);
        FrameLayout.LayoutParams titleParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        titleParams.gravity = android.view.Gravity.CENTER_VERTICAL;
        titleParams.leftMargin = dpToPx(52);
        txtTitle.setLayoutParams(titleParams);
        topBar.addView(txtTitle);

        overlay.addView(topBar);

        // Bottom bar (play/pause + seek + time)
        FrameLayout bottomBar = new FrameLayout(this);
        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, dpToPx(56));
        bottomParams.gravity = android.view.Gravity.BOTTOM;
        bottomBar.setLayoutParams(bottomParams);
        bottomBar.setBackgroundColor(0x80000000);
        bottomBar.setPadding(dpToPx(8), dpToPx(8), dpToPx(16), dpToPx(8));

        btnPlayPause = new ImageButton(this);
        btnPlayPause.setImageResource(android.R.drawable.ic_media_pause);
        btnPlayPause.setBackgroundColor(0x00000000);
        btnPlayPause.setColorFilter(0xFFFFFFFF);
        FrameLayout.LayoutParams ppParams = new FrameLayout.LayoutParams(dpToPx(40), dpToPx(40));
        ppParams.gravity = android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL;
        btnPlayPause.setLayoutParams(ppParams);
        btnPlayPause.setFocusable(true);
        btnPlayPause.setOnClickListener(v -> {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.pause();
                    btnPlayPause.setImageResource(android.R.drawable.ic_media_play);
                } else {
                    mediaPlayer.play();
                    btnPlayPause.setImageResource(android.R.drawable.ic_media_pause);
                }
            }
        });
        bottomBar.addView(btnPlayPause);

        txtTime = new TextView(this);
        txtTime.setTextColor(0xCCFFFFFF);
        txtTime.setTextSize(12);
        FrameLayout.LayoutParams timeParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT);
        timeParams.gravity = android.view.Gravity.END | android.view.Gravity.CENTER_VERTICAL;
        txtTime.setLayoutParams(timeParams);
        bottomBar.addView(txtTime);

        overlay.addView(bottomBar);

        return overlay;
    }

    private void initVLC(String url) {
        if (url == null || url.isEmpty()) {
            finish();
            return;
        }

        ArrayList<String> options = new ArrayList<>();
        options.add("--no-drop-late-frames");
        options.add("--no-skip-frames");
        options.add("--rtsp-tcp");
        options.add("-vvv"); // Verbose for debugging, remove in production
        options.add("--network-caching=3000");
        options.add("--live-caching=3000");
        options.add("--file-caching=3000");
        options.add("--clock-jitter=0");
        options.add("--clock-synchro=0");
        // Android TV optimization
        options.add("--android-display-chroma=RV32");
        options.add("--audio-time-stretch");
        
        libVLC = new LibVLC(this, options);
        mediaPlayer = new MediaPlayer(libVLC);

        mediaPlayer.attachViews(videoLayout, null, false, false);

        mediaPlayer.setEventListener(event -> {
            switch (event.type) {
                case MediaPlayer.Event.Playing:
                    runOnUiThread(() -> {
                        loadingSpinner.setVisibility(View.GONE);
                        btnPlayPause.setImageResource(android.R.drawable.ic_media_pause);
                    });
                    break;
                case MediaPlayer.Event.Paused:
                    runOnUiThread(() -> 
                        btnPlayPause.setImageResource(android.R.drawable.ic_media_play));
                    break;
                case MediaPlayer.Event.Buffering:
                    float pct = event.getBuffering();
                    runOnUiThread(() -> {
                        if (pct < 100f) {
                            loadingSpinner.setVisibility(View.VISIBLE);
                        } else {
                            loadingSpinner.setVisibility(View.GONE);
                        }
                    });
                    break;
                case MediaPlayer.Event.EncounteredError:
                    runOnUiThread(() -> {
                        loadingSpinner.setVisibility(View.GONE);
                        // Could show error UI here
                    });
                    break;
                case MediaPlayer.Event.EndReached:
                    runOnUiThread(this::finish);
                    break;
            }
        });

        Media media = new Media(libVLC, Uri.parse(url));
        media.setHWDecoderEnabled(true, false);
        media.addOption(":network-caching=3000");
        media.addOption(":live-caching=3000");
        
        mediaPlayer.setMedia(media);
        media.release();
        mediaPlayer.play();
        
        handler.post(updateProgressRunnable);
    }

    private void updateProgress() {
        if (mediaPlayer == null) return;
        long time = mediaPlayer.getTime();
        long length = mediaPlayer.getLength();
        if (txtTime != null && time > 0) {
            if (length > 0) {
                txtTime.setText(formatTime(time) + " / " + formatTime(length));
            } else {
                // Live stream
                txtTime.setText("EN VIVO");
            }
        }
    }

    private String formatTime(long ms) {
        long s = ms / 1000;
        long h = s / 3600;
        long m = (s % 3600) / 60;
        s = s % 60;
        if (h > 0) return String.format("%d:%02d:%02d", h, m, s);
        return String.format("%02d:%02d", m, s);
    }

    // ── D-pad / Remote control support (Android TV) ──
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                if (mediaPlayer != null) {
                    if (mediaPlayer.isPlaying()) mediaPlayer.pause();
                    else mediaPlayer.play();
                }
                showControls();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                if (mediaPlayer != null) mediaPlayer.play();
                return true;
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_STOP:
                if (mediaPlayer != null) mediaPlayer.pause();
                return true;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
                finish();
                return true;
            case KeyEvent.KEYCODE_DPAD_LEFT:
                // Seek back 10s for VOD
                if (mediaPlayer != null && mediaPlayer.getLength() > 0) {
                    mediaPlayer.setTime(Math.max(0, mediaPlayer.getTime() - 10000));
                }
                showControls();
                return true;
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                // Seek forward 10s for VOD
                if (mediaPlayer != null && mediaPlayer.getLength() > 0) {
                    mediaPlayer.setTime(Math.min(mediaPlayer.getLength(), mediaPlayer.getTime() + 10000));
                }
                showControls();
                return true;
            case KeyEvent.KEYCODE_DPAD_UP:
            case KeyEvent.KEYCODE_VOLUME_UP:
                if (mediaPlayer != null) {
                    mediaPlayer.setVolume(Math.min(200, mediaPlayer.getVolume() + 10));
                }
                return true;
            case KeyEvent.KEYCODE_DPAD_DOWN:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
                if (mediaPlayer != null) {
                    mediaPlayer.setVolume(Math.max(0, mediaPlayer.getVolume() - 10));
                }
                return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void toggleControls() {
        if (controlsVisible) hideControls();
        else showControls();
    }

    private void showControls() {
        controlsOverlay.setVisibility(View.VISIBLE);
        controlsOverlay.animate().alpha(1f).setDuration(200);
        controlsVisible = true;
        scheduleHideControls();
    }

    private void hideControls() {
        controlsOverlay.animate().alpha(0f).setDuration(300)
            .withEndAction(() -> controlsOverlay.setVisibility(View.GONE));
        controlsVisible = false;
    }

    private void scheduleHideControls() {
        handler.removeCallbacks(hideControlsRunnable);
        handler.postDelayed(hideControlsRunnable, CONTROLS_HIDE_DELAY);
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
        }
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(hideControlsRunnable);
        handler.removeCallbacks(updateProgressRunnable);
        try { unregisterReceiver(commandReceiver); } catch (Exception ignored) {}
        if (mediaPlayer != null) {
            mediaPlayer.stop();
            mediaPlayer.detachViews();
            mediaPlayer.release();
        }
        if (libVLC != null) libVLC.release();
        super.onDestroy();
    }

    private int dpToPx(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density);
    }
}
