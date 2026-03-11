# Integración LibVLC para Android / Android TV

## Pasos en Android Studio

### 1. Sincronizar el proyecto
```bash
cd /root/stream-player-pro
git pull
npm run build
npx cap sync android
```

### 2. Agregar dependencia LibVLC en Gradle

Edita `android/app/build.gradle` y agrega en `dependencies`:

```gradle
dependencies {
    // ... dependencias existentes de Capacitor ...
    
    // LibVLC para Android
    implementation 'org.videolan.android:libvlc-all:3.6.0'
}
```

### 3. Registrar el plugin en MainActivity

Edita `android/app/src/main/java/com/omnisync/tv/MainActivity.java`:

```java
package com.omnisync.tv;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.omnisync.tv.plugins.vlcplayer.VlcPlayerPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VlcPlayerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
```

### 4. Registrar la Activity en AndroidManifest.xml

Agrega dentro del tag `<application>` en `android/app/src/main/AndroidManifest.xml`:

```xml
<activity
    android:name="com.omnisync.tv.plugins.vlcplayer.VlcPlayerActivity"
    android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|navigation"
    android:theme="@style/Theme.AppCompat.NoActionBar"
    android:screenOrientation="sensorLandscape"
    android:launchMode="singleTop"
    android:hardwareAccelerated="true">
    
    <!-- Android TV: Lean-back support -->
    <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
    </intent-filter>
</activity>
```

### 5. Para soporte Android TV

En el `AndroidManifest.xml` principal, agrega estos permisos/features:

```xml
<!-- Android TV support -->
<uses-feature android:name="android.software.leanback" android:required="false" />
<uses-feature android:name="android.hardware.touchscreen" android:required="false" />
```

### 6. Compilar

```bash
cd android
./gradlew assembleDebug
```

El APK estará en: `android/app/build/outputs/apk/debug/app-debug.apk`

## Funcionalidades incluidas

- ✅ Reproducción HLS, RTSP, RTMP, HTTP y más
- ✅ Decodificación por hardware (MediaCodec)
- ✅ Controles de control remoto D-pad (Android TV)
- ✅ Play/Pause con botón central
- ✅ Seek ±10s con flechas izquierda/derecha
- ✅ Volumen con flechas arriba/abajo
- ✅ Auto-hide de controles
- ✅ Pantalla completa inmersiva
- ✅ Indicador de buffering
- ✅ Soporte VOD con tiempo/duración
- ✅ Soporte live con indicador "EN VIVO"
