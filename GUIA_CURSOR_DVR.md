# 🎬 GUIA CURSOR: Sistema DVR Timeshift con fMP4

## RESUMEN
El servidor graba canales con DVR habilitado en segmentos **fMP4 (.m4s)** via HLS nativo de FFmpeg.
Buffer rotativo de 5 minutos (30 segmentos de 10s). Grabación **bajo demanda**: solo graba cuando un cliente está viendo el canal.
La APK usa el endpoint `/api/dvr/playlist/{channelId}` que devuelve un `.m3u8` estándar con segmentos fMP4.

---

## ENDPOINTS DVR (requieren `Authorization: Bearer <token>`)

### 1. Iniciar DVR al abrir un canal
```
POST /api/dvr/start/{channelId}
Authorization: Bearer <token>
```
**Respuesta:**
```json
{
  "ok": true,
  "recording": true,
  "segmentDuration": 10,
  "bufferSeconds": 300,
  "format": "fmp4"
}
```

### 2. Detener DVR al cerrar/cambiar canal
```
POST /api/dvr/stop/{channelId}
Authorization: Bearer <token>
```

### 3. Obtener playlist HLS (fMP4) — URL principal para LibVLC
```
GET /api/dvr/playlist/{channelId}
Authorization: Bearer <token>
```
**Respuesta:** `Content-Type: application/vnd.apple.mpegurl`
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:11
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="http://SERVER/api/dvr/file/{channelId}/init.mp4?token=JWT"
#EXTINF:10.000,
http://SERVER/api/dvr/file/{channelId}/seg_000.m4s?token=JWT
#EXTINF:10.000,
http://SERVER/api/dvr/file/{channelId}/seg_001.m4s?token=JWT
```
**USO:** Esta URL se pasa a LibVLC. Es HLS estándar con fMP4, máxima compatibilidad.

### 4. Servir archivos DVR (init.mp4, seg_XXX.m4s)
```
GET /api/dvr/file/{channelId}/{filename}?token=JWT
```
Soporta: `init.mp4` (cabecera fMP4) y `seg_XXX.m4s` (segmentos).

### 5. Obtener lista de segmentos (alternativa)
```
GET /api/dvr/segments/{channelId}
Authorization: Bearer <token>
```

---

## CAMPO dvr_enabled EN CANALES

El endpoint `/api/channels` incluye `dvr_enabled: boolean` en cada canal.

---

## FLUJO COMPLETO EN LA APK

### Al abrir un canal:
```kotlin
val channel = selectedChannel

if (channel.dvrEnabled) {
    // 1. Iniciar grabación DVR
    val startResponse = apiService.startDvr(channel.id)
    
    if (startResponse.isSuccessful && startResponse.body()?.recording == true) {
        // 2. Esperar 4-5 segundos para que FFmpeg genere segmentos fMP4
        delay(4500)
        
        // 3. Reproducir desde playlist HLS fMP4
        val dvrUrl = "${BuildConfig.API_BASE_URL}/api/dvr/playlist/${channel.id}"
        playWithVlc(dvrUrl, token)
    } else {
        // Fallback a stream directo
        playDirectStream(channel)
    }
} else {
    // Sin DVR: stream directo
    playDirectStream(channel)
}
```

### Al cambiar de canal:
```kotlin
fun changeChannel(oldChannel: Channel, newChannel: Channel) {
    if (oldChannel.dvrEnabled) {
        lifecycleScope.launch { apiService.stopDvr(oldChannel.id) }
    }
    openChannel(newChannel)
}
```

### Al cerrar la app:
```kotlin
if (currentChannel?.dvrEnabled == true) {
    apiService.stopDvr(currentChannel.id)
}
```

---

## CONFIGURACIÓN LibVLC PARA DVR fMP4

```kotlin
fun playDvrWithVlc(dvrPlaylistUrl: String, token: String) {
    val options = arrayListOf(
        "--http-reconnect",
        "--network-caching=4000",      // 4s buffer de red
        "--live-caching=4000",
        "--file-caching=2000",
        "--clock-jitter=0",
        "--sout-mux-caching=2000",
    )
    
    val libVLC = LibVLC(context, options)
    val mediaPlayer = MediaPlayer(libVLC)
    
    val uri = Uri.parse(dvrPlaylistUrl)
    val media = Media(libVLC, uri)
    media.addOption(":http-user-agent=OmnisyncTV/1.0")
    media.addOption(":http-header=Authorization: Bearer $token")
    
    mediaPlayer.media = media
    mediaPlayer.play()
}
```

---

## INTERFAZ ApiService (Retrofit)

```kotlin
@POST("api/dvr/start/{channelId}")
suspend fun startDvr(@Path("channelId") channelId: String): Response<DvrStartResponse>

@POST("api/dvr/stop/{channelId}")
suspend fun stopDvr(@Path("channelId") channelId: String): Response<GenericResponse>

@GET("api/dvr/segments/{channelId}")
suspend fun getDvrSegments(@Path("channelId") channelId: String): Response<DvrSegmentsResponse>
```

### Data classes:
```kotlin
data class DvrStartResponse(
    val ok: Boolean,
    val recording: Boolean,
    val segmentDuration: Int,
    val bufferSeconds: Int,
    val format: String  // "fmp4"
)

data class Channel(
    val id: String,
    val name: String,
    val url: String,
    val category: String,
    @SerializedName("is_active") val isActive: Boolean,
    @SerializedName("logo_url") val logoUrl: String?,
    @SerializedName("dvr_enabled") val dvrEnabled: Boolean = false
)
```

---

## MANEJO DE ERRORES DVR

```kotlin
suspend fun openChannelWithDvr(channel: Channel) {
    if (!channel.dvrEnabled) {
        playDirectStream(channel)
        return
    }
    
    try {
        val response = apiService.startDvr(channel.id)
        if (response.isSuccessful && response.body()?.recording == true) {
            delay(4500)
            val dvrUrl = "${BuildConfig.API_BASE_URL}/api/dvr/playlist/${channel.id}"
            playWithVlc(dvrUrl, token)
        } else {
            playDirectStream(channel)
        }
    } catch (e: Exception) {
        Log.w("DVR", "Error iniciando DVR, usando stream directo", e)
        playDirectStream(channel)
    }
}
```

---

## REGLAS IMPORTANTES

1. **NO cambiar el flujo de canales sin DVR** - Solo afectar canales con `dvr_enabled: true`
2. **Siempre llamar stop** al salir de un canal DVR
3. **Esperar 4-5 segundos** después de `start` antes de reproducir (FFmpeg genera init.mp4 + primeros segmentos)
4. **Fallback obligatorio** - Si DVR falla, reproducir stream directo
5. **El token JWT** se pasa via header `Authorization: Bearer <token>` O como query param `?token=JWT`
6. **La playlist se refresca sola** - LibVLC recarga la playlist HLS automáticamente
7. **Formato fMP4** - Los segmentos son `.m4s` con cabecera `init.mp4`, no `.mp4` sueltos
8. **No llamar stop al cambiar canal** si el nuevo canal es el mismo
