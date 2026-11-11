package md.chat.app

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

@Composable
fun CallScreen(callId: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val needed = remember { arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) }
    fun has(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    var micAllowed by remember { mutableStateOf(has(Manifest.permission.RECORD_AUDIO)) }
    var cameraAllowed by remember { mutableStateOf(has(Manifest.permission.CAMERA)) }
    var asked by remember { mutableStateOf(micAllowed && cameraAllowed) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        micAllowed = result[Manifest.permission.RECORD_AUDIO] ?: micAllowed
        cameraAllowed = result[Manifest.permission.CAMERA] ?: cameraAllowed
        asked = true
    }
    LaunchedEffect(Unit) { if (!asked) launcher.launch(needed) }

    when {
        !asked -> Centered { Text("Se cer permisiunile…") }
        !micAllowed -> Centered {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Apelul are nevoie de acces la microfon.")
                Button(onClick = onClose) { Text("Înapoi") }
            }
        }
        else -> ActiveCall(callId, cameraAllowed, onClose)
    }
}

@Composable
private fun ActiveCall(callId: String, cameraAllowed: Boolean, onClose: () -> Unit) {
    val context = LocalContext.current
    val room = remember { LiveKit.create(context.applicationContext) }
    val remoteVideos = remember { mutableStateListOf<VideoTrack>() }
    var localVideo by remember { mutableStateOf<VideoTrack?>(null) }
    var status by remember { mutableStateOf("Se conectează…") }
    var participants by remember { mutableStateOf(0) }
    var micOn by remember { mutableStateOf(true) }
    var cameraOn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun refreshLocalVideo() {
        localVideo = room.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
    }

    LaunchedEffect(callId) {
        try {
            val access = Backend.callAccess(callId)
            launch {
                room.events.collect { event ->
                    when (event) {
                        is RoomEvent.TrackSubscribed -> (event.track as? VideoTrack)?.let { remoteVideos.add(it) }
                        is RoomEvent.TrackUnsubscribed -> remoteVideos.remove(event.track)
                        is RoomEvent.ParticipantConnected, is RoomEvent.ParticipantDisconnected ->
                            participants = room.remoteParticipants.size
                        is RoomEvent.Disconnected -> status = "Deconectat"
                        else -> Unit
                    }
                }
            }
            room.connect(access.url, access.token)
            participants = room.remoteParticipants.size
            status = "Conectat"
            room.localParticipant.setMicrophoneEnabled(true)
            if (access.kind == "video" && cameraAllowed) {
                room.localParticipant.setCameraEnabled(true)
                cameraOn = true
                refreshLocalVideo()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            status = e.readable()
        }
    }

    DisposableEffect(callId) {
        onDispose {
            room.disconnect()
            room.release()
            // Trebuie să ajungă la server chiar dacă ecranul s-a închis deja.
            @Suppress("OPT_IN_USAGE")
            GlobalScope.launch { runCatching { Backend.leaveCall(callId) } }
        }
    }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Text(
            "$status · ${participants + 1} participanți",
            Modifier.fillMaxWidth().padding(12.dp),
            color = Color.White,
            style = MaterialTheme.typography.labelLarge,
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (remoteVideos.isEmpty()) {
                Centered { Text(if (participants == 0) "Se așteaptă ceilalți…" else "Doar audio", color = Color.White) }
            } else {
                Column(Modifier.fillMaxSize()) {
                    remoteVideos.forEach { track ->
                        key(track.sid) { VideoView(room, track, Modifier.weight(1f).fillMaxWidth()) }
                    }
                }
            }
            localVideo?.let { track ->
                key(track.sid) {
                    VideoView(room, track, Modifier.align(Alignment.BottomEnd).padding(12.dp).size(96.dp, 144.dp), mirror = true)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            OutlinedButton(onClick = {
                scope.launch {
                    runCatching { room.localParticipant.setMicrophoneEnabled(!micOn) }.onSuccess { micOn = !micOn }
                }
            }) { Text(if (micOn) "Microfon pornit" else "Microfon oprit", color = Color.White) }
            if (cameraAllowed) {
                OutlinedButton(onClick = {
                    scope.launch {
                        runCatching { room.localParticipant.setCameraEnabled(!cameraOn) }.onSuccess {
                            cameraOn = !cameraOn
                            refreshLocalVideo()
                        }
                    }
                }) { Text(if (cameraOn) "Cameră pornită" else "Cameră oprită", color = Color.White) }
            }
            Button(onClick = onClose, colors = ButtonDefaults.buttonColors(containerColor = Color.Red)) {
                Text("Închide")
            }
        }
    }
}

@Composable
private fun VideoView(room: Room, track: VideoTrack, modifier: Modifier, mirror: Boolean = false) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            TextureViewRenderer(context).also { view ->
                room.initVideoRenderer(view)
                view.setMirror(mirror)
                track.addRenderer(view)
            }
        },
        onRelease = { view ->
            track.removeRenderer(view)
            view.release()
        },
    )
}
