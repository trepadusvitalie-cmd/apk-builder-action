package md.chat.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import java.util.UUID

@Composable
fun ChatScreen(conversationId: String, title: String, onBack: () -> Unit, onJoinCall: (callId: String) -> Unit) {
    val messages = remember(conversationId) { mutableStateListOf<Message>() }
    var profiles by remember { mutableStateOf<Map<String, Profile>>(emptyMap()) }
    var draft by rememberSaveable(conversationId) { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val myId = Backend.currentUserId

    LaunchedEffect(conversationId) {
        try {
            profiles = Backend.visibleProfiles()
            // Abonare înainte de încărcarea istoricului, ca să nu pierdem mesajele sosite între timp.
            val live = Backend.newMessages(conversationId)
            messages.clear()
            messages.addAll(Backend.messages(conversationId))
            Backend.markRead(conversationId)
            live.collect { message ->
                if (messages.none { it.id == message.id }) messages.add(message)
                runCatching { Backend.markRead(conversationId) }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.readable()
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    fun startCall(video: Boolean) {
        scope.launch {
            try {
                onJoinCall(Backend.startCall(conversationId, video).id)
            } catch (e: Exception) {
                error = e.readable()
            }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("‹ Înapoi") }
            Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, maxLines = 1)
            TextButton(onClick = { startCall(video = false) }) { Text("Audio") }
            TextButton(onClick = { startCall(video = true) }) { Text("Video") }
        }
        // Onestitate față de utilizator (lecțiile L1/L2): spunem clar ce protecție există acum.
        Text(
            "Faza de test: mesajele sunt criptate în tranzit, dar nu end-to-end.",
            Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(8.dp),
            style = MaterialTheme.typography.labelSmall,
        )
        error?.let { Text(it, Modifier.padding(8.dp), color = MaterialTheme.colorScheme.error) }

        LazyColumn(
            Modifier.weight(1f).fillMaxWidth().padding(horizontal = 8.dp),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(messages, key = { it.id }) { message ->
                val mine = message.senderId == myId
                when {
                    message.kind == "call" -> CallNotice(
                        text = "${profiles[message.senderId]?.displayName ?: "Cineva"} a pornit un apel",
                        onJoin = { message.body?.let(onJoinCall) },
                    )
                    else -> Bubble(
                        author = if (mine) null else profiles[message.senderId]?.displayName,
                        text = when {
                            message.deletedAt != null -> "Mesaj șters"
                            message.encryption != "none" -> "🔒 Mesaj criptat (neacceptat de această versiune)"
                            else -> message.body.orEmpty()
                        },
                        time = message.createdAt.substringAfter('T').take(5),
                        mine = mine,
                    )
                }
            }
        }

        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = draft,
                onValueChange = { if (it.length <= 8000) draft = it },
                placeholder = { Text("Scrie un mesaj") },
                modifier = Modifier.weight(1f),
                maxLines = 4,
            )
            Button(
                enabled = draft.isNotBlank(),
                modifier = Modifier.padding(start = 8.dp),
                onClick = {
                    val text = draft.trim()
                    val clientId = UUID.randomUUID().toString()
                    draft = ""
                    scope.launch {
                        try {
                            Backend.sendMessage(conversationId, text, clientId)
                            error = null
                        } catch (e: Exception) {
                            error = e.readable()
                            if (draft.isEmpty()) draft = text // nu pierdem textul utilizatorului
                        }
                    }
                },
            ) { Text("Trimite") }
        }
    }
}

@Composable
private fun Bubble(author: String?, text: String, time: String, mine: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier
                .widthIn(max = 300.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(
                    if (mine) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surfaceVariant,
                )
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            author?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary) }
            Text(text)
            Text(time, style = MaterialTheme.typography.labelSmall, modifier = Modifier.align(Alignment.End))
        }
    }
}

@Composable
private fun CallNotice(text: String, onJoin: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        Text("📞 $text", style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onJoin) { Text("Intră") }
    }
}
