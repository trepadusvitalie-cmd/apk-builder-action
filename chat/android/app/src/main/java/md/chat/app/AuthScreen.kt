package md.chat.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private val usernameRule = Regex("^[a-z0-9_]{3,32}$")

@Composable
fun AuthScreen() {
    var registering by rememberSaveable { mutableStateOf(false) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var username by rememberSaveable { mutableStateOf("") }
    var busy by rememberSaveable { mutableStateOf(false) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun submit() {
        val cleanEmail = email.trim()
        val cleanUsername = username.trim().lowercase()
        notice = when {
            cleanEmail.isEmpty() || password.length < 8 -> "Introdu e-mailul și o parolă de cel puțin 8 caractere."
            registering && !usernameRule.matches(cleanUsername) ->
                "Numele de utilizator: 3–32 caractere, doar litere mici, cifre și _."
            else -> null
        }
        if (notice != null) return
        busy = true
        scope.launch {
            try {
                if (registering) {
                    val signedIn = Backend.signUp(cleanEmail, password, cleanUsername)
                    if (!signedIn) notice = "Cont creat. Confirmă adresa din e-mailul primit, apoi autentifică-te."
                } else {
                    Backend.signIn(cleanEmail, password)
                }
            } catch (e: Exception) {
                notice = e.readable()
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, alignment = androidx.compose.ui.Alignment.CenterVertically),
    ) {
        Text("MD Chat", style = MaterialTheme.typography.headlineMedium)
        Text(
            if (registering) "Creează un cont" else "Autentificare",
            style = MaterialTheme.typography.titleMedium,
        )
        if (registering) {
            OutlinedTextField(
                value = username,
                onValueChange = { username = it },
                label = { Text("Nume de utilizator") },
                supportingText = { Text("Așa te vor găsi ceilalți. Nu cerem număr de telefon.") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-mail") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Parolă") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )
        notice?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(onClick = ::submit, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            Text(if (registering) "Creează contul" else "Intră")
        }
        TextButton(onClick = { registering = !registering; notice = null }, enabled = !busy) {
            Text(if (registering) "Am deja cont" else "Nu am cont")
        }
    }
}
