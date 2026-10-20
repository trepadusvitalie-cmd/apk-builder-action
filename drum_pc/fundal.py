"""Fundalul hărților: dale OpenStreetMap, Google (Map Tiles API, cu cheia ta) și satelit Esri.

Google se afișează doar prin serviciul oficial (Map Tiles API): trebuie o cheie API Google cu „Map Tiles API”
pornit. Cheia se păstrează criptată cu contul de Windows (DPAPI) în %APPDATA%\\DrumRM\\google.bin."""
import json, math, os, re, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import cv2

UA = {"User-Agent": "DrumRM-PC/1.0 (analiza filmarilor rutiere)"}
R = 6378137.0
CACHE = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "DrumRM", "dale")
CHEIE = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "DrumRM", "google.bin")

SURSE = {
    "osm": dict(nume="OpenStreetMap", zmax=19, atr="© OpenStreetMap contributors", disc=True,
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"),
    "esri": dict(nume="Satelit Esri", zmax=19, atr="Esri, Maxar, Earthstar Geographics", disc=True,
                 url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"),
    "google_satelit": dict(nume="Google satelit", zmax=20, atr="Google", disc=False, google="satellite"),
    "google_harta": dict(nume="Google hartă", zmax=20, atr="Google", disc=False, google="roadmap"),
}


# ---------------------------------------------------------------- arhiva Esri (Wayback): imaginea satelitară pe ani
WAYBACK = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json"
_wb = []


def wayback_ani():
    """[(an, data, nr. lansare)] – cea mai nouă imagine din fiecare an, de la 2014 încoace (cel mai nou an primul)."""
    if not _wb:
        with urllib.request.urlopen(urllib.request.Request(WAYBACK, headers=UA), timeout=20) as r: cfg = json.loads(r.read().decode())
        lans = []
        for num, it in cfg.items():
            m = re.search(r"(\d{4})-(\d{2})-(\d{2})", it.get("itemTitle", ""))
            if m and "{level}" in it.get("itemURL", ""): lans.append((m.group(0), int(num), it["itemURL"]))
        lans.sort(reverse=True)
        _wb.extend(lans)
    ani = {}
    for d, num, _ in _wb: ani.setdefault(d[:4], (d[:4], d, num))
    return list(ani.values())


def sursa(src):
    """Descrierea sursei; „wayback:<nr>” = imaginea Esri dintr-o anumită lansare (an)."""
    if src.startswith("wayback:"):
        num = int(src.split(":")[1]); d, _, url = next(x for x in _wb if x[1] == num)
        return dict(nume="Satelit Esri – arhivă", zmax=19, disc=True, atr=f"Esri World Imagery Wayback · {d}",
                    url=url.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}"))
    return SURSE[src]


# ---------------------------------------------------------------- cheia Google, criptată cu contul de Windows
def _dpapi(data, protect):
    import ctypes
    from ctypes import wintypes
    class BLOB(ctypes.Structure): _fields_ = [("n", wintypes.DWORD), ("p", ctypes.POINTER(ctypes.c_char))]
    buf = ctypes.create_string_buffer(data, len(data)); i = BLOB(len(data), buf); o = BLOB()
    f = ctypes.windll.crypt32.CryptProtectData if protect else ctypes.windll.crypt32.CryptUnprotectData
    if not f(ctypes.byref(i), None, None, None, None, 0, ctypes.byref(o)): raise OSError("DPAPI")
    r = ctypes.string_at(o.p, o.n); ctypes.windll.kernel32.LocalFree(o.p); return r


_cheie = [None]


def cheie_google():
    if _cheie[0] is None and os.name == "nt" and os.path.exists(CHEIE):
        try: _cheie[0] = _dpapi(open(CHEIE, "rb").read(), False).decode()
        except Exception: pass
    return _cheie[0]


def seteaza_cheie_google(k, tine_minte):
    _cheie[0] = k; _sesiuni.clear()
    if tine_minte and os.name == "nt":
        os.makedirs(os.path.dirname(CHEIE), exist_ok=True); open(CHEIE, "wb").write(_dpapi(k.encode(), True))
    elif os.path.exists(CHEIE):
        os.remove(CHEIE)


_sesiuni = {}


def _sesiune_google(tip):
    s = _sesiuni.get(tip)
    if s and s[1] > time.time() + 60: return s[0]
    req = urllib.request.Request(f"https://tile.googleapis.com/v1/createSession?key={cheie_google()}", method="POST",
                                 data=json.dumps({"mapType": tip, "language": "ro-RO", "region": "MD"}).encode(),
                                 headers={"Content-Type": "application/json", **UA})
    with urllib.request.urlopen(req, timeout=20) as r: m = json.loads(r.read().decode())
    _sesiuni[tip] = (m["session"], float(m.get("expiry", time.time() + 3600))); return m["session"]


# ---------------------------------------------------------------- dale
def rez(z): return 2 * math.pi * R / 256 / 2 ** z          # metri (Web Mercator) pe pixel la nivelul z


class Dale:
    """Descarcă dalele în fundal (4 fire), le ține în memorie; OSM/Esri și pe disc."""

    def __init__(self, gata):
        self.gata = gata; self.mem = {}; self.cerute = set(); self.erori = {}
        self.pool = ThreadPoolExecutor(4); self.lock = threading.Lock()

    def ia(self, src, z, x, y):
        k = (src, z, x, y)
        if k in self.mem: return self.mem[k]
        with self.lock:
            if k in self.cerute: return None
            self.cerute.add(k)
        self.pool.submit(self._descarca, k); return None

    def _descarca(self, k):
        src, z, x, y = k; S = sursa(src)
        p = os.path.join(CACHE, src.replace(":", "_"), str(z), str(x), f"{y}.png")
        try:
            if S["disc"] and os.path.exists(p): data = open(p, "rb").read()
            else:
                if "google" in S:
                    if not cheie_google(): raise RuntimeError("fără cheie Google")
                    url = f"https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={_sesiune_google(S['google'])}&key={cheie_google()}"
                else:
                    url = S["url"].format(z=z, x=x, y=y)
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r: data = r.read()
                if S["disc"]:
                    os.makedirs(os.path.dirname(p), exist_ok=True); open(p, "wb").write(data)
            img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if img is None: raise RuntimeError("dală invalidă")
            self.mem[k] = img; self.erori.pop(src, None)
        except Exception as e:
            self.erori[src] = str(e)                         # nu se mai cere în bucla asta (fără internet = fără repetări)
        self.gata(src)
