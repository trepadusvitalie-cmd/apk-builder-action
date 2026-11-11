package md.chat.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.jan.supabase.auth.status.SessionStatus

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                Surface(Modifier.fillMaxSize().safeDrawingPadding()) { App() }
            }
        }
    }
}

@Composable
private fun App() {
    if (!Backend.isConfigured) {
        Centered {
            Text(
                "Aplicația nu este configurată.\n\nSetează SUPABASE_URL și SUPABASE_ANON_KEY la compilare " +
                    "(vezi chat/README.md).",
                Modifier.padding(24.dp),
            )
        }
        return
    }

    val session by Backend.sessionStatus.collectAsStateWithLifecycle()
    when (session) {
        is SessionStatus.Authenticated -> SignedIn()
        is SessionStatus.Initializing -> Centered { CircularProgressIndicator() }
        else -> AuthScreen()
    }
}

@Composable
private fun SignedIn() {
    // Navigare minimală: listă -> conversație -> apel.
    var openConversation by rememberSaveable { mutableStateOf<Pair<String, String>?>(null) }
    var openCall by rememberSaveable { mutableStateOf<String?>(null) }

    val conversation = openConversation
    val call = openCall
    when {
        call != null -> {
            BackHandler { openCall = null }
            CallScreen(callId = call, onClose = { openCall = null })
        }
        conversation != null -> {
            BackHandler { openConversation = null }
            ChatScreen(
                conversationId = conversation.first,
                title = conversation.second,
                onBack = { openConversation = null },
                onJoinCall = { openCall = it },
            )
        }
        else -> ConversationsScreen(onOpen = { id, title -> openConversation = id to title })
    }
}

@Composable
fun Centered(content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { content() }
}

/** Mesaj scurt, lizibil, pentru erorile venite de la server. */
fun Throwable.readable(): String {
    val text = message.orEmpty()
    return when {
        "rate_limited" in text -> "Trimiți prea repede. Așteaptă câteva secunde."
        "call_locked" in text -> "Apelul este blocat de organizator."
        "call_ended" in text -> "Apelul s-a încheiat."
        "forbidden" in text -> "Nu ai acces."
        "Invalid login credentials" in text -> "E-mail sau parolă greșită."
        "User already registered" in text -> "Există deja un cont cu acest e-mail."
        else -> text.lineSequence().firstOrNull()?.take(160) ?: "Eroare necunoscută."
    }
}
