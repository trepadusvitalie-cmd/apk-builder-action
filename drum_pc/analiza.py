"""Drum RM – analiza filmărilor pe calculator.

Intrare: arhivele .zip descărcate de pe portal (sau copiate din telefon), fiecare cu
    video.mp4      filmarea
    traseu.csv     o linie pe poziție: t_ms,lon,lat,acc,speed,bearing,ux,uy,uz
                   (t_ms = timpul în filmare; ux,uy,uz = vectorul „sus” în coordonatele imaginii: X dreapta, Y sus, Z spre privitor)
    info.json      {"camH": 1.3, "hfov": 66, "yaw": 0, "start": "2026-10-19T10:00:00"}

Ieșire, în rezultat/<numele arhivei>/:
    Drum.gdb       File Geodatabase (MOLDREF99): Copaci, Gropi, Indicatoare, Traseu – cu pozele ca atașamente
    poze/          aceleași poze ca fișiere (câmpul „Poza” din GDB arată spre ele)
    Drum.qgs       proiect QGIS: click pe punct = poza; fundal OSM și imagine satelitară
    osm.json       datele OpenStreetMap folosite la comparație

Cum lucrează: fiecare cadru (la ~1 m de drum) trece prin modelul de detectare; același obiect e urmărit
din cadru în cadru; poziția copacilor și a indicatoarelor iese prin triangulare (direcțiile spre obiect din
mai multe locuri ale mașinii se intersectează), a gropilor din proiecția pe sol a cadrelor celor mai apropiate.
"""
import csv, json, math, os, shutil, sys, time, uuid, zipfile, glob, datetime
import numpy as np
import cv2

AICI = os.path.dirname(os.path.abspath(__file__))
KINDS = {"groapa": "Gropi", "copac": "Copaci", "semn": "Indicatoare"}
PRAG = {"groapa": 0.35, "copac": 0.25, "semn": 0.40}
PAS_M = 1.0              # se analizează un cadru la fiecare ~1 m parcurs
MIN_OBS = 3              # un obiect trebuie văzut în cel puțin 3 cadre
UNIRE = {"groapa": 2.0, "copac": 1.8, "semn": 4.0}
SIGN_W = 0.7


_logf = [print]


def log(*a):
    _logf[0](" ".join(str(x) for x in a))


