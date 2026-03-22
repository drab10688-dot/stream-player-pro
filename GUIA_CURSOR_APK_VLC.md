# 📱 Guía Completa: APK Omnisync TV con LibVLC

## ⚠️ REGLAS CRÍTICAS - LEER ANTES DE EMPEZAR

1. **NO pedir URL del servidor al usuario**. La URL base está HARDCODEADA en la app.
2. **NO crear campo de "servidor" en el login**. Solo usuario y contraseña.
3. **TODA petición HTTP** (excepto login) DEBE llevar el header `Authorization: Bearer <token>`.
4. **Para streams VOD/Series** pasar el token como `?token=<jwt>` en la URL porque LibVLC no puede inyectar headers.
5. **El JWT expira en 24h**. Si recibes 401, redirigir al login.

---

## 🔧 Configuración del Proyecto

### build.gradle.kts (app)
```kotlin
android {
    namespace = "com.omnisync.tv"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.omnisync.tv"
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        // ⚠️ CAMBIAR ESTA URL antes de compilar la APK
        // Poner la IP o dominio del VPS del cliente
        buildConfigField("String", "API_BASE_URL", "\"http://TU_IP_O_DOMINIO:3001\"")
    }
    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // LibVLC
    implementation("org.videolan.android:libvlc-all:3.6.0")

    // Networking
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.squareup.retrofit2:converter-gson:2.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // UI
    implementation("com.google.android.material:material:1.12.0")
    implementation("io.coil-kt:coil:2.6.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}
```

### AndroidManifest.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- Permitir HTTP (no solo HTTPS) -->
    <application
        android:usesCleartextTraffic="true"
        android:networkSecurityConfig="@xml/network_security_config"
        ... >

        <activity android:name=".ui.login.LoginActivity"
            android:exported="true"
            android:screenOrientation="portrait">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity android:name=".ui.dashboard.DashboardActivity"
            android:screenOrientation="portrait" />

        <activity android:name=".ui.player.VlcPlayerActivity"
            android:screenOrientation="landscape"
            android:configChanges="orientation|screenSize"
            android:theme="@style/Theme.AppCompat.NoActionBar" />

        <activity android:name=".ui.series.SeasonsActivity"
            android:screenOrientation="portrait" />

        <activity android:name=".ui.series.EpisodesActivity"
            android:screenOrientation="portrait" />

        <service android:name=".service.HeartbeatService"
            android:foregroundServiceType="mediaPlayback" />

    </application>
</manifest>
```

### res/xml/network_security_config.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

---

## 🏗️ Arquitectura de la App

```
com.omnisync.tv/
├── api/
│   ├── ApiClient.kt          // Retrofit singleton con BASE_URL hardcodeada
│   ├── ApiService.kt         // Interface Retrofit con todos los endpoints
│   ├── AuthInterceptor.kt    // Inyecta Bearer token en TODAS las peticiones
│   └── Models.kt             // Data classes para request/response
├── ui/
│   ├── login/
│   │   └── LoginActivity.kt  // SOLO usuario + contraseña (NO pedir URL)
│   ├── dashboard/
│   │   └── DashboardActivity.kt  // Tabs: TV, Películas, Series
│   ├── player/
│   │   └── VlcPlayerActivity.kt  // LibVLC reproductor fullscreen
│   └── series/
│       ├── SeasonsActivity.kt
│       └── EpisodesActivity.kt
├── service/
│   └── HeartbeatService.kt   // Foreground service cada 2 min
└── util/
    ├── DeviceId.kt           // UUID persistente
    └── TokenManager.kt       // SharedPreferences SOLO para JWT
```

---

## 🔑 Código clave: API Client (SIN campo de URL)

### ApiClient.kt
```kotlin
package com.omnisync.tv.api

