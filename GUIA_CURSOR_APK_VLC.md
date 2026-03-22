# 📱 Guía Completa: APK Omnisync TV con LibVLC

## Resumen
Crear una APK nativa Android (Kotlin) para IPTV que use **LibVLC** como reproductor.
Funciones: TV en vivo (HLS), VOD películas (MP4), Series (temporadas/episodios).

---

## 🔧 Dependencias Gradle

```kotlin
// build.gradle.kts (app)
dependencies {
    // LibVLC
    implementation("org.videolan.android:libvlc-all:3.6.0")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // UI
    implementation("com.google.android.material:material:1.12.0")
    implementation("io.coil-kt:coil:2.6.0") // Imágenes/posters

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}
```

**applicationId**: `com.omnisync.tv`
**minSdk**: 21, **targetSdk**: 34

---

## 🏗️ Arquitectura de la App

```
com.omnisync.tv/
├── api/
│   ├── ApiService.kt         // Retrofit interface
│   ├── AuthInterceptor.kt    // Inyecta Bearer token
│   └── Models.kt             // Data classes
├── ui/
│   ├── login/
│   │   └── LoginActivity.kt
│   ├── dashboard/
│   │   └── DashboardActivity.kt  // Tabs: TV, Películas, Series
│   ├── player/
│   │   └── VlcPlayerActivity.kt  // LibVLC reproductor
│   └── series/
│       ├── SeasonsActivity.kt
│       └── EpisodesActivity.kt
├── service/
│   └── HeartbeatService.kt   // Foreground service cada 2 min
└── util/
    ├── DeviceId.kt           // UUID persistente
    └── TokenManager.kt       // SharedPreferences para JWT
```

---

## 🔌 API Endpoints

**Base URL**: `http://TU_IP:3001`

### 1. Login
```
POST /api/auth/login
Content-Type: application/json

Body:
{
  "username": "usuario",
  "password": "clave",
  "device_id": "uuid-del-dispositivo"
}

Response 200:
{
  "token": "eyJhbG...",
  "user": {
    "id": "usuario",
    "username": "usuario",
    "status": "Active",
    "maxConnections": 1,
    "expiryDate": "1735689600",
    "isTrial": false,
    "activeCons": 0
  },
  "ads": [
    { "id": "uuid", "title": "Promo", "message": "Texto", "image_url": "http://..." }
  ],
  "vod": [
    { "id": "uuid", "title": "Película", "description": "...", "category": "Acción", "poster_url": "http://...", "duration_minutes": 120 }
  ],
  "series": [
    { "id": "uuid", "title": "Serie", "description": "...", "category": "Drama", "poster_url": "http://..." }
  ]
}

Response 401: { "error": "Credenciales inválidas en Xtream" }
```

### 2. Canales en vivo
```
GET /api/channels
Authorization: Bearer <token>

Response 200: [
  {
    "id": "12345",
    "name": "ESPN",
    "logo": "http://...",
    "group": "Deportes",
    "tvgId": "espn.us",
    "num": 1
  }
]
```

### 3. Obtener stream de un canal (TV en vivo)
```
GET /api/channels/:id/stream?quality=auto
Authorization: Bearer <token>

quality: "auto" | "high" | "medium" | "low"

Response 200:
{
  "streamUrl": "http://xtream-server/live/user/pass/12345.m3u8",
  "quality": "auto",
  "availableQualities": ["auto", "high", "medium", "low"],
  "ads": [
    {
      "id": "uuid",
      "title": "Promo",
      "message": "Texto del anuncio",
      "imageUrl": "http://...",
      "durationSeconds": 10,
      "type": "image"
    }
  ],
  "ad": { ... }  // Primer anuncio (compatibilidad)
}
```

### 4. Heartbeat (cada 2 minutos)
```
POST /api/heartbeat
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "channelId": "12345",
  "channelName": "ESPN",
  "channelCategory": "Deportes",
  "channelLogo": "http://..."
}

Response 200: { "ok": true }
```