# ---------------------------------------------------------------- model
class Model:
    """Detectorul: .pt (ultralytics, pe placa video dacă există), .onnx sau .tflite.
    Se dă un folder (se alege singur: .pt > .onnx > .tflite) sau chiar fișierul modelului."""

    def __init__(self, folder):
        if os.path.isfile(folder):                          # modelul ales în fereastră
            f = folder; folder = os.path.dirname(f); ext = os.path.splitext(f)[1].lower()
            pts, onx, tfl = ([f] if ext == ".pt" else []), ([f] if ext == ".onnx" else []), ([f] if ext == ".tflite" else [])
            lab = os.path.splitext(f)[0] + ".labels.txt"
            if not os.path.exists(lab): lab = os.path.join(folder, "labels.txt")
            if pts:
                try:
                    import torch, ultralytics  # noqa: F401
                except ImportError:
                    raise RuntimeError("Modelul .pt cere PyTorch – merge doar în varianta cu ANALIZEAZA.bat. "
                                     "Pentru Drum_Analiza.exe alege un model .onnx.")
        else:
            pts = sorted(glob.glob(os.path.join(folder, "*.pt")))
            onx = sorted(glob.glob(os.path.join(folder, "*.onnx")))
            tfl = sorted(glob.glob(os.path.join(folder, "*.tflite")))
            lab = os.path.join(folder, "labels.txt")
        self.names = [l.strip() for l in open(lab, encoding="utf-8") if l.strip()] if os.path.exists(lab) else ["groapa", "copac", "semn"]
        if pts:
            try:
                from ultralytics import YOLO
                import torch
            except ImportError:
                pts = []
        if pts:
            self.dev = 0 if torch.cuda.is_available() else "cpu"
            self.yolo = YOLO(pts[-1]); self.kind = "pt"
            self.names = [self.yolo.names[i] for i in sorted(self.yolo.names)]
            log(f"Model: {os.path.basename(pts[-1])} pe {'placa video' if self.dev == 0 else 'procesor'}")
        elif onx:
            import onnxruntime as ort
            self.sess = ort.InferenceSession(onx[-1], providers=["CPUExecutionProvider"])
            i = self.sess.get_inputs()[0]; self.iname = i.name
            self.nchw = i.shape[1] == 3; self.S = int(i.shape[2] if self.nchw else i.shape[1]); self.kind = "onnx"
            log(f"Model: {os.path.basename(onx[-1])} (procesor)")
        elif tfl:
            try:
                from ai_edge_litert.interpreter import Interpreter
            except ImportError:
                import tensorflow as tf
                Interpreter = tf.lite.Interpreter
            self.it = Interpreter(tfl[-1], num_threads=os.cpu_count() or 4); self.it.allocate_tensors()
            self.inp = self.it.get_input_details()[0]; self.out = self.it.get_output_details()[0]
            self.nchw = self.inp["shape"][1] == 3
            self.S = int(self.inp["shape"][2] if self.nchw else self.inp["shape"][1]); self.kind = "tflite"
            log(f"Model: {os.path.basename(tfl[-1])} (procesor)")
        else:
            raise SystemExit("Nu e niciun model în folderul model/ (drum.pt, drum_v1.onnx sau drum_v1.tflite).")

    def __call__(self, img):
        """img BGR -> listă (x0,y0,x1,y1,scor,clasa)"""
        if self.kind == "pt":
            r = self.yolo.predict(img, imgsz=640, conf=min(PRAG.values()), device=self.dev, verbose=False)[0]
            out = []
            for b, s, c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy(), r.boxes.cls.cpu().numpy()):
                out.append((*map(float, b), float(s), self.names[int(c)]))
            return out
        H, W = img.shape[:2]; S = self.S; s = S / max(W, H); w, h = round(W * s), round(H * s)
        c = np.full((S, S, 3), 114, np.uint8); c[(S - h) // 2:(S - h) // 2 + h, (S - w) // 2:(S - w) // 2 + w] = cv2.resize(img, (w, h))
        x = cv2.cvtColor(c, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        x = x.transpose(2, 0, 1)[None] if self.nchw else x[None]
        if self.kind == "onnx": o = self.sess.run(None, {self.iname: x})[0][0]
        else: self.it.set_tensor(self.inp["index"], x); self.it.invoke(); o = self.it.get_tensor(self.out["index"])[0]
        if o.shape[0] > o.shape[1]: o = o.T
        if o[:4].max() <= 2: o = o.copy(); o[:4] *= S
        res = []
        sc = o[4:]; best = sc.max(0); cls = sc.argmax(0)
        for i in np.argsort(-best):
            if best[i] < min(PRAG.values()): break
            cx, cy, bw, bh = o[:4, i]
            b = ((cx - bw / 2 - (S - w) / 2) / s, (cy - bh / 2 - (S - h) / 2) / s, (cx + bw / 2 - (S - w) / 2) / s, (cy + bh / 2 - (S - h) / 2) / s)
            k = self.names[int(cls[i])]
            if all(not (kk == k and iou(b, bb) > 0.45) for *bb, _, kk in res): res.append((*map(float, b), float(best[i]), k))
        return res


def iou(a, b):
    l, t, r, bo = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    i = max(0, r - l) * max(0, bo - t)
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)


def tip(label):
    l = label.lower()
    if l.startswith("groap") or "pothole" in l: return "groapa"
    if l.startswith("semn") or "sign" in l: return "semn"
    return "copac"


# ---------------------------------------------------------------- traseul
class Traseu:
    """Pozițiile din traseu.csv, în MOLDREF99 (metri), interpolate la orice moment al filmării."""

    def __init__(self, path, to_m):
        rows = []
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try: rows.append({k: float(v) for k, v in r.items() if v not in ("", None)})
                except ValueError: pass
        rows.sort(key=lambda r: r["t_ms"])
        if len(rows) < 2: raise ValueError("traseu.csv are prea puține poziții")
        self.t = np.array([r["t_ms"] for r in rows])
        self.lon = np.array([r["lon"] for r in rows]); self.lat = np.array([r["lat"] for r in rows])
        E, N = to_m.transform(self.lon, self.lat); self.E = np.array(E); self.N = np.array(N)
        self.up = np.array([[r.get("ux", 0.0), r.get("uy", 1.0), r.get("uz", 0.0)] for r in rows])
        self.acc = np.array([r.get("acc", np.nan) for r in rows]); self.speed = np.array([r.get("speed", np.nan) for r in rows])
        # direcția de mers din poziții (±8 m), mai sigură decât cea din GPS la viteză mică
        d = np.concatenate([[0], np.cumsum(np.hypot(np.diff(self.E), np.diff(self.N)))])
        self.d = d
        self.br = np.full(len(rows), np.nan)
        for i in range(len(rows)):
            a = np.searchsorted(d, d[i] - 8); b = min(len(d) - 1, np.searchsorted(d, d[i] + 8))
            if d[b] - d[a] > 4: self.br[i] = math.atan2(self.E[b] - self.E[a], self.N[b] - self.N[a])
        ok = ~np.isnan(self.br)
        if ok.any():
            idx = np.arange(len(rows)); self.br = np.interp(idx, idx[ok], np.unwrap(self.br[ok]))

    def gps(self, t):
        """(precizia m, viteza km/h, lat, lon) la momentul t; viteza din GPS sau, dacă lipsește, din poziții."""
        i = int(np.clip(np.searchsorted(self.t, t), 0, len(self.t) - 1))
        v = self.speed[i] * 3.6 if not np.isnan(self.speed[i]) else None
        if v is None:
            a, b = max(0, i - 3), min(len(self.t) - 1, i + 3)
            if self.t[b] > self.t[a]: v = (self.d[b] - self.d[a]) / (self.t[b] - self.t[a]) * 3600.0
        acc = None if np.isnan(self.acc[i]) else float(self.acc[i])
        return acc, v, float(np.interp(t, self.t, self.lat)), float(np.interp(t, self.t, self.lon))

    def at(self, t):
        E = float(np.interp(t, self.t, self.E)); N = float(np.interp(t, self.t, self.N))
        br = float(np.interp(t, self.t, self.br)); dist = float(np.interp(t, self.t, self.d))
        i = int(np.clip(np.searchsorted(self.t, t), 0, len(self.t) - 1))
        u = self.up[i]; n = np.linalg.norm(u)
        return E, N, br, dist, (u / n if n > 0.5 else None)


def ground(u, v, w, h, up, f, camH):
    """Pixelul (u,v) pe sol: (înainte, dreapta) în metri față de cameră; None = deasupra orizontului."""
    rx = (u - w / 2.0) / f; ry = -(v - h / 2.0) / f; rz = -1.0
    ru = rx * up[0] + ry * up[1] + rz * up[2]
    if ru > -0.02: return None
    fx, fy, fz = up[0] * up[2], up[1] * up[2], -1.0 + up[2] * up[2]
    fn = math.sqrt(fx * fx + fy * fy + fz * fz); fx /= fn; fy /= fn; fz /= fn
    qx, qy, qz = 1.0 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]
    d = qx * fx + qy * fy + qz * fz; qx -= d * fx; qy -= d * fy; qz -= d * fz
    qn = math.sqrt(qx * qx + qy * qy + qz * qz); qx /= qn; qy /= qn; qz /= qn
    t = camH / -ru
    return t * (rx * fx + ry * fy + rz * fz), t * (rx * qx + ry * qy + rz * qz)


