# MD Chat — fundația

Mesagerie (ca WhatsApp/Viber) + apeluri video de grup (ca Zoom), cu baza pe Supabase și serverul media în Moldova.

| Dosar | Ce conține |
|-------|------------|
| [`docs/LECTII.md`](docs/LECTII.md) | Greșelile Telegram, Viber, Zoom, Skype, WhatsApp și deciziile luate din ele |
| [`docs/ARHITECTURA.md`](docs/ARHITECTURA.md) | Cum se leagă piesele, unde stau datele, ce urmează |
| `supabase/` | Schema bazei de date, regulile de securitate, testele, funcția care emite tokenuri de apel |
| `server/` | Serverul media LiveKit pentru VPS-ul din Moldova (Docker Compose) |
| `android/` | Aplicația Android de test |

## Pornire pentru testare

### 1. Supabase (≈10 minute)

1. Creează un proiect pe https://supabase.com (regiunea Frankfurt e cea mai apropiată).
2. Pentru testare rapidă: **Authentication → Sign In / Providers → Email → dezactivează „Confirm email”**.
3. Din dosarul `chat/`:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ID-PROIECT>
   npx supabase db push                      # creează tabelele și regulile
   npx supabase secrets set LIVEKIT_URL=wss://apeluri.exemplu.md \
       LIVEKIT_API_KEY=<cheie> LIVEKIT_API_SECRET=<secret>
   npx supabase functions deploy livekit-token
   ```

Mesageria funcționează după acest pas; apelurile au nevoie și de pasul 2.

### 2. Serverul din Moldova

Vezi [`server/README.md`](server/README.md). Cheia și secretul din `.env` sunt aceleași cu cele de la pasul 1.

### 3. Aplicația Android

**Din GitHub (fără nimic instalat):** în repository, *Settings → Secrets and variables → Actions → Variables*,
adaugă `SUPABASE_URL` și `SUPABASE_ANON_KEY` (din Supabase: *Project Settings → API*). Apoi *Actions →
Build MD Chat APK → Run workflow*. APK-ul apare ca artefact `md-chat-debug-apk`.

**Local:** pune aceleași două valori în `chat/android/local.properties`, apoi
`cd chat/android && ./gradlew :app:assembleDebug`.

### 4. Test

Instalează APK-ul pe două telefoane, creează două conturi, pe unul apasă „Chat nou” și scrie username-ul
celuilalt. Trimite mesaje, apoi apasă „Video”.

## Teste automate

```bash
chat/supabase/tests/run_local.sh                                   # 49 de verificări de securitate, pe PostgreSQL local
node --test chat/supabase/functions/livekit-token/token.test.ts    # semnătura tokenului de apel
```

Rulează și la fiecare modificare, prin workflow-ul `Build MD Chat APK`.
