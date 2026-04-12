# 🎬 GUIA CURSOR: Sistema DVR Bajo Demanda

## RESUMEN
El servidor graba canales con DVR habilitado en segmentos MP4 de 15 segundos (buffer rotativo de 5 minutos).
La grabación es **bajo demanda**: solo graba cuando un cliente está viendo el canal.
La APK debe usar estos endpoints para reproducir desde el DVR en lugar del stream directo,
lo que elimina cortes y buffering en canales inestables.

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
  "segmentDuration": 15,
  "bufferSeconds": 300
}
```
**Cuándo llamar:** Al abrir un canal que tenga `dvr_enabled: true` en la lista de canales.

### 2. Detener DVR al cerrar/cambiar canal
```
POST /api/dvr/stop/{channelId}
Authorization: Bearer <token>
```
**Respuesta:**
```json
{ "ok": true }
```
**Cuándo llamar:** Al salir del canal o cambiar a otro canal. Si el canal nuevo también tiene DVR, llamar stop del anterior y start del nuevo.

### 3. Obtener playlist HLS con segmentos MP4 (para LibVLC)
```
GET /api/dvr/playlist/{channelId}
Authorization: Bearer <token>
```
**Respuesta:** `Content-Type: application/vnd.apple.mpegurl`
```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:16
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:15,
http://SERVER/api/dvr/segment/{channelId}/seg_000.mp4?token=JWT
#EXTINF:15,
http://SERVER/api/dvr/segment/{channelId}/seg_001.mp4?token=JWT
...
```
**USO:** Esta URL se pasa directamente a LibVLC como source. LibVLC sabe reproducir HLS con segmentos MP4.

### 4. Obtener lista de segmentos (alternativa manual)
```
GET /api/dvr/segments/{channelId}
Authorization: Bearer <token>
```
**Respuesta:**
```json
{
  "segments": [
    { "index": 0, "filename": "seg_000.mp4", "duration": 15 },
    { "index": 1, "filename": "seg_001.mp4", "duration": 15 }
  ],
  "recording": true,
  "viewers": 1
}
```

### 5. Descargar segmento individual
```
GET /api/dvr/segment/{channelId}/{filename}?token=JWT
```
**Respuesta:** `Content-Type: video/mp4` (archivo MP4 binario)
Soporta también `Authorization: Bearer <token>` en header.

---

## CAMPO dvr_enabled EN CANALES

El endpoint `/api/channels` (GET) ahora incluye `dvr_enabled: boolean` en cada canal.
```json
{
  "id": "uuid",
  "name": "Canal HD",
  "url": "http://...",
  "dvr_enabled": true,
  ...
}
```

---

## FLUJO COMPLETO EN LA APK

### Al abrir un canal:
```kotlin
val channel = selectedChannel

if (channel.dvr_enabled) {
    // 1. Notificar al servidor que inicie grabación
    apiService.startDvr(channel.id)
    
    // 2. Esperar 3-5 segundos para que se acumulen segmentos
    delay(4000)
    
    // 3. Reproducir desde la playlist DVR (HLS con segmentos MP4)
    val dvrUrl = "${BuildConfig.API_BASE_URL}/api/dvr/playlist/${channel.id}"
    // Pasar a LibVLC con header Authorization
    playWithVlc(dvrUrl, token)
} else {
    // Canal sin DVR: reproducir stream directo como siempre
    val streamUrl = "${BuildConfig.API_BASE_URL}/api/stream/${channel.id}?token=$token"
    playWithVlc(streamUrl, token)
}
```

### Al cambiar de canal:
```kotlin
fun changeChannel(oldChannel: Channel, newChannel: Channel) {
    // Siempre detener DVR del canal anterior si tenía DVR
    if (oldChannel.dvr_enabled) {
        lifecycleScope.launch { apiService.stopDvr(oldChannel.id) }
    }
    
    // Abrir nuevo canal (con o sin DVR)
    openChannel(newChannel)
}
```

### Al cerrar la app / cerrar sesión:
```kotlin
// Detener DVR del canal actual si estaba activo
if (currentChannel?.dvr_enabled == true) {
    apiService.stopDvr(currentChannel.id)
}
```

---

## CONFIGURACIÓN LibVLC PARA DVR

```kotlin
fun playDvrWithVlc(dvrPlaylistUrl: String, token: String) {
    val options = arrayListOf(
        "--http-reconnect",
        "--network-caching=3000",      // 3s de buffer de red
        "--live-caching=3000",
        "--file-caching=1500",
        "--clock-jitter=0",
        "--sout-mux-caching=2000",
        "--http-forward-cookies",
    )
    
    val libVLC = LibVLC(context, options)
    val mediaPlayer = MediaPlayer(libVLC)
    
    // Crear media con header de autenticación
    val uri = Uri.parse(dvrPlaylistUrl)
    val media = Media(libVLC, uri)
    media.addOption(":http-referrer=")
    media.addOption(":http-user-agent=OmnisyncTV/1.0")
    // IMPORTANTE: Pasar el token JWT como header
    media.addOption(":http-header=Authorization: Bearer $token")
    
    mediaPlayer.media = media
    mediaPlayer.play()
}
```

---

## INTERFAZ ApiService (Retrofit)

Agregar estos endpoints al `interface ApiService`:

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
    val bufferSeconds: Int
)

data class DvrSegmentsResponse(
    val segments: List<DvrSegment>,
    val recording: Boolean,
    val viewers: Int
)

data class DvrSegment(
    val index: Int,
    val filename: String,
    val duration: Int
)
```

### Actualizar Channel data class:
```kotlin
data class Channel(
    val id: String,
    val name: String,
    val url: String,
    val category: String,
    @SerializedName("is_active") val isActive: Boolean,
    @SerializedName("logo_url") val logoUrl: String?,
    @SerializedName("dvr_enabled") val dvrEnabled: Boolean = false  // ← NUEVO
)
```

---

## MANEJO DE ERRORES DVR

```kotlin
suspend fun openChannelWithDvr(channel: Channel) {
    if (!channel.dvrEnabled) {
        // Sin DVR → stream directo
        playDirectStream(channel)
        return
    }
    
    try {
        // Intentar iniciar DVR
        val response = apiService.startDvr(channel.id)
        if (response.isSuccessful && response.body()?.recording == true) {
            // Esperar a que haya segmentos listos
            delay(4000)
            
            // Intentar reproducir desde DVR
            val dvrUrl = "${BuildConfig.API_BASE_URL}/api/dvr/playlist/${channel.id}"
            playWithVlc(dvrUrl, token)
        } else {
            // DVR no disponible → fallback a stream directo
            playDirectStream(channel)
        }
    } catch (e: Exception) {
        // Error de red → fallback a stream directo
        Log.w("DVR", "Error iniciando DVR, usando stream directo", e)
        playDirectStream(channel)
    }
}
```

---

## REGLAS IMPORTANTES

1. **NO cambiar el flujo de canales sin DVR** - Solo afectar canales con `dvr_enabled: true`
2. **Siempre llamar stop** al salir de un canal DVR (para liberar recursos del servidor)
3. **Esperar 3-5 segundos** después de `start` antes de reproducir la playlist (FFmpeg necesita generar los primeros segmentos)
4. **Fallback obligatorio** - Si DVR falla, reproducir stream directo
5. **El token JWT** se pasa via header `Authorization: Bearer <token>` O como query param `?token=JWT` en las URLs de segmentos
6. **La playlist se refresca sola** - LibVLC recarga la playlist HLS automáticamente para obtener nuevos segmentos
7. **No llamar stop al cambiar canal** si el nuevo canal es el mismo (evitar reinicio innecesario)
