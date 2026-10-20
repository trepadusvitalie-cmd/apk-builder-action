"""Trimite rezultatul (Drum.gdb, și după ce l-ai corectat în QGIS/ArcGIS) în „Conținutul meu” de pe portal,
ca strat cu pozele ca atașamente – la fel cum trimit aplicațiile de pe telefon. A doua trimitere a aceluiași
folder actualizează același element (id-ul se ține în portal_id.txt).

Contul: emailul și parola de pe portal se cer o singură dată; pe calculator se păstrează doar sesiunea
(în %APPDATA%\\DrumRM\\sesiune.json), nu parola."""
import base64, datetime, getpass, glob, io, json, os, random, sys, time, urllib.error, urllib.parse, urllib.request, uuid, zipfile
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
URL = "https://kwyxtzrcsgvefzonraxc.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3eXh0enJjc2d2ZWZ6b25yYXhjIiwicm9sZSI6ImFub24iLC"
        "JpYXQiOjE3ODkxMjM2NDcsImV4cCI6MjEwNDY5OTY0N30.05ZBVT6PBMblhzuYtmFwsI2WqggsFdeH7JDvHLC0b-A")
BUCKET = "content-files"
SES = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "DrumRM", "sesiune.json")
STRATURI = ["Copaci", "Gropi", "Indicatoare"]


def http(method, url, headers, body=None):
    req = urllib.request.Request(url, data=body, method=method, headers={"User-Agent": "DrumRM-PC/1.0", **headers})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode("utf-8", "replace")


class Sesiune:
    def __init__(self, login=None):
        """login() -> (email, parolă); implicit se cer în consolă."""
        self.s = json.load(open(SES)) if os.path.exists(SES) else {}
        self.login = login

    def _take(self, code, text):
        m = json.loads(text) if text.startswith("{") else {}
        if code != 200 or "access_token" not in m:
            raise SystemExit("Nu s-a putut intra în cont: " + str(m.get("error_description") or m.get("msg") or text[:200]))
        self.s = dict(access=m["access_token"], refresh=m.get("refresh_token", ""), exp=time.time() + m.get("expires_in", 3600),
                      uid=m.get("user", {}).get("id", ""), email=m.get("user", {}).get("email", ""))
        os.makedirs(os.path.dirname(SES), exist_ok=True); json.dump(self.s, open(SES, "w"))

    def token(self):
        if self.s.get("refresh") and time.time() > self.s.get("exp", 0) - 120:
            c, t = http("POST", f"{URL}/auth/v1/token?grant_type=refresh_token", {"apikey": ANON, "Content-Type": "application/json"},
                        json.dumps({"refresh_token": self.s["refresh"]}).encode())
            if c == 200: self._take(c, t)
            else: self.s = {}
        if not self.s.get("access"):
            if self.login:
                lp = self.login()
                if not lp: raise SystemExit("Trimiterea a fost anulată.")
                mail, pw = lp
            else:
                print("Intră în contul de pe portal (același ca pe site și în aplicații).")
                mail = input("Email: ").strip(); pw = getpass.getpass("Parola (nu se vede când scrii): ")
            c, t = http("POST", f"{URL}/auth/v1/token?grant_type=password", {"apikey": ANON, "Content-Type": "application/json"},
                        json.dumps({"email": mail, "password": pw}).encode())
            self._take(c, t)
        return self.s["access"]

    def h(self, extra=None):
        return {"apikey": ANON, "Authorization": "Bearer " + self.token(), **(extra or {})}


def citeste_gdb(gdb, folder):
    """Punctele din GDB (cu corecturile tale) -> features WGS84 + pozele lor (din atașamente sau din câmpul Poza)."""
    ds = gdal.OpenEx(gdb, gdal.OF_VECTOR)
    wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    feats, poze = [], []
    for name in STRATURI:
        lyr = ds.GetLayerByName(name)
        if lyr is None: continue
        src = lyr.GetSpatialRef(); src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        ct = osr.CoordinateTransformation(src, wgs)
        att = {}
        al = ds.GetLayerByName(name + "__ATTACH")
        if al is not None:
            for a in al:
                if a["DATA"] is not None: att.setdefault(a["REL_GLOBALID"], []).append((a["ATT_NAME"], a.GetFieldAsBinary("DATA")))
        for f in lyr:
            g = f.GetGeometryRef()
            if g is None: continue
            g = g.Clone(); g.Transform(ct)
            props = {}
            for i in range(f.GetFieldCount()):
                k = f.GetFieldDefnRef(i).GetName()
                if k in ("GlobalID", "Poza"): continue
                props[k] = f.GetField(i)
            pics = att.get(f["GlobalID"] if f.GetFieldIndex("GlobalID") >= 0 else None) or []
            if not pics and f.GetFieldIndex("Poza") >= 0 and f["Poza"]:
                p = os.path.join(folder, f["Poza"])
                if os.path.exists(p): pics = [(os.path.basename(p), open(p, "rb").read())]
            if pics:
                props["AttachID"] = len(feats) + 1
                for n, d in pics: poze.append((len(feats) + 1, n, d))
            feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(g.GetX(), 7), round(g.GetY(), 7)]},
                          "properties": props})
    return feats, poze


