# Scrisoare de predare – aplicația GIS Teren (versiune HTML)

Copiază acest fișier în chatul nou, ca primul mesaj. Conține tot contextul necesar.

## Cine sunt și ce vreau
- Lucrez de pe telefon (POCO X3 Pro, MIUI, Chrome). Nu am PC cu Android Studio.
- Vreau aplicația **GIS Teren** ca **aplicație HTML** (un singur fișier `index.html` sau PWA). Trebuie să o pot deschide direct în Chrome pe telefon și să meargă offline, fără build Android.
- Răspunde în română, scurt, cu pași simpli pentru telefon.

## Ce e GIS Teren
Este o aplicație de teren pentru rețele de comunicații. Există deja o versiune Android nativă (Kotlin, MapLibre) în `GisTeren.zip`, care nu a fost compilată niciodată. Versiunea HTML trebuie să păstreze aceleași funcții, cât permite browserul.

### Funcții de păstrat
- **Hartă** (MapLibre GL JS sau Leaflet) cu fundal OSM, satelit Esri și OpenTopoMap.
- **Proiecție Web Mercator (EPSG:3857).** Coordonatele afișate și exportate sunt X/Y 3857.
- **Straturi locale editabile**: punct, linie, poligon, cu snapping, editare de vârfuri, atribute și poze (din cameră sau galerie).
- **Straturi de pe server**: WMS (imagine), WFS și GeoJSON din URL, salvate local pentru lucru offline.
- **Import**: Shapefile (.shp+.dbf+.prj sau .zip), GeoJSON, KML/KMZ, CSV cu X/Y.
- **Export**: GeoJSON 3857, GeoJSON 4326, CSV cu X/Y Mercator, KML.
- **Măsurare**: lungime, arie și perimetru în metri reali (geodezici, nu metri Mercator).
- **Apăsare lungă pe hartă**: arată X/Y 3857, cu buton de copiere.
- **Date**: păstrate în browser (IndexedDB), cu Export pentru copie de siguranță.

### GNSS (de clarificat în chatul nou)
În Android, aplicația se conectează la un receptor **South prin Bluetooth clasic (SPP)**, citește NMEA (GGA, GST) și trimite corecții **NTRIP** (RTK FIX/FLOAT, mediere, „doar RTK FIX”, înălțime jalon).

Limitare importantă pentru HTML: Chrome **nu poate** accesa Bluetooth clasic (SPP), iar NTRIP (TCP brut) nu merge direct din browser. Variante posibile:
1. Folosesc GPS-ul telefonului (`navigator.geolocation`), fără RTK.
2. Activez „mock location” cu o aplicație separată (de ex. *Bluetooth GNSS* sau *Lefebure NTRIP Client*), care face receptor + NTRIP. Pagina HTML citește apoi poziția RTK prin `geolocation`.
3. Web Bluetooth (BLE), doar dacă receptorul suportă BLE.

Recomandarea mea: varianta 2, cu bara de sus colorată după precizie (verde ≈ FIX, portocaliu ≈ FLOAT).

## Ce s-a întâmplat până acum (pe scurt)
- Repo-ul GitHub `trepadusvitalie-cmd/apk-builder-action` are workflow-ul **Build Android APK**, care compilează APK din orice repo Git public.
- Am obținut un APK din proiectul **Esri data-collection-android** (alt proiect, nu GisTeren).
- GisTeren nu a fost compilat. Claude nu a putut face push în repo (eroare 403), iar fișierul `.github/workflows/build-zip-apk.yaml` de pe `main` a rămas gol.

## Ce cer în chatul nou
1. Fă-mi GIS Teren ca **un singur fișier `index.html`**, cu bibliotecile încărcate de pe CDN și date în IndexedDB.
2. Interfața trebuie să fie potrivită pentru telefon: butoane mari și meniu lateral.
3. Dă-mi fișierul gata de descărcat și spune-mi cum îl deschid pe telefon.
4. Opțional: îl fac PWA (manifest + service worker), ca să-l pot instala pe ecranul principal și să meargă offline.