NUME = {"copac": "Copac", "groapa": "Groapa", "semn": "Indicator"}
CUL_BGR = {"copac": (60, 170, 60), "groapa": (50, 50, 230), "semn": (220, 120, 40)}


def chenare(img, items):
    """Cadrul cu chenarele detectate: (box, tip, scor, nr. urmă) – umplere transparentă, ramă, etichetă colorată."""
    vis = img.copy(); H, W = img.shape[:2]; th = max(2, W // 300); fs = max(0.55, W / 1000)
    over = vis.copy()
    items = [(b, k, sc, tid, (CUL_BGR[k] if ok else (150, 150, 150)), (NUME[k] if ok else "Panou?")) for b, k, sc, tid, *r in items
             for ok in [r[0] if r else True]]
    for (x0, y0, x1, y1), k, sc, tid, c, nm in items:
        cv2.rectangle(over, (int(x0), int(y0)), (int(x1), int(y1)), c, -1)
    vis = cv2.addWeighted(over, 0.18, vis, 0.82, 0)
    for (x0, y0, x1, y1), k, sc, tid, c, nm in items:
        x0, y0, x1, y1 = map(int, (x0, y0, x1, y1))
        cv2.rectangle(vis, (x0, y0), (x1, y1), c, th)
        L = max(8, (x1 - x0) // 5)                                   # colțuri accentuate
        for (px, py, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
            cv2.line(vis, (px, py), (px + dx * L, py), (255, 255, 255), th + 1); cv2.line(vis, (px, py), (px, py + dy * L), (255, 255, 255), th + 1)
        t = f"{nm}{' ' + str(tid) if tid else ''} {sc * 100:.0f}%"
        (tw, tht), b = cv2.getTextSize(t, cv2.FONT_HERSHEY_SIMPLEX, fs, max(1, th // 2 + 1))
        yy = y0 - 6 if y0 - tht - 12 > 0 else y1 + tht + 12
        cv2.rectangle(vis, (x0, yy - tht - 8), (x0 + tw + 10, yy + b - 2), c, -1)
        cv2.putText(vis, t, (x0 + 5, yy - 4), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), max(1, th // 2 + 1), cv2.LINE_AA)
    return vis


# ---------------------------------------------------------------- doar indicatoarele rutiere
def culori_semn(c):
    """Fracțiile de culori ale chenarului, cu luminozitatea raportată la cea a chenarului (umbră, contre-jour)."""
    h, w = c.shape[:2]; m = int(0.06 * min(h, w)); c = c[m:h - m or h, m:w - m or w]
    c = cv2.resize(c, (64, 64)); hsv = cv2.cvtColor(c, cv2.COLOR_BGR2HSV); H, S, V = [hsv[..., i].astype(float) for i in range(3)]
    Vn = V / max(60.0, np.percentile(V, 95))
    red = ((H < 10) | (H > 165)) & (S > 70) & (Vn > 0.35)
    blue = (H >= 92) & (H <= 132) & (S > 70) & (Vn > 0.25)
    f = lambda x: float(x.mean())
    return dict(red=f(red), blue=f(blue), yel=f((H >= 15) & (H <= 35) & (S > 90) & (Vn > 0.55)), white=f((S < 60) & (Vn > 0.72)),
                dark=f((Vn < 0.38) & ~blue & ~red), brown=f((H >= 8) & (H < 22) & (S > 60) & (Vn < 0.75)),
                green=f((H >= 36) & (H < 90) & (S > 50)))


def culoare_rutiera(c):
    """Are paleta unui semn rutier? roșu (interzicere, avertizare, STOP), albastru (obligare, informare),
    galben (prioritate) sau alb cu text negru (localitate, direcție); nu vegetație, lemn, rugină, fotografii."""
    if c.size == 0: return False
    m = culori_semn(c)
    if m["green"] > 0.18 or m["brown"] > 0.30: return False
    return (m["red"] >= 0.05 or m["blue"] >= 0.25 or m["yel"] >= 0.20 or (m["white"] >= 0.30 and 0.03 <= m["dark"] <= 0.55))


def elevatie(u, v, w, h, up, f):
    """Unghiul (rad) deasupra orizontului al pixelului (u, v)."""
    r = np.array([(u - w / 2.0) / f, -(v - h / 2.0) / f, -1.0])
    return math.asin(float(np.clip(r @ up / np.linalg.norm(r), -1, 1)))


def semn_rutier(t, X, camH):
    """Indicator rutier sau panou / reclamă / altceva? -> (da/nu, motivul). Culoarea în majoritatea cadrelor și,
    unde se poate, geometria: marginea de jos la peste ~0.6 m de sol (stă pe stâlp), mărimea sub ~3 m."""
    col = [o["rutier"] for o in t.obs if "rutier" in o]
    if col and sum(col) * 2 < len(col): return False, "culorile nu sunt de semn rutier"
    jos, sus, lat = [], [], []
    for o in t.obs:
        if o.get("el") is None: continue
        d = math.hypot(X[0] - o["cam"][0], X[1] - o["cam"][1])
        if d < 2: continue
        eb, et, ww = o["el"]
        jos.append(camH + d * math.tan(eb)); sus.append(camH + d * math.tan(et)); lat.append(d * ww)
    if len(jos) >= 2:
        hj, hs, l = float(np.median(jos)), float(np.median(sus)), float(np.median(lat))
        if hj < 0.6: return False, f"stă pe sol (marginea de jos la {hj:.1f} m)"
        if hs - hj > 3.0 or l > 4.0: return False, f"prea mare pentru un semn ({l:.1f} × {hs - hj:.1f} m)"
    return True, ""


# ---------------------------------------------------------------- urmărirea obiectelor
class Track:
    _n = 0

    def __init__(self, kind):
        Track._n += 1; self.id = Track._n; self.kind = kind
        self.obs = []          # dict: frame, box, score, cam(E,N), az, gnd(E,N) sau None, dist
        self.lost = 0

    @property
    def box(self): return self.obs[-1]["box"]


def potrivire(tracks, dets, frame):
    """Detecțiile cadrului la urmele existente (același tip, chenar suprapus sau aproape), cea mai bună pereche întâi."""
    pairs = []
    for i, d in enumerate(dets):
        for t in tracks:
            if t.kind != d["kind"]: continue
            b = t.box; o = iou(b, d["box"])
            # obiectul crește și alunecă spre margine cât ne apropiem: acceptăm și o suprapunere mică
            cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2; dx, dy = (d["box"][0] + d["box"][2]) / 2 - cx, (d["box"][1] + d["box"][3]) / 2 - cy
            near = math.hypot(dx, dy) < 0.6 * max(b[2] - b[0], b[3] - b[1], 20)
            if o > 0.15 or near: pairs.append((o + (0.1 if near else 0), i, t))
    pairs.sort(key=lambda p: -p[0])
    used_d, used_t = set(), set()
    for _, i, t in pairs:
        if i in used_d or t.id in used_t: continue
        t.obs.append(dets[i]); t.lost = 0; used_d.add(i); used_t.add(t.id)
    new = []
    for i, d in enumerate(dets):
        if i not in used_d:
            t = Track(d["kind"]); t.obs.append(d); new.append(t)
    return new


def specie(t):
    """Specia copacului după formă (modelul știe doar „copac”): plopul e o coloană înaltă și îngustă,
    nucul are coroana lată și rotundă. -> (specie sau None, siguranța 0..1)."""
    r = []
    for o in t.obs:
        x0, y0, x1, y1 = o["box"]
        if x0 <= 2 or x1 >= o.get("fw", 1e9) - 2: continue                 # tăiat lateral: lățimea nu e reală
        r.append(((y1 - y0) / max(1.0, x1 - x0), y0 <= 2))
    if len(r) < 2: return None, 0.0
    q = float(np.median([a for a, _ in r])); sus = sum(1 for _, b in r if b)
    if q >= 2.6 or (q >= 2.2 and sus * 2 >= len(r)): return "plop", round(min(1.0, (q - 1.8) / 1.5), 2)
    if q <= 1.35 and sus * 2 < len(r): return "nuc", round(min(0.6, (1.7 - q) / 0.7), 2)   # orice coroană lată: doar „posibil nuc”
    return None, 0.0


def parte_din_masina(t):
    """Obiecte care nu sunt pe drum: stâlpii parbrizului (lipiți de marginea cadrului, înalți), reflexe sau
    lucruri din mașină (nu se mișcă în imagine deși mașina merge), sau văzute doar cu mașina pe loc.
    -> motivul sau None."""
    obs = t.obs
    if len(obs) < 3: return None
    W = obs[0].get("fw", 1); H = obs[0].get("fh", 1)
    lipit = sum(1 for o in obs if (o["box"][0] <= 0.01 * W or o["box"][2] >= 0.99 * W) and o["box"][3] - o["box"][1] >= 0.45 * H)
    lat = [(o["box"][2] - o["box"][0]) / W for o in obs]
    # stâlpul stă lipit de margine și nu-și schimbă lățimea; un copac de lângă drum iese din cadru crescând
    if lipit >= 0.7 * len(obs) and max(lat) - min(lat) < 0.04: return "lipit de marginea cadrului (stâlpul parbrizului)"
    drum = max(math.hypot(o["cam"][0] - obs[0]["cam"][0], o["cam"][1] - obs[0]["cam"][1]) for o in obs)
    if drum < 3 and t.kind != "groapa": return "mașina a stat pe loc – poziția nu se poate calcula"
    cx = [(o["box"][0] + o["box"][2]) / 2 / W for o in obs]; ww = [(o["box"][2] - o["box"][0]) / W for o in obs]
    if drum >= 8 and max(cx) - min(cx) < 0.03 and max(ww) < 1.15 * min(ww) + 0.01:
        return "nu se mișcă în imagine (parte din mașină / reflex)"
    return None


def parte_imagine(t):
    """Partea pe care e obiectul după imagine: +1 = în dreapta cadrului (la dreapta mașinii), -1 = în stânga,
    0 = neclar (drept în față). Camera privește înainte, deci partea din imagine e partea de drum."""
    v = []
    for o in t.obs:
        W = o.get("fw")
        if not W: continue
        c = ((o["box"][0] + o["box"][2]) / 2 - W / 2) / W
        if abs(c) > 0.08: v.append(1 if c > 0 else -1)
    if len(v) < 2: return 0
    m = sum(v) / len(v)
    return 1 if m >= 0.6 else (-1 if m <= -0.6 else 0)


def parte_pozitie(t, X):
    """Partea pe care cade poziția X față de direcția de mers, în majoritatea observațiilor (+1 dreapta, -1 stânga)."""
    # direcția de mers din drumul făcut de mașină cât timp a văzut obiectul (nu din direcția GPS, care poate greși)
    a, b = t.obs[0]["cam"], t.obs[-1]["cam"]
    hm = math.atan2(b[0] - a[0], b[1] - a[1]) if math.hypot(b[0] - a[0], b[1] - a[1]) > 3 else None
    v = []
    for o in t.obs:
        h = hm if hm is not None else o.get("br")
        if h is None or h != h: continue
        dx, dy = X[0] - o["cam"][0], X[1] - o["cam"][1]
        lat = dx * math.cos(h) - dy * math.sin(h); fwd = dx * math.sin(h) + dy * math.cos(h)
        if fwd > 0 and abs(lat) > 0.5: v.append(1 if lat > 0 else -1)
    if not v: return 0
    return 1 if sum(v) > 0 else -1


def oglinda(t, X):
    """Poziția trecută pe cealaltă parte a direcției de mers (față de cea mai apropiată observație)."""
    o = min(t.obs, key=lambda o: math.hypot(X[0] - o["cam"][0], X[1] - o["cam"][1]))
    a, b = t.obs[0]["cam"], t.obs[-1]["cam"]
    h = math.atan2(b[0] - a[0], b[1] - a[1]) if math.hypot(b[0] - a[0], b[1] - a[1]) > 3 else (o.get("br") or 0.0)
    r = np.array([math.cos(h), -math.sin(h)])
    lat = (np.asarray(X) - np.array(o["cam"])) @ r
    return np.asarray(X) - 2 * lat * r


def _rest_triangulare(rays, delta):
    """Cât de prost se intersectează razele (m², ponderat) dacă direcția camerei e corectată cu delta (rad)."""
    A = np.zeros((2, 2)); bb = np.zeros(2); W_ = []
    for o in rays:
        d = np.array([math.sin(o["az"] + delta), math.cos(o["az"] + delta)]); M = np.eye(2) - np.outer(d, d)
        w = 1.0 / (1.0 + (o["dist"] or 20) ** 2 / 100.0); A += w * M; bb += w * M @ np.array(o["cam"]); W_.append((w, d, o))
    if abs(np.linalg.det(A)) < 1e-9: return None
    X = np.linalg.solve(A, bb)
    return sum(w * ((X[0] - o["cam"][0]) * d[1] - (X[1] - o["cam"][1]) * d[0]) ** 2 for w, d, o in W_) / sum(w for w, _, _ in W_)


def estimeaza_yaw(tracks):
    """Unghiul cu care e întors telefonul față de axa mașinii, măsurat din filmare: pentru obiectele fixe văzute
    din multe locuri, razele se intersectează cel mai bine la unghiul corect. -> radiani (0 dacă nu se poate)."""
    bune = []
    for t in tracks:
        rays = [o for o in t.obs if o["az"] is not None and (o["dist"] or 99) <= 40]
        if t.kind == "groapa" or len(rays) < 5: continue
        if math.hypot(rays[-1]["cam"][0] - rays[0]["cam"][0], rays[-1]["cam"][1] - rays[0]["cam"][1]) < 8: continue
        bune.append(rays)
    if len(bune) < 8: return 0.0
    def total(dl):
        r = [_rest_triangulare(rs, dl) for rs in bune]
        r = [x for x in r if x is not None]
        return float(np.median(r)) if r else 1e9
    grid = np.radians(np.arange(-12, 12.01, 0.5))
    vals = [total(dl) for dl in grid]
    i = int(np.argmin(vals)); r0 = total(0.0)
    if abs(grid[i]) >= math.radians(1) and vals[i] < 0.7 * r0: return float(grid[i])
    return 0.0


def pozitie(t):
    """Poziția obiectului (E,N) și metoda; None dacă nu se poate. Poziția trebuie să fie pe partea drumului
    pe care obiectul apare în imagine (razele aproape paralele + eroarea GPS pot muta triangularea pe partea opusă)."""
    ps = parte_imagine(t)
    ok_parte = lambda X: ps == 0 or parte_pozitie(t, X) in (0, ps)
    rays = [o for o in t.obs if o["az"] is not None]
    aproape = [o for o in rays if (o["dist"] or 99) <= 35]
    if len(aproape) >= 3: rays = aproape                        # departe, o eroare mică de direcție mută mult punctul
    Xt = None
    if t.kind != "groapa" and len(rays) >= 3:
        A = np.zeros((2, 2)); bb = np.zeros(2); sw = 0
        for o in rays:
            d = np.array([math.sin(o["az"]), math.cos(o["az"])]); M = np.eye(2) - np.outer(d, d)
            w = 1.0 / (1.0 + (o["dist"] or 20) ** 2 / 100.0); A += w * M; bb += w * M @ np.array(o["cam"]); sw += w
        if np.linalg.det(A) / sw ** 2 > 0.003:
            X = np.linalg.solve(A, bb)
            bad = 0
            for o in rays:
                v = X - np.array(o["cam"]); d = np.array([math.sin(o["az"]), math.cos(o["az"])])
                tt = v @ d
                if tt < 1 or tt > 80 or abs(v[0] * d[1] - v[1] * d[0]) > 3: bad += 1
            if bad * 3 <= len(rays):
                if ok_parte(X): return X, "triangulare"
                Xt = X                                        # pe partea greșită: încercăm proiecția pe sol
    g = [o for o in t.obs if o["gnd"] is not None]
    if g:
        w = np.array([1.0 / (1.0 + o["dist"] ** 2 / 25.0) for o in g])
        P = (np.array([o["gnd"] for o in g]) * w[:, None]).sum(0) / w.sum()
        if ok_parte(P): return P, "proiecție pe sol" + (" (triangularea ieșea pe partea opusă)" if Xt is not None else "")
        if Xt is None: return oglinda(t, P), "proiecție pe sol (trecută pe partea din imagine)"
    if Xt is not None: return oglinda(t, Xt), "triangulare (trecută pe partea din imagine)"
    return None


# ---------------------------------------------------------------- o filmare
def analizeaza(zip_path, model, out_root, progres=None, oprit=None, viz=None, pauza=None, interval=None):
    """progres(fracție 0..1, text); oprit() -> True = utilizatorul a apăsat Oprește;
    viz(eveniment, ...) -> fereastra de vizualizare live (start, cadru, raza, obiect, final);
    pauza() -> True = analiza așteaptă; interval = (de la, până la) în ms din filmare, None = toată."""
    viz = viz or (lambda *a: None)
    import pyproj
    name = os.path.splitext(os.path.basename(zip_path))[0]
    work = os.path.join(out_root, name); tmp = os.path.join(work, "_tmp")
    if os.path.exists(work): shutil.rmtree(work)
    os.makedirs(tmp); os.makedirs(os.path.join(work, "poze"))
    with zipfile.ZipFile(zip_path) as z: z.extractall(tmp)
    vid = next(iter(glob.glob(os.path.join(tmp, "**", "*.mp4"), recursive=True)), None)
    csvp = next(iter(glob.glob(os.path.join(tmp, "**", "traseu.csv"), recursive=True)), None)
    infop = next(iter(glob.glob(os.path.join(tmp, "**", "info.json"), recursive=True)), None)
    if not vid or not csvp: raise ValueError("arhiva nu are video.mp4 și traseu.csv")
    info = json.load(open(infop, encoding="utf-8")) if infop else {}
    camH = float(info.get("camH", 1.3)); hfov = float(info.get("hfov", 66)); yaw = math.radians(float(info.get("yaw", 0)))
    start = info.get("start") or datetime.datetime.fromtimestamp(os.path.getmtime(vid)).isoformat(timespec="seconds")
    t0 = datetime.datetime.fromisoformat(start)

    to_m = pyproj.Transformer.from_crs(4326, 4026, always_xy=True)
    tr = Traseu(csvp, to_m)
    cap = cv2.VideoCapture(vid)
    # telefonul ținut „invers” (landscape pe cealaltă parte): video-ul are doar o mențiune de rotire în fișier;
    # fără ea cadrele ar fi cu susul în jos și stânga/dreapta s-ar inversa (copacii pe partea greșită)
    try:
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
        rot = int(cap.get(cv2.CAP_PROP_ORIENTATION_META) or 0)
        if rot: log(f"Video rotit {rot}° (după cum a fost ținut telefonul) – cadrele se întorc corect")
    except Exception:
        pass
    fps = cap.get(cv2.CAP_PROP_FPS) or 30; nfr = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    log(f"\n=== {name}: {nfr / fps / 60:.1f} min de filmare, {tr.d[-1] / 1000:.2f} km ===")
    # OpenStreetMap de la început: drumurile se văd pe hartă în timpul analizei
    import osm_comparare
    track_line = list(zip(tr.E.tolist(), tr.N.tolist()))
    # harta apare imediat (traseul, punctele GPS); drumurile OSM se adaugă când sosesc
    viz("start", name, track_line, [], nfr * 1000.0 / fps,
        [(float(e), float(n), None if np.isnan(a) else float(a)) for e, n, a in zip(tr.E, tr.N, tr.acc)])
    if progres: progres(0.0, "se descarcă OpenStreetMap din jurul traseului…", None)
    osm = osm_comparare.descarca(tr.lon, tr.lat, tr.E, tr.N, log, cache=os.path.join(work, "osm.json"), oprit=oprit)
    viz("drumuri", [(xy.tolist(), half) for xy, half in osm_comparare.drumuri(osm, to_m)])
    t_viz = 0.0

    active, done = [], []
    last_d = -1e9; fi = -1; t_start = time.time(); nproc = 0
    frames_keep = {}         # cadru -> imagine, doar pentru cele mai bune poze (păstrate pe disc)
    de, pana = interval or (None, None)
    if de:                                                   # sare direct la începutul intervalului ales
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(de / 1000.0 * fps)); fi = int(de / 1000.0 * fps) - 1
    oprit_la = None; tms = 0.0
    while True:
        while pauza and pauza() and not (oprit and oprit()):  # pauză: nu se pierde nimic, se continuă de aici
            time.sleep(0.1)
        if oprit and oprit():                                # Oprește: se salvează ce s-a găsit până aici
            oprit_la = tms; break
        ok = cap.grab(); fi += 1
        if not ok: break
        tms = fi * 1000.0 / fps
        if pana and tms > pana: break
        if tms < tr.t[0] or tms > tr.t[-1]: continue
        E, N, br, dist, up = tr.at(tms)
        if dist - last_d < PAS_M: continue
        vk = tr.gps(tms)[1]
        if vk is not None and vk < 4: continue              # mașina stă: razele ar porni toate din același loc
        last_d = dist
        ok, img = cap.retrieve()
        if not ok: continue
        nproc += 1
        H, W = img.shape[:2]; f = (W / 2.0) / math.tan(math.radians(hfov / 2))
        dets = []
        for x0, y0, x1, y1, s, lab in model(img):
            k = tip(lab)
            if s < PRAG[k]: continue
            if k == "copac" and y1 >= H - 3: continue        # baza nu se vede
            u = (x0 + x1) / 2
            az = br + yaw + math.atan((u - W / 2) / f)
            g = None; dd = None
            if up is not None:
                if k == "semn":
                    dd = f * SIGN_W / max(1.0, x1 - x0); a = math.atan((u - W / 2) / f); fwd, right = dd * math.cos(a), dd * math.sin(a)
                else:
                    gg = ground(u, (y0 + y1) / 2 if k == "groapa" else y1, W, H, up, f, camH)
                    fwd, right = gg if gg else (None, None)
                if fwd is not None:
                    lim = (2, 30) if k == "groapa" else (3, 60)
                    if lim[0] <= fwd <= lim[1]:
                        b2 = br + yaw
                        g = (E + fwd * math.sin(b2) + right * math.cos(b2), N + fwd * math.cos(b2) - right * math.sin(b2))
                        dd = math.hypot(fwd, right)
            dets.append(dict(frame=fi, t=tms, fw=W, fh=H, box=(x0, y0, x1, y1), score=s, kind=k, cam=(E, N), az=az, br=br + yaw, gnd=g,
                             dist=dd if dd else 25.0))
            if k == "semn":                                     # pentru filtrul „doar indicatoare rutiere”
                dets[-1]["rutier"] = culoare_rutiera(img[max(0, int(y0)):int(y1), max(0, int(x0)):int(x1)])
                if up is not None:
                    dets[-1]["el"] = (elevatie(u, y1, W, H, up, f), elevatie(u, y0, W, H, up, f), (x1 - x0) / f)
        for t in active: t.lost += 1
        active += potrivire(active, dets, fi)
        for t in active:                                         # razele noi, pe hartă
            o = t.obs[-1]
            if o["frame"] == fi: viz("raza", t.id, t.kind, fi, o["cam"], o["az"], o["gnd"], o["dist"], tms)
        if time.time() - t_viz > 0.12:                           # cadrul cu chenarele, de ~8 ori pe secundă
            t_viz = time.time()
            noi = {id(t.obs[-1]): t.id for t in active if t.obs[-1]["frame"] == fi}
            viz("cadru", E, N, br, chenare(img, [(d["box"], d["kind"], d["score"], noi.get(id(d)), d.get("rutier", True)) for d in dets]),
                f"cadrul {fi} · {len(dets)} obiecte", tms, tr.gps(tms))
        else:
            viz("cadru", E, N, br, None, "", tms, tr.gps(tms))
        # cadrul se păstrează dacă e cel mai bun chenar al cuiva
        for t in active:
            if t.obs[-1]["frame"] == fi:
                b = t.obs[-1]["box"]; area = (b[2] - b[0]) * (b[3] - b[1])
                if area > getattr(t, "best_area", 0):
                    t.best_area = area; t.best = t.obs[-1]
                    p = os.path.join(tmp, f"f{fi}.jpg")
                    if not os.path.exists(p): cv2.imwrite(p, img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        still = []
        for t in active:
            (done if t.lost > 6 else still).append(t)
            if t.lost > 6 and len(t.obs) >= MIN_OBS and not parte_din_masina(t):   # a ieșit din cadru: apare vectorizat
                p = pozitie(t)
                if p: viz("obiect", t.id, t.kind, float(p[0][0]), float(p[0][1]), p[1], os.path.join(tmp, f"f{t.best['frame']}.jpg"),
                          specie(t)[0] if t.kind == "copac" else None)
        active = still
        if progres and nproc % 5 == 0:
            cnt = {k: 0 for k in KINDS}
            for t in done + active:
                if len(t.obs) >= MIN_OBS: cnt[t.kind] += 1
            progres(0.9 * fi / max(1, nfr), f"cadre analizate: {nproc}", cnt)
        if nproc % 50 == 0:
            el = time.time() - t_start
            log(f"  {fi / max(1, nfr) * 100:5.1f}%  cadre analizate {nproc}, obiecte {len(done) + len(active)}, {nproc / max(el, 1e-3):.1f} cadre/s")
    done += active
    cap.release()
    if oprit_la is not None:
        log(f"Oprit la {int(oprit_la // 60000):02d}:{int(oprit_la % 60000 // 1000):02d} – se salvează rezultatul parțial (până aici).")

    if progres: progres(0.92, "se calculează pozițiile (triangulare)…", None)
    # telefonul întors puțin față de axa mașinii: unghiul se măsoară din filmare și se corectează
    dyaw = estimeaza_yaw([t for t in done if len(t.obs) >= MIN_OBS])
    if dyaw:
        log(f"Corecție direcție cameră: {math.degrees(dyaw):+.1f}° (telefonul era puțin întors; măsurat din filmare)")
        for t in done:
            for o in t.obs:
                if o["az"] is not None: o["az"] += dyaw
                if o.get("br") is not None: o["br"] += dyaw
                if o["gnd"] is not None:                    # proiecția pe sol se rotește în jurul camerei
                    c = o["cam"]; dx, dy = o["gnd"][0] - c[0], o["gnd"][1] - c[1]
                    cs, sn = math.cos(dyaw), math.sin(dyaw)
                    o["gnd"] = (c[0] + dx * cs + dy * sn, c[1] - dx * sn + dy * cs)
    # obiectele: poziție, apoi unirea dublurilor (același obiect pierdut și regăsit)
    objs = []; ignorate = []
    for t in done:
        if len(t.obs) < MIN_OBS: continue
        motiv = parte_din_masina(t)
        if motiv:
            ignorate.append((t.id, motiv)); viz("ignorat", t.id, motiv); continue
        p = pozitie(t)
        if p is None: continue
        X, met = p
        if t.kind == "semn":
            ok, motiv = semn_rutier(t, X, camH)
            if not ok:
                ignorate.append((t.id, motiv)); viz("ignorat", t.id, motiv); continue
        sp, si = specie(t) if t.kind == "copac" else (None, 0.0)
        objs.append(dict(specie=sp, specie_txt=("plop (după formă, {:.0f}%)".format(si * 100) if sp == "plop" else
                                           "posibil nuc (coroană lată, după formă)" if sp == "nuc" else ""), id=t.id, ids={t.id}, kind=t.kind, E=float(X[0]), N=float(X[1]), met=met, n=len(t.obs), score=max(o["score"] for o in t.obs),
                         frames={o["frame"] for o in t.obs}, best=t.best, t=t.best["t"]))
    objs.sort(key=lambda o: -o["n"]); keep = []
    for o in objs:
        dup = next((k for k in keep if k["kind"] == o["kind"] and math.hypot(k["E"] - o["E"], k["N"] - o["N"]) < UNIRE[o["kind"]]
                    and not (k["frames"] & o["frames"])), None)
        if dup: dup["n"] += o["n"]; dup["frames"] |= o["frames"]; dup["ids"] |= o["ids"]
        else: keep.append(o)
    keep.sort(key=lambda o: o["t"])
    if ignorate:
        from collections import Counter
        log(f"Obiecte ignorate: {len(ignorate)} – " + "; ".join(f"{n}× {m}" for m, n in Counter(m for _, m in ignorate).most_common()))
    # OpenStreetMap: copacii scoși de pe carosabil, ce există deja în OSM, ce lipsește
    if progres: progres(0.93, "se compară cu OpenStreetMap…", None)
    if osm is None: log("OSM: fără internet – rezultatul se face fără comparația cu OpenStreetMap.")
    lipsa = osm_comparare.compara(keep, osm, to_m, track_line, log)
    nr = {}
    to_ll = pyproj.Transformer.from_crs(4026, 4326, always_xy=True)
    for o in keep:
        nr[o["kind"]] = nr.get(o["kind"], 0) + 1; o["nr"] = nr[o["kind"]]
        o["lon"], o["lat"] = to_ll.transform(o["E"], o["N"])
        o["google"], o["streetview"] = osm_comparare.google(o["lat"], o["lon"])
        o["data"] = (t0 + datetime.timedelta(milliseconds=o["t"])).strftime("%Y-%m-%d %H:%M:%S")
        # poza: cadrul întreg cu chenarul obiectului
        b = o["best"]; img = cv2.imread(os.path.join(tmp, f"f{b['frame']}.jpg"))
        x0, y0, x1, y1 = map(int, b["box"])
        cv2.rectangle(img, (x0, y0), (x1, y1), (0, 220, 0), 3)
        rel = f"poze/{KINDS[o['kind']]}_{o['nr']:04d}.jpg"
        cv2.imwrite(os.path.join(work, rel), img, [cv2.IMWRITE_JPEG_QUALITY, 85]); o["poza"] = rel
    viz("final", [dict(id=o["id"], ids=o["ids"], kind=o["kind"], E=o["E"], N=o["N"], met=o["met"], nota=o.get("nota", ""),
                       specie=o.get("specie"), specie_txt=o.get("specie_txt"),
                       osm=o.get("osm", ""), foto=os.path.join(work, o["poza"])) for o in keep])
    shutil.rmtree(tmp, ignore_errors=True)

    if progres: progres(0.96, "se scrie Drum.gdb cu pozele…", {k: nr.get(k, 0) for k in KINDS})
    import gdb_scriere
    gdb_scriere.scrie(os.path.join(work, "Drum.gdb"), keep, track_line, work, lipsa)
    import qgis_proiect
    xs = [o["E"] for o in keep] + tr.E.tolist(); ys = [o["N"] for o in keep] + tr.N.tolist()
    qgis_proiect.scrie(os.path.join(work, "Drum.qgs"), (min(xs) - 30, min(ys) - 30, max(xs) + 30, max(ys) + 30))
    json.dump(dict(film=name, start=start, km=round(tr.d[-1] / 1000, 3),
                   partial=None if oprit_la is None else f"oprit la {int(oprit_la // 60000):02d}:{int(oprit_la % 60000 // 1000):02d}",
                   obiecte={KINDS[k]: sum(1 for o in keep if o["kind"] == k) for k in KINDS},
                   osm=None if osm is None else dict(confirmate=sum(o["osm"].startswith("există") for o in keep),
                                                     noi=sum(o["osm"].startswith("nou") for o in keep), negasite=len(lipsa))),
              open(os.path.join(work, "rezumat.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if progres: progres(1.0, "gata", {k: nr.get(k, 0) for k in KINDS})
    log(f"Gata: {', '.join(f'{v} {KINDS[k].lower()}' for k, v in nr.items()) or 'niciun obiect'} -> {work}")
    return work


def main():
    model = Model(os.path.join(date_dir(), "model"))
    zips = [a for a in sys.argv[1:] if a.lower().endswith(".zip")] or sorted(glob.glob(os.path.join(AICI, "filmari", "*.zip")))
    if not zips:
        log("Pune arhivele .zip (descărcate de pe portal) în folderul „filmari” sau trage-le peste ANALIZEAZA.bat.")
        return
    out_root = os.path.join(AICI, "rezultat"); os.makedirs(out_root, exist_ok=True)
    rez = []
    for z in zips:
        try: rez.append(analizeaza(z, model, out_root))
        except Exception as e: log(f"EROARE la {os.path.basename(z)}: {e}")
    if rez and os.name == "nt": os.startfile(rez[-1])


def date_dir():
    """Folderul cu datele programului (model/): lângă .exe sau lângă acest fișier."""
    return getattr(sys, "_MEIPASS", AICI)


if __name__ == "__main__":
    sys.path.insert(0, AICI)
    main()