import android.content.Context
import com.omnisync.tv.BuildConfig
import com.omnisync.tv.util.TokenManager
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    // ⚠️ URL HARDCODEADA desde BuildConfig - NO se pide al usuario
    private val BASE_URL = BuildConfig.API_BASE_URL

    private var retrofit: Retrofit? = null

    fun getInstance(context: Context): ApiService {
        if (retrofit == null) {
            val logging = HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BODY
            }

            val client = OkHttpClient.Builder()
                .addInterceptor(AuthInterceptor(context))
                .addInterceptor(logging)
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()

            retrofit = Retrofit.Builder()
                .baseUrl(BASE_URL.trimEnd('/') + "/")
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
        }
        return retrofit!!.create(ApiService::class.java)
    }

    // Exponer BASE_URL para construir URLs de stream
    fun getBaseUrl(): String = BASE_URL.trimEnd('/')
}
```

### AuthInterceptor.kt
```kotlin
package com.omnisync.tv.api

import android.content.Context
import com.omnisync.tv.util.TokenManager
import okhttp3.Interceptor
import okhttp3.Response

class AuthInterceptor(private val context: Context) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val token = TokenManager.getToken(context)

        val request = if (token != null) {
            original.newBuilder()
                .addHeader("Authorization", "Bearer $token")
                .build()
        } else {
            original
        }

        val response = chain.proceed(request)

        // Si el servidor devuelve 401, el token expiró → limpiar y redirigir al login
        if (response.code == 401) {
            TokenManager.clear(context)
            // La Activity debe detectar esto y volver al LoginActivity
        }

        return response
    }
}
```

### TokenManager.kt (SIN campo de servidor)
```kotlin
package com.omnisync.tv.util

import android.content.Context

object TokenManager {
    private const val PREFS = "omnisync_prefs"
    private const val KEY_TOKEN = "jwt_token"
    private const val KEY_USERNAME = "saved_username"
    private const val KEY_PASSWORD = "saved_password"
    private const val KEY_REMEMBER = "remember_me"

    fun saveToken(context: Context, token: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString(KEY_TOKEN, token).apply()
    }

    fun getToken(context: Context): String? {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, null)
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(KEY_TOKEN).apply()
    }

    // Guardar credenciales para "Recordar"
    fun saveCredentials(context: Context, username: String, password: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_USERNAME, username)
            .putString(KEY_PASSWORD, password)
            .putBoolean(KEY_REMEMBER, true)
            .apply()
    }

    fun getSavedUsername(context: Context): String? {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_USERNAME, null)
    }

    fun getSavedPassword(context: Context): String? {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_PASSWORD, null)
    }

    fun isRememberMe(context: Context): Boolean {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_REMEMBER, false)
    }

    fun clearCredentials(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_USERNAME)
            .remove(KEY_PASSWORD)
            .putBoolean(KEY_REMEMBER, false)
            .apply()
    }
}
```

### DeviceId.kt
```kotlin
package com.omnisync.tv.util

import android.content.Context
import java.util.UUID

object DeviceId {
    private const val PREFS = "omnisync_prefs"
    private const val KEY = "device_id"

    fun get(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var id = prefs.getString(KEY, null)
        if (id == null) {
            id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY, id).apply()
        }
        return id
    }
}
```

---

## 🔌 API Service (Retrofit Interface)

### ApiService.kt
```kotlin
package com.omnisync.tv.api

import retrofit2.Response
import retrofit2.http.*

interface ApiService {

