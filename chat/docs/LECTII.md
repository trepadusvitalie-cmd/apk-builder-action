# Lecții din greșelile altora

Ce au greșit Telegram, Viber, Zoom, Skype și WhatsApp și ce decizie am luat noi din cauza asta.
Numerele L1–L14 apar și în comentariile din cod, ca fiecare regulă să poată fi urmărită până la motivul ei.

> Evenimentele de mai jos sunt redate din memorie, la nivel de rezumat. Înainte de a le cita public
> (site, prezentare pentru investitori), verificați fiecare dată și cifră în surse primare.

## Pe scurt

| # | Greșeala | Cine | Decizia noastră | Stare |
|---|----------|------|-----------------|-------|
| L1 | Criptare end-to-end opțională sau cu protocol propriu | Telegram, Viber, Skype | E2EE implicit, cu protocol public și auditat (Signal/MLS), nu inventat de noi | Pregătit în schemă, **neimplementat** |
| L2 | A pretins o securitate pe care nu o avea | Zoom | Aplicația spune exact ce protecție există acum | Făcut |
| L3 | Numărul de telefon ca identitate; agenda urcată pe server | Telegram, WhatsApp, Viber | Username, fără telefon, fără agendă, fără enumerare de utilizatori | Făcut |
| L4 | Date și metadate date mai departe către terți | WhatsApp, Zoom | Zero SDK-uri de analiză/reclame; colectăm minimul | Făcut (prin absență) |
| L5 | Multi-device adăugat târziu, peste o arhitectură de un singur telefon | WhatsApp, Telegram | Tabel `devices` de la prima versiune | Pregătit în schemă |
| L6 | Mesaje pierdute, dublate sau în ordine greșită | Skype | Timpul îl pune serverul; `client_id` face retrimiterea idempotentă | Făcut |
| L7 | Oricine cu un ID ghicit intra în ședință („zoombombing”) | Zoom | Fără ID-uri numerice; intrare doar cu token emis de server pentru membri; blocare cameră | Făcut |
| L8 | Trafic și chei trecute prin jurisdicții neașteptate | Zoom | Server media propriu, într-un loc cunoscut (Moldova) | Configurat, de instalat |
| L9 | Băgat în grupuri de necunoscuți; linkuri de invitație publice | WhatsApp, Telegram | În grup pot fi adăugate doar contacte existente | Făcut |
| L10 | „Șters” care nu șterge | Telegram, WhatsApp | Ștergerea elimină conținutul de pe server | Făcut (text); fișierele din Storage urmează |
| L11 | Încredere în aplicația client; suprafață mare de atac | Zoom, WhatsApp | Toate regulile de acces stau în baza de date (RLS), nu în aplicație | Făcut, testat |
| L12 | Fișiere și copii de siguranță necriptate | Viber, WhatsApp | Bucket privat; backup-ul Android al aplicației dezactivat | Făcut |
| L13 | Produs umflat, redesenat împotriva utilizatorilor | Skype | Puține funcții, făcute bine; apel dintr-o apăsare | Principiu |
| L14 | Reguli neclare față de autorități și moderare | Telegram, Zoom, Viber | Politici scrise înainte de lansare; conformitate cu legea din Moldova | **De făcut** (jurist) |

## Detalii

### L1 — Criptarea end-to-end nu poate fi opțională
- **Telegram**: conversațiile obișnuite („cloud chats”) nu sunt criptate end-to-end; doar „secret chats”,
  pornite manual, doar între două persoane, pe un singur dispozitiv. Grupurile nu au E2EE deloc.
  Protocolul propriu (MTProto) a fost criticat ani la rând de criptografi tocmai pentru că e făcut în casă.
- **Viber** a introdus E2EE abia în 2016; **Skype** nu l-a avut niciodată implicit.
- **WhatsApp** a făcut invers și corect: în 2016 a adoptat protocolul Signal pentru toți, implicit.

**Decizie.** Țintă: E2EE implicit pentru mesaje, cu o bibliotecă existentă (libsignal sau MLS/OpenMLS),
nu criptografie scrisă de noi. Coloana `messages.encryption` și tabelul `devices` există deja pentru asta.
În faza de test mesajele **nu** sunt E2EE — vezi L2.

### L2 — Nu promite ce nu ai
- **Zoom** a scris „end-to-end encrypted” în materiale când serverele lui aveau de fapt cheile.
  În 2020 cercetătorii (Citizen Lab) au arătat și că folosea AES-128 în mod ECB. A urmat o înțelegere
  cu autoritatea americană FTC și un proces colectiv de zeci de milioane de dolari. E2EE real a apărut
  abia la sfârșitul lui 2020.

**Decizie.** Fiecare mesaj are în bază tipul de protecție, iar ecranul de chat afișează:
„Faza de test: mesajele sunt criptate în tranzit, dar nu end-to-end.” Textul dispare doar când devine fals.

### L3 — Numărul de telefon nu e o identitate bună
- **Telegram**: în 2016, prin funcția de import al contactelor, au fost verificate în masă circa
  15 milioane de numere iraniene. Funcția „People Nearby” permitea localizarea prin triangulație.
- **WhatsApp**: în 2022 a apărut la vânzare o bază cu sute de milioane de numere de utilizatori, obținută prin colectare automată.
- **Viber/WhatsApp/Telegram**: spam și fraude de la necunoscuți care au doar numărul tău.

**Decizie.** Cont cu e-mail + username. Nu cerem telefon și nu urcăm agenda. Nu există listă de utilizatori:
`find_user` întoarce un rezultat doar la potrivire exactă de username. Profilul cuiva devine vizibil abia
când aveți o conversație comună. Blocarea e impusă pe server. Există o limită de viteză la trimitere.

