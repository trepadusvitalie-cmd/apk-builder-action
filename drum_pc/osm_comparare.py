"""Comparația cu OpenStreetMap: drumurile, copacii și indicatoarele din OSM de lângă traseu (Overpass).

- copacii găsiți pe carosabil (după axa drumului din OSM și lățimea lui) se mută la marginea drumului,
  pe partea unde au fost văzuți; pe carosabil pot rămâne doar indicatoarele și gropile;
- fiecare obiect primește „OSM”: există deja în OSM sau e nou;
- obiectele din OSM de lângă traseu pe care filmarea nu le-a găsit ies în stratul OSM_nedetectate;
- fiecare obiect primește legăturile Google Maps / Street View, pentru verificare cu ochiul.
Fără internet analiza merge mai departe, doar fără comparație."""
import json, math, os, urllib.parse, urllib.request
import numpy as np

SERVERE = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
# lățimea tipică a carosabilului (m) când OSM nu are width/lanes
LATIME = {"motorway": 11, "trunk": 9, "primary": 8, "secondary": 7, "tertiary": 6.5, "unclassified": 5.5,
          "residential": 5.5, "living_street": 5, "service": 4, "track": 3, "road": 6}
TOLERANTA = {"copac": 5.0, "semn": 8.0}       # cât de departe poate fi același obiect în OSM
MARGINE = 0.8                                  # un copac mutat stă la atâția metri de marginea carosabilului
SEMNE_HW = ("stop", "give_way", "traffic_signals", "crossing", "speed_camera")


def _puncte_traseu(lon, lat, E, N, pas=40.0):
    out, last = [], None
    for i in range(len(E)):
        if last is None or math.hypot(E[i] - E[last], N[i] - N[last]) >= pas or i == len(E) - 1:
            out.append((lat[i], lon[i])); last = i
    return out


def descarca(lon, lat, E, N, log=print, cache=None, oprit=None):
    """Datele OSM din jurul traseului; None dacă nu e internet."""
    if cache and os.path.exists(cache): return json.load(open(cache, encoding="utf-8"))
    pts = _puncte_traseu(lon, lat, E, N)
    parts = []
    for k in range(0, len(pts), 150):                 # trasee lungi: pe bucăți
        c = ",".join(f"{a:.6f},{b:.6f}" for a, b in pts[max(0, k - 1):k + 150])
        parts.append(f"""node(around:40,{c})["natural"="tree"];node(around:40,{c})["traffic_sign"];
node(around:40,{c})["highway"~"^({'|'.join(SEMNE_HW)})$"];way(around:30,{c})["highway"];""")
    q = "[out:json][timeout:120];(" + "".join(parts) + ");out tags geom;"
    for url in SERVERE:
        if oprit and oprit(): raise RuntimeError("oprit de utilizator")
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(),
                                         headers={"User-Agent": "DrumRM-PC/1.0"})
            with urllib.request.urlopen(req, timeout=45) as r: data = json.loads(r.read().decode("utf-8"))
            if cache: json.dump(data, open(cache, "w", encoding="utf-8"))
            return data
        except Exception as e:
            log(f"OSM: {urllib.parse.urlparse(url).netloc} nu răspunde ({e})")
    return None


def _latime(tags):
    try: return float(str(tags.get("width", "")).replace(",", ".").split()[0])
    except (ValueError, IndexError): pass
    try: return int(tags["lanes"]) * 3.25
    except (KeyError, ValueError): pass
    return LATIME.get(tags.get("highway"))


def _cel_mai_apropiat(px, py, lines):
    """(distanța, piciorul perpendicularei, jumătatea de lățime) pe cel mai apropiat segment de drum."""
    best = (1e9, None, 0.0)
    for xy, half in lines:
        a = xy[:-1]; d = xy[1:] - a
        L = (d ** 2).sum(1); L[L == 0] = 1e-9
        t = np.clip(((px - a[:, 0]) * d[:, 0] + (py - a[:, 1]) * d[:, 1]) / L, 0, 1)
        f = a + d * t[:, None]; dist = np.hypot(px - f[:, 0], py - f[:, 1]); i = int(dist.argmin())
        if dist[i] < best[0]: best = (float(dist[i]), f[i], half)
    return best


def drumuri(data, to_m):
    """Axele drumurilor din OSM (metri) cu jumătatea lățimii carosabilului."""
    lines = []
    for el in (data or {}).get("elements", []):
        if el["type"] == "way" and "geometry" in el:
            w = _latime(el.get("tags", {}))
            if w is None: continue                    # trotuare, poteci, piste de biciclete
            g = el["geometry"]; x, y = to_m.transform([p["lon"] for p in g], [p["lat"] for p in g])
            if len(g) > 1: lines.append((np.column_stack([x, y]), w / 2))
    return lines