    // Login - NO necesita token (es el primer endpoint)
    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): Response<LoginResponse>

    // Canales - necesita token (AuthInterceptor lo agrega automáticamente)
    @GET("api/channels")
    suspend fun getChannels(): Response<List<Channel>>

    // Stream de canal - necesita token
    @GET("api/channels/{id}/stream")
    suspend fun getChannelStream(
        @Path("id") channelId: String,
        @Query("quality") quality: String = "auto"
    ): Response<ChannelStreamResponse>

    // VOD películas
    @GET("api/vod")
    suspend fun getVodItems(): Response<List<VodItem>>

    // Series
    @GET("api/series")
    suspend fun getSeries(): Response<List<SeriesItem>>

    // Temporadas de una serie
    @GET("api/series/{id}/seasons")
    suspend fun getSeasons(@Path("id") seriesId: String): Response<List<Season>>

    // Episodios de una temporada
    @GET("api/seasons/{id}/episodes")
    suspend fun getEpisodes(@Path("id") seasonId: String): Response<List<Episode>>

    // Anuncios
    @GET("api/ads")
    suspend fun getAds(): Response<List<Ad>>

    // Heartbeat (cada 2 min)
    @POST("api/heartbeat")
    suspend fun heartbeat(@Body body: HeartbeatRequest): Response<HeartbeatResponse>

    // Cerrar sesión
    @POST("api/sessions/close")
    suspend fun closeSession(@Body body: CloseSessionRequest): Response<CloseSessionResponse>
}
```

### Models.kt
```kotlin
package com.omnisync.tv.api

import com.google.gson.annotations.SerializedName

// === REQUEST ===

data class LoginRequest(
    val username: String,
    val password: String,
    val device_id: String
)

data class HeartbeatRequest(
    val channelId: String?,
    val channelName: String?,
    val channelCategory: String?,
    val channelLogo: String?
)

data class CloseSessionRequest(
    val device_id: String,
    val channelId: String? = null
)

// === RESPONSE ===

data class LoginResponse(
    val token: String?,
    val user: UserInfo?,
    val ads: List<Ad>?,
    val vod: List<VodItem>?,
    val series: List<SeriesItem>?,
    val error: String?
)

data class UserInfo(
    val id: String,
    val username: String,
    val status: String,
    val maxConnections: Int,
    val expiryDate: String?,
    val isTrial: Boolean,
    val activeCons: Int
)

data class Channel(
    val id: String,
    val name: String,
    val logo: String?,
    val group: String?,
    val tvgId: String?,
    val num: Int?
)

data class ChannelStreamResponse(
    val streamUrl: String,
    val quality: String,
    val availableQualities: List<String>?,
    val ads: List<Ad>?,
    val ad: Ad?
)

data class VodItem(
    val id: String,
    val title: String,
    val description: String?,
    val category: String?,
    @SerializedName("poster_url") val posterUrl: String?,
    @SerializedName("duration_minutes") val durationMinutes: Int?
)

data class SeriesItem(
    val id: String,
    val title: String,
    val description: String?,
    val category: String?,
    @SerializedName("poster_url") val posterUrl: String?
)

data class Season(
    val id: String,
    @SerializedName("season_number") val seasonNumber: Int,
    val title: String?,
    @SerializedName("poster_url") val posterUrl: String?
)

data class Episode(
    val id: String,
    @SerializedName("episode_number") val episodeNumber: Int,
    val title: String,
    val description: String?,
    @SerializedName("video_filename") val videoFilename: String,
    @SerializedName("poster_url") val posterUrl: String?,
    @SerializedName("duration_minutes") val durationMinutes: Int?
)

data class Ad(
    val id: String,
    val title: String?,
    val message: String?,
    @SerializedName("image_url") val imageUrl: String?
)

data class HeartbeatResponse(val ok: Boolean)

data class CloseSessionResponse(
    val message: String?,
    @SerializedName("device_id") val deviceId: String?,
    val activeSessions: Int?
)
```

---

## 📺 Pantalla de Login (SIN campo de URL)

### LoginActivity.kt
```kotlin
package com.omnisync.tv.ui.login

import android.content.Intent
import android.os.Bundle
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import com.omnisync.tv.R
import com.omnisync.tv.api.ApiClient
import com.omnisync.tv.api.LoginRequest
import com.omnisync.tv.ui.dashboard.DashboardActivity
import com.omnisync.tv.util.DeviceId
import com.omnisync.tv.util.TokenManager
import kotlinx.coroutines.*