### 5. Cerrar sesión
```
POST /api/sessions/close
Authorization: Bearer <token>
Content-Type: application/json

Body (cerrar canal específico):
{ "channelId": "12345", "device_id": "uuid" }

Body (cerrar sesión completa):
{ "device_id": "uuid" }

Response 200: { "message": "Sesión cerrada", "device_id": "...", "activeSessions": 0 }
```

### 6. VOD - Películas
```
GET /api/vod
Authorization: Bearer <token>

Response 200: [
  { "id": "uuid", "title": "Película", "description": "...", "category": "Acción", "poster_url": "...", "duration_minutes": 120 }
]
```

### 7. VOD - Stream película (MP4 con Range)
```
GET /api/vod/stream/:id
Authorization: Bearer <token>

  ó

GET /api/vod/stream/:id?token=<jwt>

Responde con video/mp4 y soporta Range headers para seeking.
```

### 8. Series
```
GET /api/series
Authorization: Bearer <token>

Response 200: [
  { "id": "uuid", "title": "Serie", "description": "...", "category": "Drama", "poster_url": "..." }
]
```

### 9. Temporadas
```
GET /api/series/:id/seasons
Authorization: Bearer <token>

Response 200: [
  { "id": "uuid", "season_number": 1, "title": "Temporada 1", "poster_url": "..." }
]
```

### 10. Episodios
```
GET /api/seasons/:id/episodes
Authorization: Bearer <token>

Response 200: [
  { "id": "uuid", "episode_number": 1, "title": "Piloto", "description": "...", "video_filename": "ep1.mp4", "poster_url": "...", "duration_minutes": 45 }
]
```

### 11. Stream episodio (MP4 con Range)
```
GET /api/vod/stream/:episodeId
Authorization: Bearer <token>

  ó

GET /api/vod/stream/:episodeId?token=<jwt>

Mismo endpoint que películas - busca en ambas tablas automáticamente.
```

### 12. Anuncios
```
GET /api/ads
Authorization: Bearer <token>

Response 200: [
  { "id": "uuid", "title": "Promo", "message": "Texto", "image_url": "http://..." }
]
```

---

## 📺 Implementación LibVLC

### VlcPlayerActivity.kt

```kotlin
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import android.net.Uri
import android.view.SurfaceView

class VlcPlayerActivity : AppCompatActivity() {
    private lateinit var libVLC: LibVLC
    private lateinit var mediaPlayer: MediaPlayer
    private lateinit var surfaceView: SurfaceView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_vlc_player)
        surfaceView = findViewById(R.id.vlc_surface)

        val streamUrl = intent.getStringExtra("STREAM_URL") ?: return finish()
        val isVod = intent.getBooleanExtra("IS_VOD", false)

        // Opciones VLC
        val options = arrayListOf(
            "--no-drop-late-frames",
            "--no-skip-frames",
            "--rtsp-tcp",
            "-vvv"  // verbose para debug, quitar en producción
        )

        // Para VOD con token en URL, agregar header
        if (isVod) {
            options.add("--http-reconnect")
        }

        libVLC = LibVLC(this, options)
        mediaPlayer = MediaPlayer(libVLC)
        mediaPlayer.attachViews(surfaceView, null, false, false)

        val media = Media(libVLC, Uri.parse(streamUrl))

        // Para HLS (TV en vivo)
        if (streamUrl.contains(".m3u8")) {
            media.addOption(":network-caching=3000")
            media.addOption(":live-caching=3000")
        }

        // Para MP4/VOD - permitir seeking
        if (isVod) {
            media.addOption(":network-caching=1500")
            media.addOption(":file-caching=3000")
        }

        mediaPlayer.media = media
        media.release()
        mediaPlayer.play()
    }

    override fun onStop() {
        super.onStop()
        mediaPlayer.stop()
        mediaPlayer.detachViews()
    }

    override fun onDestroy() {
        super.onDestroy()
        mediaPlayer.release()
        libVLC.release()
    }
}
```