### L4 — Datele utilizatorilor nu pleacă la terți
- **WhatsApp**: schimbarea politicii din 2021 (date partajate cu Facebook) a provocat un exod spre Signal și Telegram
  și o amendă de 225 mil. € în Irlanda pentru lipsă de transparență.
- **Zoom**: aplicația iOS trimitea date către Facebook printr-un SDK, chiar și pentru cei fără cont Facebook (2020).

**Decizie.** Niciun SDK de analiză, reclame sau „login social” în aplicație. Orice dependență nouă care
trimite date în afara serverelor noastre se discută înainte.

### L5 — Mai multe dispozitive, din prima zi
- **WhatsApp** a fost legat de un singur telefon până în 2021; WhatsApp Web era doar o oglindă a telefonului.
- **Telegram**: „secret chats” nu se sincronizează între dispozitive.

**Decizie.** Tabelul `devices` (și `push_tokens`, separat) există de la început; istoricul stă pe server.
Când vine E2EE, cheile vor fi per dispozitiv, nu per cont.

### L6 — Livrarea trebuie să fie plictisitor de sigură
- **Skype**, după trecerea de la rețeaua P2P la serverele Microsoft, a avut ani de mesaje sosite cu întârziere,
  în altă ordine pe fiecare dispozitiv, și notificări fantomă.

**Decizie.** `created_at` este mereu pus de server (clientul nu-l poate falsifica). Fiecare mesaj are un
`client_id` generat de aplicație; dacă rețeaua cade și aplicația retrimite, serverul refuză dublura.

### L7 — O ședință video nu e o ușă deschisă
- **Zoom**, primăvara 2020: ID-uri numerice de 9–11 cifre, fără parolă și fără sală de așteptare implicit.
  Străini intrau în lecții și ședințe („zoombombing”). Parolele și sala de așteptare au devenit implicite abia după scandal.

**Decizie.** Camerele au nume aleatoriu de 128 de biți, dar nici măcar numele nu e cheia: în cameră intri
doar cu un token semnat de server, valabil 10 minute, emis numai dacă baza de date confirmă că ești membru
al conversației (`join_call`). Organizatorul poate bloca apelul (`set_call_locked`).
Linkurile de invitație pentru persoane din afară vor veni mai târziu, cu expirare și sală de așteptare.

### L8 — Știi pe unde trece apelul
- **Zoom** (2020): cheile unor ședințe din America de Nord erau generate pe servere din China.

**Decizie.** Server media propriu (LiveKit, open-source) pe un VPS din Moldova — `chat/server/`.
Secretul serverului media stă doar în Edge Function, niciodată în aplicație.

### L9 — Nimeni nu te bagă în grupuri fără voie
- **WhatsApp**: mult timp oricine îți știa numărul te putea adăuga într-un grup; linkurile de invitație
  publicate pe web au ajuns indexate de Google (2020).
- **Telegram**: grupuri și canale de spam și fraudă cu adăugare în masă.

**Decizie.** Într-un grup poți adăuga doar pe cineva cu care ai deja o conversație directă, și doar dacă
ești proprietar sau administrator. Limită: 256 de membri.

### L10 — Ștergerea trebuie să fie adevărată
- La **Telegram** și **WhatsApp** au existat cazuri în care „șterge pentru toți” lăsa fișierele media pe dispozitivul celuilalt.

**Decizie.** `delete_message` golește conținutul pe server și șterge înregistrările atașamentelor.
De făcut: ștergerea fișierului din Storage și ștergerea completă a contului.

### L11 — Nu avea încredere în aplicația client
- **Zoom** (2019): instala pe Mac un server web ascuns care rămânea și după dezinstalare și putea porni camera.
- **WhatsApp** (2019): un simplu apel primit, chiar nepreluat, instala spyware-ul Pegasus (CVE-2019-3568).

**Decizie.** Toată autorizarea stă în PostgreSQL (Row Level Security + funcții verificate) și e acoperită
de teste automate. Aplicația cere doar permisiunile de cameră și microfon, la momentul apelului.

### L12 — Fișierele și copiile de siguranță sunt tot date
- **Viber** (2014): imaginile și clipurile erau trimise și stocate necriptat, accesibile fără autentificare.
- **WhatsApp**: copiile din iCloud/Google Drive au fost necriptate până în 2021 — ocolind complet E2EE.

**Decizie.** Bucket `attachments` privat, acces doar pentru membrii conversației. Aplicația Android are
backup-ul în cloud dezactivat.

### L13 — Produsul simplu câștigă
- **Skype** a avut tot: utilizatori, brand, tehnologie. A pierdut prin redesenări respinse de utilizatori (2017),
  lentoare și complexitate; în 2020 lumea a ales Zoom, unde intrai în apel dintr-un click. Skype a fost închis în 2025.

**Decizie.** Trei ecrane: conversații, chat, apel. Apelul pornește din conversație dintr-o apăsare.
Funcțiile noi intră doar dacă nu strică asta.

### L14 — Regulile cu statul și cu abuzurile se scriu înainte, nu după
- **Telegram**: lipsa de moderare și de cooperare a dus la arestarea fondatorului în Franța (2024) și la schimbarea bruscă a politicii.
- **Zoom** (2020): a suspendat conturi ale unor activiști la cererea unui guvern, apoi și-a cerut scuze.
- **Viber** a fost blocat în Rusia (2024).

**Decizie (de făcut, cu un jurist din Moldova).** Politică de confidențialitate, termeni, procedură de
raportare a abuzurilor și procedură pentru cereri ale autorităților, toate publice, înainte de lansare.
De verificat cerințele legii moldovenești privind protecția datelor cu caracter personal și notificarea la CNPDCP.