class LoginActivity : AppCompatActivity() {
    private lateinit var etUsername: EditText
    private lateinit var etPassword: EditText
    private lateinit var cbRemember: CheckBox
    private lateinit var btnLogin: Button
    private lateinit var progressBar: ProgressBar
    private lateinit var tvError: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_login)

        etUsername = findViewById(R.id.et_username)
        etPassword = findViewById(R.id.et_password)
        cbRemember = findViewById(R.id.cb_remember)
        btnLogin = findViewById(R.id.btn_login)
        progressBar = findViewById(R.id.progress_bar)
        tvError = findViewById(R.id.tv_error)

        // Auto-login si hay token válido
        val existingToken = TokenManager.getToken(this)
        if (existingToken != null) {
            goToDashboard()
            return
        }

        // Cargar credenciales guardadas
        if (TokenManager.isRememberMe(this)) {
            etUsername.setText(TokenManager.getSavedUsername(this) ?: "")
            etPassword.setText(TokenManager.getSavedPassword(this) ?: "")
            cbRemember.isChecked = true

            // Auto-login con credenciales guardadas
            val u = TokenManager.getSavedUsername(this)
            val p = TokenManager.getSavedPassword(this)
            if (!u.isNullOrBlank() && !p.isNullOrBlank()) {
                doLogin(u, p)
            }
        }

        btnLogin.setOnClickListener {
            val username = etUsername.text.toString().trim()
            val password = etPassword.text.toString().trim()
            if (username.isEmpty() || password.isEmpty()) {
                tvError.text = "Ingresa usuario y contraseña"
                tvError.visibility = android.view.View.VISIBLE
                return@setOnClickListener
            }
            doLogin(username, password)
        }
    }

    private fun doLogin(username: String, password: String) {
        tvError.visibility = android.view.View.GONE
        progressBar.visibility = android.view.View.VISIBLE
        btnLogin.isEnabled = false

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val api = ApiClient.getInstance(this@LoginActivity)
                val deviceId = DeviceId.get(this@LoginActivity)
                val response = api.login(LoginRequest(username, password, deviceId))

                withContext(Dispatchers.Main) {
                    progressBar.visibility = android.view.View.GONE
                    btnLogin.isEnabled = true

                    if (response.isSuccessful && response.body()?.token != null) {
                        val body = response.body()!!
                        TokenManager.saveToken(this@LoginActivity, body.token!!)

                        if (cbRemember.isChecked) {
                            TokenManager.saveCredentials(this@LoginActivity, username, password)
                        } else {
                            TokenManager.clearCredentials(this@LoginActivity)
                        }

                        goToDashboard()
                    } else {
                        val errorMsg = response.body()?.error
                            ?: response.errorBody()?.string()
                            ?: "Error de conexión (${response.code()})"
                        tvError.text = errorMsg
                        tvError.visibility = android.view.View.VISIBLE
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    progressBar.visibility = android.view.View.GONE
                    btnLogin.isEnabled = true
                    tvError.text = "No se pudo conectar al servidor: ${e.message}"
                    tvError.visibility = android.view.View.VISIBLE
                }
            }
        }
    }

    private fun goToDashboard() {
        startActivity(Intent(this, DashboardActivity::class.java))
        finish()
    }
}
```

### Layout: activity_login.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:padding="32dp"
    android:background="@color/background_dark">

    <!-- Logo -->
    <ImageView
        android:layout_width="120dp"
        android:layout_height="120dp"
        android:src="@drawable/ic_logo"
        android:contentDescription="Omnisync TV"
        android:layout_marginBottom="8dp" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="Tu televisión, en todas partes"
        android:textColor="@color/text_secondary"
        android:textSize="14sp"
        android:layout_marginBottom="32dp" />

    <!-- ⚠️ NO hay campo de URL del servidor -->

    <EditText
        android:id="@+id/et_username"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:hint="Usuario"
        android:inputType="text"
        android:maxLines="1"
        android:textColor="@color/text_primary"
        android:textColorHint="@color/text_secondary"
        android:background="@drawable/input_background"
        android:paddingHorizontal="16dp"
        android:layout_marginBottom="12dp"
        android:drawableStart="@drawable/ic_user"
        android:drawablePadding="12dp" />

    <EditText
        android:id="@+id/et_password"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:hint="Contraseña"
        android:inputType="textPassword"
        android:maxLines="1"
        android:textColor="@color/text_primary"
        android:textColorHint="@color/text_secondary"
        android:background="@drawable/input_background"
        android:paddingHorizontal="16dp"
        android:layout_marginBottom="12dp"
        android:drawableStart="@drawable/ic_lock"
        android:drawablePadding="12dp" />

    <CheckBox
        android:id="@+id/cb_remember"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Recordar credenciales"
        android:textColor="@color/text_secondary"
        android:layout_marginBottom="24dp" />

    <Button
        android:id="@+id/btn_login"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:text="Conectar"
        android:textSize="16sp"
        android:textStyle="bold"
        android:backgroundTint="@color/primary" />

    <ProgressBar
        android:id="@+id/progress_bar"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:visibility="gone" />

    <TextView
        android:id="@+id/tv_error"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:textColor="@color/error_red"
        android:textAlignment="center"
        android:layout_marginTop="12dp"
        android:visibility="gone" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="TV en vivo · Series · Películas"
        android:textColor="@color/text_hint"
        android:textSize="11sp"
        android:layout_marginTop="32dp" />

</LinearLayout>
```