def zip_atasamente(poze):
    """Arhiva „Add Attachments” (match_table.csv + AttachFiles/) pe care portalul o pune ca atașamente."""
    bio = io.BytesIO(); used = set()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_STORED) as z:
        csv = ["AttachID,Filename"]
        for aid, n, d in poze:
            n = "".join(c if c.isalnum() or c in "._-" else "_" for c in n)
            if n in used: n = f"{aid}_{n}"
            used.add(n); csv.append(f"{aid},{n}"); z.writestr("AttachFiles/" + n, d)
        z.writestr("match_table.csv", "\r\n".join(csv) + "\r\n")
    return bio.getvalue()


def trimite(folder, login=None, log=print):
    gdb = os.path.join(folder, "Drum.gdb")
    if not os.path.isdir(gdb): raise SystemExit(f"Nu găsesc {gdb}")
    feats, poze = citeste_gdb(gdb, folder)
    log(f"{len(feats)} obiecte, {len(poze)} poze -> portal…")
    ses = Sesiune(login); h = ses.h
    idf = os.path.join(folder, "portal_id.txt")
    item_id = int(open(idf).read().strip()) if os.path.exists(idf) else int(time.time() * 1e6) + random.randint(0, 999)
    name = "Drum – " + os.path.basename(os.path.normpath(folder))
    file_url = None
    if poze:
        path = f"{ses.s.get('uid', '')}/{uuid.uuid4().hex}_drum_{item_id}_poze.zip".lstrip("/")
        enc = "/".join(urllib.parse.quote(p) for p in path.split("/"))
        c, t = http("POST", f"{URL}/storage/v1/object/{BUCKET}/{enc}", h({"Content-Type": "application/zip", "x-upsert": "true"}), zip_atasamente(poze))
        if c not in (200, 201): raise SystemExit(f"Poze: HTTP {c} {t[:200]}")
        file_url = f"{URL}/storage/v1/object/public/{BUCKET}/{enc}"
    fc = {"type": "FeatureCollection", "features": feats}
    row = {"id": item_id, "name": name, "size": len(json.dumps(fc)),
           "item_date": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z"), "snapshot_fc": fc, "file_url": file_url,
           "file": "drum.geojson", "description": f"Drum RM – analiza filmării ({len(feats)} obiecte).",
           "published": False, "folder": "Rădăcină", "live": False, "share": "private"}
    hdr = h({"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    c, t = http("POST", f"{URL}/rest/v1/content_items?on_conflict=id", hdr, json.dumps([row]).encode())
    if c not in (200, 201, 204):
        for k in ("live", "share"): row.pop(k)
        c, t = http("POST", f"{URL}/rest/v1/content_items?on_conflict=id", hdr, json.dumps([row]).encode())
    if c not in (200, 201, 204): raise SystemExit(f"Conținut: HTTP {c} {t[:300]}")
    open(idf, "w").write(str(item_id))
    log(f"Gata: „{name}” e în Conținutul meu pe portal (cu poze). Deschide-l pe hartă de acolo.")
    return name


if __name__ == "__main__":
    aici = os.path.dirname(os.path.abspath(__file__))
    args = [a for a in sys.argv[1:] if a.strip()]
    if args:
        p = os.path.abspath(args[0]); folder = os.path.dirname(p) if p.lower().endswith(".gdb") else p
    else:
        cand = sorted(glob.glob(os.path.join(aici, "rezultat", "*", "Drum.gdb")), key=os.path.getmtime)
        if not cand: raise SystemExit("Nu e niciun rezultat în folderul „rezultat”.")
        folder = os.path.dirname(cand[-1])
    trimite(folder)
