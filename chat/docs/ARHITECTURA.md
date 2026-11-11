# Arhitectură

```
 Telefon (Android, Kotlin/Compose)
   │
   ├── HTTPS / WebSocket ──► Supabase
   │                           ├─ Auth        conturi (e-mail + parolă)
   │                           ├─ PostgreSQL  mesaje, conversații, apeluri + toate regulile de acces (RLS)
   │                           ├─ Realtime    mesaje noi livrate instant
   │                           ├─ Storage     fișiere (bucket privat)
   │                           └─ Edge Function „livekit-token”
   │                                 verifică în bază dreptul de acces, semnează un token de 10 minute
   │
   └── WebRTC (audio/video) ──► LiveKit pe VPS în Moldova   ← partea „Zoom”
```

## De ce așa

- **Supabase** ne dă cont, bază de date, timp real și fișiere fără să scriem un server propriu.
  Regulile de securitate sunt SQL versionat în `supabase/migrations/` și testat automat.
- **LiveKit** este un server media open-source (SFU). Pentru apeluri de grup fiecare participant trimite
  un singur flux către server, nu câte unul către fiecare coleg — de aceea merge și cu 20+ oameni.
- **Aplicația nu deține secrete.** Cheia „anon” Supabase e publică prin design. Secretul LiveKit stă doar în Edge Function.

## Unde stau datele

Supabase Cloud nu are regiune în Moldova (cea mai apropiată este Frankfurt). Propunerea:

| Etapă | Baza de date (Supabase) | Media apeluri (LiveKit) |
|-------|-------------------------|-------------------------|
| Testare | Supabase Cloud, regiunea Frankfurt — gratuit, gata în 5 minute | VPS în Moldova |
| Producție | Supabase self-hosted (Docker) pe server în Moldova | VPS în Moldova |

Trecerea de la cloud la self-hosted nu schimbă codul: aceleași migrări, aceeași funcție, alt URL.
Dacă datele trebuie să fie în Moldova chiar din faza de test, se instalează direct varianta self-hosted
(https://supabase.com/docs/guides/self-hosting/docker) — cere un server cu minimum 4 GB RAM.

## Fluxul unui apel

1. Aplicația apelează `start_call(conversație)` → rând în `calls` + mesaj de tip `call` în conversație.
2. Ceilalți membri văd mesajul în timp real și apasă „Intră”.
3. Fiecare aplicație cere `livekit-token` cu `call_id`. Funcția apelează `join_call` cu identitatea
   utilizatorului; baza de date decide (membru? apel activ? cameră blocată? utilizator blocat?).
4. Cu tokenul primit, aplicația se conectează direct la LiveKit.
5. La ieșire: `leave_call`; ultimul care pleacă închide apelul.

## Ce există și ce nu

Există: conturi, conversații directe, grupuri (în bază), mesaje text în timp real, necitite, blocare,
apeluri audio/video cu control de acces, schema pentru fișiere și dispozitive.

Nu există încă, în ordinea propusă:
1. Notificări push (fără ele telefonul nu sună când aplicația e închisă).
2. Criptare end-to-end (L1).
3. Trimitere de fișiere și poze din aplicație (schema și regulile de Storage sunt gata).
4. Ecran de creare a grupurilor în aplicație (funcțiile din bază sunt gata și testate).
5. Webhook LiveKit → bază, partajare ecran, invitații cu link pentru persoane din afară.
6. iOS și web.