---

## 🔌 API Endpoints

**Base URL**: Hardcodeada en `BuildConfig.API_BASE_URL` (ej: `http://TU_IP:3001`)

### 1. Login (NO necesita token)
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
  "ads": [...],
  "vod": [...],
  "series": [...]
}

Response 401: { "error": "Credenciales inválidas en Xtream" }
```

### 2. Canales (necesita token en header)
```
GET /api/channels
Authorization: Bearer <token>

Response 200: [
  { "id": "12345", "name": "ESPN", "logo": "http://...", "group": "Deportes", "num": 1 }
]
```

### 3. Stream de canal (necesita token en header)
```
GET /api/channels/:id/stream?quality=auto
Authorization: Bearer <token>

Response 200:
{
  "streamUrl": "http://xtream-server/live/user/pass/12345.m3u8",
  "quality": "auto",
  "availableQualities": ["auto", "high", "medium", "low"],
  "ads": [...]
}
```

### 4. Heartbeat (cada 2 min, necesita token)
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
Body: { "device_id": "uuid" }
```

### 6-7. VOD
```
GET /api/vod                          → Lista películas (token en header)
GET /api/vod/stream/:id?token=<jwt>   → Stream MP4 (token en QUERY, NO en header)
```

### 8-10. Series
```
GET /api/series                       → Lista series (token en header)
GET /api/series/:id/seasons           → Temporadas (token en header)
GET /api/seasons/:id/episodes         → Episodios (token en header)
GET /api/vod/stream/:episodeId?token=<jwt>  → Stream episodio (token en QUERY)
```

