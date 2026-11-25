# Ironfall 2200 – ghid de publicare pe Google Play

## 1. Cheia de semnare (o singură dată)

Cheia de semnare a fost creată în dosarul `play-keys-NU-PUBLICA/`. Dosarul nu este urcat pe GitHub.

- `ironfall-upload.jks`: cheia ta de încărcare. **Păstreaz-o în 2 locuri sigure**, de exemplu pe telefon și pe Google Drive.
- `IRONFALL_KEYSTORE_PASSWORD.txt`: parola cheii.
- `IRONFALL_KEYSTORE_BASE64.txt`: cheia transformată în text, ca s-o poți pune pe GitHub.

Adaugă două secrete în GitHub:

1. Deschide repository-ul pe GitHub.
2. Intră în **Settings → Secrets and variables → Actions → New repository secret**.
3. Adaugă primul secret:
   - nume: `IRONFALL_KEYSTORE_BASE64`
   - valoare: tot textul din `IRONFALL_KEYSTORE_BASE64.txt`
4. Adaugă al doilea secret:
   - nume: `IRONFALL_KEYSTORE_PASSWORD`
   - valoare: textul din `IRONFALL_KEYSTORE_PASSWORD.txt`

După asta, fiecare build produce `Ironfall2200.aab` semnat. Îl găsești în pagina Release `ironfall-latest`, lângă APK. Numărul versiunii (versionCode) crește singur la fiecare build.

## 2. Politica de confidențialitate

1. Urcă fișierul `server/ironfall/privacy.html` pe server, lângă `api.php`.
2. Adresa paginii va fi: `https://easofty.com/ironfall/privacy.html`
3. Pune această adresă în Play Console: **Policy → App content → Privacy policy**.

## 3. Play Console – aplicație nouă

- **Nume:** Ironfall 2200
- **Limba implicită:** Română (adaugă și engleza).
- **Tip:** Joc, Gratuit.
- **Categorie:** Strategie.

### Descriere scurtă (max 80 de caractere)

- RO: Strategie în timp real: construiește baza, proiectează tancuri, cucerește cetatea.
- EN: Real-time strategy: build your base, design tanks and storm the enemy citadel.

### Descriere completă (RO)

Ironfall 2200 este un joc de strategie în timp real, într-un viitor pustiit.

- Construiești generatoare pe sondele de petrol, fabrici și laboratoare.
- În laboratoare cercetezi 100 de tehnologii: tunuri, rachete, lasere, artilerie și apărare antiaeriană.
- În atelierul de proiectare îți faci propriile tancuri: alegi șasiul, propulsia și arma.
- Dai ordine unităților: patrulare, retragere la reparat, țintire liberă sau ținerea poziției.
- Ataci inelele de forturi inamice până la cetatea din centrul hărții.
- Ai 4 mărimi de hartă și generator de hărți noi.
- Poți juca cooperativ cu până la 4 prieteni, prin codul camerei.
- Fără reclame și fără cont.

### Full description (EN)

Ironfall 2200 is a real-time strategy game set in a ruined future.

- Build generators on oil wells, factories and research labs.
- Research 100 technologies: cannons, rockets, lasers, artillery and anti-air defences.
- Design your own vehicles in the designer: chassis, propulsion and weapon.
- Command your units with patrol, retreat-to-repair, fire-at-will and hold-position orders.
- Break through the rings of enemy forts to reach the central citadel.
- Choose from four map sizes or generate new maps.
- Play co-op with up to 4 friends using a room code.
- No ads, no account.

### Grafică (în dosarul `play-store/`)

- Pictogramă 512×512: `icon-512.png`
- Imagine prezentare 1024×500: `feature-graphic-1024x500.png`
- Capturi de ecran pentru telefon: `screenshot-1-menu.png` … `screenshot-4-citadel.png` (1920×1080)

## 4. Formulare din App content

- **Ads:** Nu conține reclame.
- **App access:** Toate funcțiile sunt disponibile fără restricții.
- **Target audience:** 13+ sau 16+. Dacă alegi sub 13 ani, se aplică regulile pentru copii.
- **Content rating (IARC):** Joc de strategie.
  - Violență: da, violență fantastică sau nerealistă între vehicule, fără sânge și fără oameni vizibili.
  - Fără conținut sexual, limbaj vulgar, droguri sau jocuri de noroc.
  - Interacțiune între utilizatori: da. În camera multiplayer există un chat text scurt înainte de luptă, de maximum 120 de caractere pe mesaj, doar între jucătorii cu același cod de cameră.
- **Data safety:**
  - Colectează date? Da, doar pentru multiplayer:
    - numele de comandant (Personal info → Name, opțional);
    - mesajele din chatul camerei (Messages → Other in-app messages);
    - datele din joc (App activity → Other actions).
  - Datele nu sunt partajate cu terți.
  - Sunt criptate în tranzit (HTTPS).
  - Se șterg automat după 3 ore.
  - Utilizatorul nu poate cere ștergerea, pentru că datele nu sunt legate de un cont.
- **Government app:** Nu.
- **Financial features:** Nu.
- **Health:** Nu.

## 5. Testare obligatorie (conturi personale noi)

Conturile personale de dezvoltator create după noiembrie 2023 trebuie să facă un **test închis**:

- cu cel puțin **12 testeri**;
- timp de **14 zile la rând**;
- abia apoi poți cere acces la Production.

Pași:

1. Mergi la **Testing → Closed testing → Create track**.
2. Urcă `Ironfall2200.aab`.
3. Adaugă e-mailurile testerilor.

## 6. Drepturi de autor – verificat

- Numele „Ironfall 2200”, modelele 3D, pictogramele și sunetele sunt create în cod, pentru acest joc.
- Nu se folosesc nume, logo-uri sau grafică din alte jocuri sau mărci.
- Singura bibliotecă externă este three.js (licență MIT). Licența ei este inclusă în `three-LICENSE.txt`.
