package md.chat.app

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun ConversationsScreen(onOpen: (id: String, title: String) -> Unit) {
    var conversations by remember { mutableStateOf<List<Conversation>?>(null) }
    var me by remember { mutableStateOf<Profile?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showNewChat by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Faza de test: reîmprospătare periodică. Urmează un canal realtime pe conversațiile mele.
    LaunchedEffect(Unit) {
        runCatching { me = Backend.myProfile() }
        while (true) {
            try {
                conversations = Backend.conversations()
                error = null
            } catch (e: Exception) {
                error = e.readable()
            }
            delay(5_000)
        }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Conversații", style = MaterialTheme.typography.headlineSmall)
                me?.let { Text("@${it.username}", style = MaterialTheme.typography.bodySmall) }
            }
            Button(onClick = { showNewChat = true }) { Text("Chat nou") }
            TextButton(onClick = { scope.launch { runCatching { Backend.signOut() } } }) { Text("Ieși") }
        }
        error?.let { Text(it, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error) }

        val list = conversations
        when {
            list == null -> Centered { Text("Se încarcă…") }
            list.isEmpty() -> Centered { Text("Nicio conversație. Apasă „Chat nou”.") }
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(list, key = { it.id }) { conversation ->
                    ListItem(
                        headlineContent = { Text(conversation.title) },
                        supportingContent = {
                            Text(
                                when {
                                    conversation.activeCallId != null -> "📞 Apel în desfășurare"
                                    else -> conversation.lastMessage.orEmpty()
                                },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                        trailingContent = {
                            if (conversation.unreadCount > 0) Badge { Text(conversation.unreadCount.toString()) }
                        },
                        modifier = Modifier.clickable { onOpen(conversation.id, conversation.title) },
                    )
                    HorizontalDivider()
                }
            }
        }
    }

    if (showNewChat) {
        NewChatDialog(
            onDismiss = { showNewChat = false },
            onOpened = { id, title ->
                showNewChat = false
                onOpen(id, title)
            },
        )
    }
}

@Composable
private fun NewChatDialog(onDismiss: () -> Unit, onOpened: (id: String, title: String) -> Unit) {
    var username by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Chat nou") },
        text = {
            Column {
                OutlinedTextField(
                    value = username,
                    onValueChange = { username = it },
                    label = { Text("Nume de utilizator exact") },
                    singleLine = true,
                )
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && username.isNotBlank(),
                onClick = {
                    busy = true
                    scope.launch {
                        try {
                            val user = Backend.findUser(username.trim().removePrefix("@"))
                            if (user == null || user.id == Backend.currentUserId) {
                                error = "Utilizator negăsit."
                            } else {
                                onOpened(Backend.openDirectConversation(user.id), user.displayName)
                            }
                        } catch (e: Exception) {
                            error = e.readable()
                        } finally {
                            busy = false
                        }
                    }
                },
            ) { Text("Deschide") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Renunță") } },
    )
}