### Layout: activity_vlc_player.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@android:color/black">

    <SurfaceView
        android:id="@+id/vlc_surface"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <!-- Controles overlay -->
    <LinearLayout
        android:id="@+id/controls_overlay"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom"
        android:orientation="vertical"
        android:padding="16dp"
        android:background="#80000000">

        <!-- SeekBar para VOD -->
        <SeekBar
            android:id="@+id/seek_bar"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:visibility="gone" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:gravity="center_vertical">

            <ImageButton
                android:id="@+id/btn_play_pause"
                android:layout_width="48dp"
                android:layout_height="48dp"
                android:src="@android:drawable/ic_media_pause" />

            <TextView
                android:id="@+id/tv_time"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:textColor="@android:color/white"
                android:layout_marginStart="16dp"
                android:text="00:00 / 00:00" />

            <!-- Selector calidad (solo TV en vivo) -->
            <Spinner
                android:id="@+id/quality_spinner"
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginStart="16dp"
                android:visibility="gone" />
        </LinearLayout>
    </LinearLayout>
</FrameLayout>
```

---

## 🔑 Flujo de Autenticación

### DeviceId.kt
```kotlin
object DeviceId {
    private const val PREF_KEY = "omnisync_device_id"

    fun get(context: Context): String {
        val prefs = context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
        var id = prefs.getString(PREF_KEY, null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(PREF_KEY, id).apply()
        }
        return id
    }
}
```

### TokenManager.kt
```kotlin
object TokenManager {
    private const val PREF_TOKEN = "jwt_token"
    private const val PREF_SERVER = "server_url"

    fun saveToken(context: Context, token: String) {
        context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
            .edit().putString(PREF_TOKEN, token).apply()
    }

    fun getToken(context: Context): String? {
        return context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
            .getString(PREF_TOKEN, null)
    }

    fun saveServer(context: Context, url: String) {
        context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
            .edit().putString(PREF_SERVER, url).apply()
    }

    fun getServer(context: Context): String? {
        return context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
            .getString(PREF_SERVER, null)
    }

    fun clear(context: Context) {
        context.getSharedPreferences("omnisync", Context.MODE_PRIVATE)
            .edit().remove(PREF_TOKEN).apply()
    }
}
```

### AuthInterceptor.kt
```kotlin
class AuthInterceptor(private val context: Context) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = TokenManager.getToken(context)
        val request = chain.request().newBuilder()
        if (token != null) {
            request.addHeader("Authorization", "Bearer $token")
        }
        return chain.proceed(request.build())
    }
}
```

---

## 🔄 HeartbeatService.kt

```kotlin
class HeartbeatService : Service() {
    private var timer: Timer? = null
    private var currentChannelId: String? = null
    private var currentChannelName: String? = null
    private var currentChannelCategory: String? = null
    private var currentChannelLogo: String? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        currentChannelId = intent?.getStringExtra("channelId")
        currentChannelName = intent?.getStringExtra("channelName")
        currentChannelCategory = intent?.getStringExtra("channelCategory")
        currentChannelLogo = intent?.getStringExtra("channelLogo")