def _fata_de_traseu(px, py, tr):
    """(distanța, piciorul perpendicularei, +1 = la stânga mersului / -1 = la dreapta) față de traseul mașinii."""
    a = tr[:-1]; d = tr[1:] - a
    L = (d ** 2).sum(1); L[L == 0] = 1e-9
    t = np.clip(((px - a[:, 0]) * d[:, 0] + (py - a[:, 1]) * d[:, 1]) / L, 0, 1)
    f = a + d * t[:, None]; dist = np.hypot(px - f[:, 0], py - f[:, 1]); i = int(dist.argmin())
    cr = d[i, 0] * (py - f[i, 1]) - d[i, 1] * (px - f[i, 0])
    return float(dist[i]), f[i], (1 if cr > 0 else -1)


# fără drumul în OSM: mașina merge pe banda din dreapta a unui drum cu 2 benzi (3.5 m fiecare) –
# marginea din dreapta e la ~1.75 m de mașină, cea din stânga la ~5.25 m
MARGINE_DREAPTA, MARGINE_STANGA = 1.75, 5.25
LIPSA_MAX = 20.0


def compara(objs, data, to_m, track_xy, log=print):
    """objs (E, N, kind) se modifică pe loc; întoarce lista obiectelor OSM nedetectate."""
    for o in objs:
        o["osm"], o["osm_id"], o["osm_dist"] = "—", "", None
    if not data: return []
    lines, osm = drumuri(data, to_m), []
    for el in data.get("elements", []):
        tg = el.get("tags", {})
        if el["type"] == "node":
            kind = "copac" if tg.get("natural") == "tree" else "semn"
            x, y = to_m.transform(el["lon"], el["lat"])
            osm.append(dict(kind=kind, id=el["id"], E=x, N=y, lon=el["lon"], lat=el["lat"],
                            tags=";".join(f"{k}={v}" for k, v in tg.items())[:250], folosit=False))

    # 1) copacii nu pot sta pe carosabil
    mutati = 0
    tr = np.asarray(track_xy, float)
    for o in objs:
        if o["kind"] != "copac": continue
        d, foot, half = _cel_mai_apropiat(o["E"], o["N"], lines) if lines else (1e9, None, 0)
        if foot is None or d > 15:                   # fără drum OSM aproape: după traseul mașinii și partea drumului
            if len(tr) < 2: continue
            d, foot, parte = _fata_de_traseu(o["E"], o["N"], tr)
            half = MARGINE_STANGA if parte > 0 else MARGINE_DREAPTA
        if foot is None or d >= half + 0.3: continue
        v = np.array([o["E"] - foot[0], o["N"] - foot[1]])
        if np.linalg.norm(v) < 0.05:                 # chiar pe axă: partea din care a fost văzut copacul
            _, ft, _ = _cel_mai_apropiat(o["E"], o["N"], [(tr, 0)])
            v = np.array([o["E"] - ft[0], o["N"] - ft[1]])
            if np.linalg.norm(v) < 0.05: continue
        v /= np.linalg.norm(v)
        o["E"], o["N"] = float(foot[0] + v[0] * (half + MARGINE)), float(foot[1] + v[1] * (half + MARGINE))
        o["nota"] = (o.get("nota", "") + f" mutat de pe carosabil ({d:.1f} m de axă)").strip(); mutati += 1

    # 2) există în OSM?  (cele mai apropiate perechi întâi)
    perechi = []
    for i, o in enumerate(objs):
        for j, s in enumerate(osm):
            if s["kind"] == o["kind"] and o["kind"] in TOLERANTA:
                dd = math.hypot(o["E"] - s["E"], o["N"] - s["N"])
                if dd <= TOLERANTA[o["kind"]]: perechi.append((dd, i, j))
    luat = set()
    for dd, i, j in sorted(perechi):
        if i in luat or osm[j]["folosit"]: continue
        luat.add(i); osm[j]["folosit"] = True
        objs[i]["osm"], objs[i]["osm_id"], objs[i]["osm_dist"] = "există în OSM", str(osm[j]["id"]), round(dd, 1)
    for i, o in enumerate(objs):
        if o["kind"] in TOLERANTA and i not in luat: o["osm"] = "nou (lipsește din OSM)"
    # „negăsite”: doar ce e la cel mult 20 m de traseu (mai departe – curți, după clădiri – camera nu vede)
    lipsa = [s for s in osm if not s["folosit"] and len(tr) > 1 and _fata_de_traseu(s["E"], s["N"], tr)[0] <= LIPSA_MAX]
    log(f"OSM: {len(lines)} drumuri, {len(osm)} obiecte lângă traseu; {len(luat)} confirmate, "
        f"{sum(o['osm'].startswith('nou') for o in objs)} noi, {len(lipsa)} din OSM negăsite; {mutati} copaci mutați de pe carosabil")
    return lipsa


def google(lat, lon):
    """Legături de verificare (se deschid în browser; nu se descarcă nimic de la Google)."""
    return (f"https://www.google.com/maps/search/?api=1&query={lat:.7f},{lon:.7f}",
            f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat:.7f},{lon:.7f}")
