package md.chat.app

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.decodeRecord
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.serializer.KotlinXSerializer
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onCompletion
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

@Serializable
data class Conversation(
    val id: String,
    val kind: String,
    val title: String,
    @SerialName("last_message") val lastMessage: String? = null,
    @SerialName("unread_count") val unreadCount: Int = 0,
    @SerialName("active_call_id") val activeCallId: String? = null,
)

@Serializable
data class Message(
    val id: String,
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("sender_id") val senderId: String? = null,
    val kind: String = "text",
    val encryption: String = "none",
    val body: String? = null,
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("deleted_at") val deletedAt: String? = null,
)

@Serializable
data class Profile(
    val id: String,
    val username: String,
    @SerialName("display_name") val displayName: String,
)

@Serializable
data class Call(
    val id: String,
    @SerialName("conversation_id") val conversationId: String,
    val kind: String,
    @SerialName("ended_at") val endedAt: String? = null,
)

@Serializable
data class CallAccess(val token: String, val url: String, val room: String, val kind: String = "video")

@Serializable
private data class NewMessage(
    @SerialName("conversation_id") val conversationId: String,
    @SerialName("client_id") val clientId: String,
    val body: String,
)

/** Tot accesul la server trece prin acest obiect; ecranele nu vorbesc direct cu Supabase. */
object Backend {
    val isConfigured: Boolean
        get() = BuildConfig.SUPABASE_URL.startsWith("https://") && BuildConfig.SUPABASE_ANON_KEY.isNotBlank()

    private val json = Json { ignoreUnknownKeys = true }

    val client by lazy {
        createSupabaseClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY) {
            defaultSerializer = KotlinXSerializer(json)
            install(Auth)
            install(Postgrest)
            install(Realtime)
            install(Functions)
        }
    }

    val sessionStatus get() = client.auth.sessionStatus
    val currentUserId: String? get() = client.auth.currentUserOrNull()?.id

    suspend fun signIn(email: String, password: String) {
        client.auth.signInWith(Email) {
            this.email = email
            this.password = password
        }
    }

    /** Întoarce true dacă utilizatorul e deja autentificat (confirmarea prin e-mail e dezactivată). */
    suspend fun signUp(email: String, password: String, username: String): Boolean {
        client.auth.signUpWith(Email) {
            this.email = email
            this.password = password
            data = buildJsonObject {
                put("username", username.trim().lowercase())
                put("display_name", username.trim())
            }
        }
        return client.auth.currentSessionOrNull() != null
    }

    suspend fun signOut() = client.auth.signOut()

    suspend fun myProfile(): Profile? {
        val me = currentUserId ?: return null
        return client.from("profiles").select { filter { eq("id", me) } }.decodeSingleOrNull<Profile>()
    }

    suspend fun conversations(): List<Conversation> =
        client.postgrest.rpc("my_conversations").decodeList()

    suspend fun findUser(username: String): Profile? =
        client.postgrest.rpc("find_user", buildJsonObject { put("p_username", username) })
            .decodeList<Profile>().firstOrNull()

    suspend fun openDirectConversation(otherUserId: String): String =
        client.postgrest.rpc("create_direct_conversation", buildJsonObject { put("p_other_user", otherUserId) })
            .decodeAs()

    /** Profilurile vizibile mie (eu + oamenii cu care am conversații), indexate după id. */
    suspend fun visibleProfiles(): Map<String, Profile> =
        client.from("profiles").select().decodeList<Profile>().associateBy { it.id }

    suspend fun messages(conversationId: String, limit: Long = 200): List<Message> =
        client.from("messages").select {
            filter { eq("conversation_id", conversationId) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.decodeList<Message>().reversed()

    /** client_id face retrimiterea sigură: serverul refuză dublura (lecția L6). */
    suspend fun sendMessage(conversationId: String, body: String, clientId: String = UUID.randomUUID().toString()) {
        client.from("messages").insert(NewMessage(conversationId, clientId, body))
    }

    suspend fun markRead(conversationId: String) {
        client.postgrest.rpc("mark_read", buildJsonObject { put("p_conversation_id", conversationId) })
    }

    /** Mesajele noi dintr-o conversație, în timp real. Canalul se închide când colectarea se oprește. */
    suspend fun newMessages(conversationId: String): Flow<Message> {
        val channel = client.channel("messages-$conversationId-${UUID.randomUUID()}")
        val flow = channel.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = "messages"
            filter("conversation_id", FilterOperator.EQ, conversationId)
        }
        channel.subscribe()
        return flow
            .map { it.decodeRecord<Message>() }
            .onCompletion { runCatching { client.realtime.removeChannel(channel) } }
    }

    suspend fun startCall(conversationId: String, video: Boolean): Call =
        client.postgrest.rpc("start_call", buildJsonObject {
            put("p_conversation_id", conversationId)
            put("p_kind", if (video) "video" else "audio")
        }).decodeAs()

    /** Serverul verifică dreptul de acces și emite un token LiveKit de scurtă durată. */
    suspend fun callAccess(callId: String): CallAccess {
        val response = client.functions.invoke("livekit-token", buildJsonObject { put("call_id", callId) })
        return json.decodeFromString(response.bodyAsText())
    }

    suspend fun leaveCall(callId: String) {
        client.postgrest.rpc("leave_call", buildJsonObject { put("p_call_id", callId) })
    }
}