        startForeground(1, createNotification())
        startHeartbeat()
        return START_STICKY
    }

    private fun startHeartbeat() {
        timer?.cancel()
        timer = Timer()
        timer?.scheduleAtFixedRate(object : TimerTask() {
            override fun run() {
                sendHeartbeat()
            }
        }, 0, 2 * 60 * 1000) // Cada 2 minutos
    }

    private fun sendHeartbeat() {
        val token = TokenManager.getToken(this) ?: return
        val serverUrl = TokenManager.getServer(this) ?: return

        try {
            val body = JSONObject().apply {
                currentChannelId?.let { put("channelId", it) }
                currentChannelName?.let { put("channelName", it) }
                currentChannelCategory?.let { put("channelCategory", it) }
                currentChannelLogo?.let { put("channelLogo", it) }
            }

            val request = Request.Builder()
                .url("$serverUrl/api/heartbeat")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .addHeader("Authorization", "Bearer $token")
                .build()

            OkHttpClient().newCall(request).execute()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun createNotification(): Notification {
        val channelId = "heartbeat_channel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Omnisync TV", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Omnisync TV")
            .setContentText("Conectado")
            .setSmallIcon(R.drawable.ic_notification)
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        timer?.cancel()
        super.onDestroy()
    }
}
```

---

## 📺 Cómo usar el reproductor

### TV en vivo (HLS via LibVLC)
```kotlin
// 1. Obtener stream URL del backend
val response = api.getChannelStream(channelId, "auto")  // GET /api/channels/:id/stream

// 2. Abrir VlcPlayerActivity
val intent = Intent(this, VlcPlayerActivity::class.java).apply {
    putExtra("STREAM_URL", response.streamUrl)  // URL HLS .m3u8
    putExtra("IS_VOD", false)
    putExtra("CHANNEL_NAME", channel.name)
}
startActivity(intent)

// 3. Actualizar heartbeat service con canal actual
Intent(this, HeartbeatService::class.java).apply {
    putExtra("channelId", channelId)
    putExtra("channelName", channel.name)
    putExtra("channelCategory", channel.group)
    putExtra("channelLogo", channel.logo)
}.also { startService(it) }
```

### VOD Película (MP4 con seeking)
```kotlin
// Usar token en query para que LibVLC pueda autenticar
val token = TokenManager.getToken(this)
val serverUrl = TokenManager.getServer(this)
val vodStreamUrl = "$serverUrl/api/vod/stream/${movie.id}?token=$token"

val intent = Intent(this, VlcPlayerActivity::class.java).apply {
    putExtra("STREAM_URL", vodStreamUrl)
    putExtra("IS_VOD", true)  // Habilita SeekBar + seeking
    putExtra("TITLE", movie.title)
}
startActivity(intent)
```

### Series - Episodio (MP4 con seeking)
```kotlin
// Mismo endpoint, el backend busca en películas y episodios
val token = TokenManager.getToken(this)
val serverUrl = TokenManager.getServer(this)
val episodeStreamUrl = "$serverUrl/api/vod/stream/${episode.id}?token=$token"

val intent = Intent(this, VlcPlayerActivity::class.java).apply {
    putExtra("STREAM_URL", episodeStreamUrl)
    putExtra("IS_VOD", true)
    putExtra("TITLE", "${series.title} - S${season.season_number}E${episode.episode_number}")
}
startActivity(intent)
```

---

## 🎨 Pantallas de la App

### 1. LoginActivity
- Campo: **URL del servidor** (ej: `http://192.168.1.100:3001`)
- Campo: **Usuario**
- Campo: **Contraseña**
- Checkbox: **Recordar credenciales**
- Guardar servidor URL, token y credenciales en SharedPreferences
- Al login exitoso → DashboardActivity

### 2. DashboardActivity (3 tabs)
- **Tab TV**: Lista de canales agrupados por `group`, con logo y nombre. Click → obtener stream → VlcPlayerActivity
- **Tab Películas**: Grid de posters VOD. Click → VlcPlayerActivity con VOD stream
- **Tab Series**: Grid de posters. Click → SeasonsActivity → EpisodesActivity → VlcPlayerActivity

### 3. VlcPlayerActivity
- Pantalla completa, landscape forzado
- LibVLC con SurfaceView
- Controles: play/pause, seekbar (solo VOD), nombre del canal/película
- Para TV: selector de calidad (auto/high/medium/low) → recargar stream con `?quality=X`
- Mostrar anuncios al iniciar canal (overlay de 10 seg con imagen o texto)

---

## 📋 Notas importantes

1. **Token en query**: Para VOD streaming usa `?token=jwt` porque LibVLC no puede inyectar headers HTTP personalizados fácilmente
2. **TV en vivo**: La URL HLS `.m3u8` ya viene autenticada con las credenciales Xtream embebidas, no necesita token adicional
3. **Heartbeat**: DEBE enviarse cada 2 minutos con `channelName` para que el panel admin muestre qué canal se está viendo
4. **device_id**: Generar un UUID y persistirlo. Es OBLIGATORIO en login y heartbeat
5. **Anuncios**: Se reciben en login y en `/api/channels/:id/stream`. Mostrar overlay de 10 segundos al cambiar de canal
6. **Cerrar sesión**: Llamar `POST /api/sessions/close` al salir de la app para liberar la pantalla
