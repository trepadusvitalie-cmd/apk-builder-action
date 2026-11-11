# Server media (Moldova)

LiveKit este un server SFU open-source pentru WebRTC: primește fluxurile audio/video ale
participanților și le redistribuie. Aici stă partea „Zoom” a aplicației.

## Cerințe

- VPS cu Ubuntu 22.04/24.04 la un furnizor din Republica Moldova, cu IP public fix
  (2 vCPU / 4 GB RAM ajung pentru testare; lățimea de bandă contează mai mult decât procesorul).
- Un domeniu (de ex. `apeluri.exemplu.md`) cu înregistrare DNS de tip A către acel IP.
- Docker + plugin-ul compose: `curl -fsSL https://get.docker.com | sh`

## Porturi de deschis în firewall

| Port | Protocol | Rol |
|------|----------|-----|
| 80, 443 | TCP | Caddy: certificat TLS și semnalizare WebSocket (`wss://`) |
| 7881 | TCP | rezervă media prin TCP |
| 50000–50200 | UDP | media WebRTC |

```bash
ufw allow 22/tcp && ufw allow 80,443/tcp && ufw allow 7881/tcp && ufw allow 50000:50200/udp && ufw enable
```

Portul 7880 rămâne doar pe `127.0.0.1`; nu se deschide spre internet.

## Pornire

```bash
cd chat/server
cp .env.example .env      # completează domeniul și generează cheile
docker compose up -d
docker compose logs -f livekit
```

Verificare: `curl https://apeluri.exemplu.md` trebuie să răspundă `OK`.

URL-ul pentru aplicație este `wss://apeluri.exemplu.md` — se setează ca secret
`LIVEKIT_URL` al Edge Function-ului, nu în aplicație.

## Ce lipsește încă (înainte de producție)

- **TURN/TLS pe 443** pentru rețele corporative care blochează tot în afară de HTTPS
  (LiveKit are TURN integrat; cere un al doilea subdomeniu și certificat).
- **Webhook LiveKit → Supabase** ca apelurile să se închidă în bază și când un telefon
  dispare din rețea fără să apuce să apeleze `leave_call`.
- Monitorizare (Prometheus) și copii de siguranță pentru configurație.
- Pentru mai mult de un server: Redis și mai multe noduri LiveKit.