### 11. Anuncios
```
GET /api/ads → (token en header)
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

        val options = arrayListOf(
            "--no-drop-late-frames",
            "--no-skip-frames",
            "--rtsp-tcp"
        )
        if (isVod) options.add("--http-reconnect")

        libVLC = LibVLC(this, options)
        mediaPlayer = MediaPlayer(libVLC)
        mediaPlayer.attachViews(surfaceView, null, false, false)

        val media = Media(libVLC, Uri.parse(streamUrl))

        if (streamUrl.contains(".m3u8")) {
            media.addOption(":network-caching=3000")
            media.addOption(":live-caching=3000")
        }
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

    <LinearLayout
        android:id="@+id/controls_overlay"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom"
        android:orientation="vertical"
        android:padding="16dp"
        android:background="#80000000">

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
            override fun run() { sendHeartbeat() }
        }, 0, 2 * 60 * 1000)
    }

    private fun sendHeartbeat() {
        val token = TokenManager.getToken(this) ?: return
        // Usa ApiClient.getBaseUrl() — NO pide URL al usuario
        val baseUrl = ApiClient.getBaseUrl()

        try {
            val body = JSONObject().apply {
                currentChannelId?.let { put("channelId", it) }
                currentChannelName?.let { put("channelName", it) }
                currentChannelCategory?.let { put("channelCategory", it) }
                currentChannelLogo?.let { put("channelLogo", it) }
            }

            val request = Request.Builder()
                .url("$baseUrl/api/heartbeat")
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
    override fun onDestroy() { timer?.cancel(); super.onDestroy() }
}
```

---

## 📺 Cómo usar el reproductor

### TV en vivo (HLS via LibVLC)
```kotlin
// 1. Obtener stream URL
val response = api.getChannelStream(channelId, "auto")

// 2. Abrir reproductor (la URL HLS ya viene con credenciales Xtream, NO necesita token extra)
val intent = Intent(this, VlcPlayerActivity::class.java).apply {
    putExtra("STREAM_URL", response.body()!!.streamUrl)
    putExtra("IS_VOD", false)
    putExtra("CHANNEL_NAME", channel.name)
}
startActivity(intent)

// 3. Actualizar heartbeat
Intent(this, HeartbeatService::class.java).apply {
    putExtra("channelId", channelId)
    putExtra("channelName", channel.name)
    putExtra("channelCategory", channel.group)
    putExtra("channelLogo", channel.logo)
}.also { startService(it) }
```

### VOD Película o Episodio (MP4 con seeking)
```kotlin
// ⚠️ Para VOD/episodios usar token en QUERY (no en header)
val token = TokenManager.getToken(this)
val baseUrl = ApiClient.getBaseUrl()
val vodStreamUrl = "$baseUrl/api/vod/stream/${movie.id}?token=$token"

val intent = Intent(this, VlcPlayerActivity::class.java).apply {
    putExtra("STREAM_URL", vodStreamUrl)
    putExtra("IS_VOD", true)
    putExtra("TITLE", movie.title)
}
startActivity(intent)
```

---

## 📋 Resumen de reglas

| Concepto | Regla |
|----------|-------|
| URL del servidor | **HARDCODEADA** en `BuildConfig.API_BASE_URL`, NO se pide al usuario |
| Login | Solo campos: usuario + contraseña + checkbox recordar |
| Token | Se guarda en SharedPreferences tras login exitoso |
| Header Authorization | Se inyecta automáticamente via `AuthInterceptor` en TODAS las peticiones |
| VOD/Series stream | Usar `?token=<jwt>` en la URL porque LibVLC no puede enviar headers |
| TV en vivo stream | La URL `.m3u8` ya tiene credenciales Xtream, no necesita token extra |
| Heartbeat | Cada 2 min via Foreground Service con channelName para monitoreo |
| device_id | UUID persistente, obligatorio en login |
| Error 401 | Token expirado → limpiar token → redirigir a login |
| Cerrar app | Llamar `POST /api/sessions/close` para liberar pantalla |

---

## 🚀 Prompt para Cursor

Copia y pega esto en Cursor:

> Lee el archivo `GUIA_CURSOR_APK_VLC.md` y crea la APK completa siguiendo esa guía al pie de la letra.
> IMPORTANTE: La URL del servidor NO se pide al usuario. Está hardcodeada en BuildConfig.API_BASE_URL.
> El login solo tiene campos usuario y contraseña.
> Usa LibVLC como reproductor, Kotlin, y Retrofit para la API.
> Para VOD/Series usa ?token=jwt en la URL del stream.
> Para TV en vivo la URL HLS ya viene autenticada.
