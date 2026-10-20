"""Fereastra „Vizualizare live”: două hărți sincronizate (OpenStreetMap și Google/satelit) cu traseul, razele de
triangulare și obiectele vectorizate în timp real, plus cadrul curent din filmare cu chenarele detectate și
minutul din video. Click pe o rază sau pe un obiect (pe oricare hartă) = selecție cu calculele lui.

Analiza (în alt fir) trimite evenimente prin coadă: start, cadru, raza, obiect, final. Coordonatele vin în
MOLDREF99 (EPSG:4026); pe hărți se desenează în Web Mercator, ca să cadă exact peste dale."""
import base64, bisect, math, queue
import tkinter as tk
from tkinter import ttk, simpledialog, messagebox
import numpy as np
import cv2
import pyproj
import fundal
from stil import Buton, FONT, CARD, BG, TEXT, GRI, VERDE, ROSU, ALBASTRU, ANTET

CUL = {"copac": VERDE, "groapa": ROSU, "semn": ALBASTRU}
RAZA = {"copac": "#57c25e", "groapa": "#f07878", "semn": "#6aa6ec"}
NUME = {"copac": "Copac", "groapa": "Groapă", "semn": "Indicator"}
_M = pyproj.Transformer.from_crs(4026, 3857, always_xy=True)


def fundal_log(s):
    import panouri; panouri.scrie_jurnal("Hartă: " + s)


def citeste_timp(t):
    """„7:30”, „07:30”, „1:02:05” sau „450” (secunde) -> ms; None dacă e gol sau greșit."""
    t = (t or "").strip().replace(".", ":").replace(",", ":")
    if not t: return None
    try:
        p = [float(x) for x in t.split(":")]
    except ValueError:
        return None
    s = 0.0
    for x in p: s = s * 60 + x
    return s * 1000.0


def merc(E, N): return _M.transform(E, N)


def mmss(ms):
    s = int(ms / 1000); return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60:02d}:{s % 60:02d}"


def png_tk(img, w, h=None):
    h = h or int(img.shape[0] * w / img.shape[1])
    ok, b = cv2.imencode(".png", cv2.resize(img, (max(1, w), max(1, h)), interpolation=cv2.INTER_AREA))
    return tk.PhotoImage(data=base64.b64encode(b.tobytes()))


def icona(c, x, y, kind, k, tg, specie=None):
    """Desenul obiectului pe canvas, cu baza în (x, y): plop, nuc, copac, groapă sau indicator."""
    its = []
    if kind == "copac" and specie == "plop":                                 # coroană în coloană, înaltă și îngustă
        its.append(c.create_rectangle(x - 1.5 * k, y - 6 * k, x + 1.5 * k, y, fill="#6d4c2f", outline="", tags=tg))
        its.append(c.create_oval(x - 4.5 * k, y - 32 * k, x + 4.5 * k, y - 4 * k, fill="#1f6b2a", outline="#124d1c", width=1, tags=tg))
        its.append(c.create_oval(x - 2.5 * k, y - 29 * k, x + 0.5 * k, y - 18 * k, fill="#43a047", outline="", tags=tg))
    elif kind == "copac" and specie == "nuc":                                # coroană lată și rotundă, trunchi gros
        its.append(c.create_rectangle(x - 2.5 * k, y - 8 * k, x + 2.5 * k, y, fill="#5d4037", outline="", tags=tg))
        its.append(c.create_oval(x - 13 * k, y - 22 * k, x + 13 * k, y - 6 * k, fill="#7c9a2e", outline="#4e6b14", width=1, tags=tg))
        for dx in (-6, 2, 8):
            its.append(c.create_oval(x + (dx - 2.5) * k, y - 17 * k, x + (dx + 2.5) * k, y - 12 * k, fill="#a1887f", outline="#6d4c41", tags=tg))
    elif kind == "copac":
        its.append(c.create_rectangle(x - 1.8 * k, y - 8 * k, x + 1.8 * k, y, fill="#6d4c2f", outline="", tags=tg))
        for dx, dy, rr in ((-5, -11, 5.5), (5, -11, 5.5), (0, -16, 7)):
            its.append(c.create_oval(x + (dx - rr) * k, y + (dy - rr) * k, x + (dx + rr) * k, y + (dy + rr) * k,
                                     fill="#2e8b3a", outline="#1b5e20", width=1, tags=tg))
        its.append(c.create_oval(x - 3 * k, y - 19 * k, x + 1 * k, y - 15 * k, fill="#66bb6a", outline="", tags=tg))
    elif kind == "groapa":
        its.append(c.create_oval(x - 10 * k, y - 6 * k, x + 10 * k, y + 6 * k, fill="#795548", outline="#c62828", width=2, tags=tg))
        its.append(c.create_oval(x - 6 * k, y - 3.5 * k, x + 5 * k, y + 3 * k, fill="#3e2723", outline="", tags=tg))
        its.append(c.create_polygon(x + 6 * k, y - 18 * k, x + 13 * k, y - 6 * k, x - 1 * k, y - 6 * k,
                                    fill="#ffca28", outline="#c62828", width=1.5, tags=tg))
        its.append(c.create_text(x + 6 * k, y - 10 * k, text="!", font=(FONT, max(6, int(7 * k)), "bold"), fill="#b71c1c", tags=tg))
    else:
        its.append(c.create_line(x, y, x, y - 14 * k, fill="#78909c", width=max(2, 2.5 * k), tags=tg))
        its.append(c.create_oval(x - 8 * k, y - 30 * k, x + 8 * k, y - 14 * k, fill="white", outline="#d32f2f", width=3, tags=tg))
        its.append(c.create_text(x, y - 22 * k, text="▲", font=(FONT, max(5, int(6 * k)), "bold"), fill="#1d5fa8", tags=tg))
    its.append(c.create_oval(x - 3, y - 3, x + 3, y + 3, fill="white", outline=CUL[kind], width=2, tags=tg))
    return its


class Harta:
    """O hartă: fundal din dale + vectorii. Transformarea (s, ox, oy) e aceeași pe ambele hărți."""

    def __init__(self, viz, parent, surse, implicit):
        self.v = viz
        f = tk.Frame(parent, bg=CARD, highlightthickness=1, highlightbackground="#dde2e8")
        self.frame = f
        h = tk.Frame(f, bg=CARD); h.pack(fill="x")
        self.chei = {("Satelit Esri – alege anul" if k == "wayback" else fundal.SURSE[k]["nume"]): k for k in surse}
        self.sursa = tk.StringVar(value=next(n for n, k in self.chei.items() if k == implicit))
        cb = ttk.Combobox(h, values=list(self.chei), textvariable=self.sursa, state="readonly", width=22, font=(FONT, 9))
        cb.pack(side="left", padx=8, pady=5); cb.bind("<<ComboboxSelected>>", lambda e: self.schimba())
        # anul imaginii (doar pentru arhiva Esri)
        self.an = tk.StringVar(); self.ani = {}
        self.cb_an = ttk.Combobox(h, textvariable=self.an, state="readonly", width=16, font=(FONT, 9))
        self.cb_an.bind("<<ComboboxSelected>>", lambda e: self.fundal(True))
        self.msg = tk.Label(h, text="", bg=CARD, fg=ROSU, font=(FONT, 8)); self.msg.pack(side="left")
        self.c = tk.Canvas(f, bg="#f4f1ea", highlightthickness=0, cursor="crosshair"); self.c.pack(fill="both", expand=True)
        self.imgs = {}; self.tip_item = {}
        c = self.c
        c.bind("<MouseWheel>", lambda e: viz.zoom(e.x, e.y, 1.25 if e.delta > 0 else 0.8))
        c.bind("<Button-4>", lambda e: viz.zoom(e.x, e.y, 1.25)); c.bind("<Button-5>", lambda e: viz.zoom(e.x, e.y, 0.8))
        c.bind("<ButtonPress-1>", viz.apasa); c.bind("<B1-Motion>", viz.trage)
        c.bind("<ButtonRelease-1>", lambda e: viz.elibereaza(e, self)); c.bind("<Configure>", lambda e: self.fundal())

    @property
    def src(self):
        k = self.chei[self.sursa.get()]
        if k == "wayback": return f"wayback:{self.ani[self.an.get()]}" if self.an.get() in self.ani else "esri"
        return k

    def schimba(self):
        if self.chei[self.sursa.get()] == "wayback":
            self.cb_an.pack(side="left", after=self.msg.master.winfo_children()[0], padx=(0, 8))
            if not self.ani:
                self.msg.config(text="se încarcă lista anilor…", fg=GRI)
                import threading
                threading.Thread(target=self._ani, daemon=True).start(); return
        else:
            self.cb_an.pack_forget()
        self.fundal(True)

    def _ani(self):
        try:
            a = fundal.wayback_ani(); self.v.q.put(("ani", self, a, None))
        except Exception as e:
            self.v.q.put(("ani", self, [], str(e)))

    def ani_gata(self, ani, err):
        self.msg.config(fg=ROSU, text="" if not err else "⚠ lista anilor nu se descarcă (internet / rețea blocată)")
        self.ani = {f"{an}  ({d[8:10]}.{d[5:7]})": num for an, d, num in ani}
        self.cb_an["values"] = list(self.ani)
        if self.ani: self.an.set(next(iter(self.ani)))
        self.fundal(True)

    def xy(self, X, Y): v = self.v; return (X - v.X0) * v.s + v.ox, -(Y - v.Y0) * v.s + v.oy

    # ------------------------------------------------ fundalul din dale
    def fundal(self, schimbat=False):
        v = self.v
        if v.X0 is None: return
        src = self.src; S = fundal.sursa(src); c = self.c
        if schimbat: c.delete("dala"); self.imgs.clear()
        if "google" in S and not fundal.cheie_google():
            self.msg.config(text="Google: pune cheia API (🔑 în antet)"); c.delete("dala"); self.imgs.clear(); self.atribuire(); return
        w, h = c.winfo_width(), c.winfo_height()
        z = int(min(S["zmax"], max(0, round(math.log2(2 * math.pi * fundal.R / 256 * v.s)))))
        n = 2 ** z; res = fundal.rez(z); px = 256 * v.s * res               # mărimea unei dale pe ecran
        X0, Y1 = (0 - v.ox) / v.s + v.X0, (v.oy - 0) / v.s + v.Y0            # colțul stânga-sus, în metri
        X1, Y0 = (w - v.ox) / v.s + v.X0, (v.oy - h) / v.s + v.Y0
        o = math.pi * fundal.R
        tx0, tx1 = int((X0 + o) / (256 * res)), int((X1 + o) / (256 * res))
        ty0, ty1 = int((o - Y1) / (256 * res)), int((o - Y0) / (256 * res))
        dorite = set()
        for tx in range(max(0, tx0), min(n - 1, tx1) + 1):
            for ty in range(max(0, ty0), min(n - 1, ty1) + 1):
                k = (src, z, tx, ty, round(px, 2)); dorite.add(k)
                if k in self.imgs: continue
                img = v.dale.ia(src, z, tx, ty)
                if img is None: continue
                sx, sy = self.xy(tx * 256 * res - o, o - ty * 256 * res)
                q = int(math.ceil(px)) + 1                                   # 1 px suprapunere: fără linii albe între dale
                ph = png_tk(img, q, q)
                self.imgs[k] = (ph, c.create_image(math.floor(sx), math.floor(sy), image=ph, anchor="nw", tags=("dala",)))
        for k in [k for k in self.imgs if k not in dorite]:                  # dalele vechi (alt zoom / în afara ecranului)
            c.delete(self.imgs.pop(k)[1])
        c.tag_lower("dala")
        self.msg.config(text="⚠ harta de fundal nu se descarcă (internet / rețea blocată)" if src in v.dale.erori and not self.imgs else "")
        if src in v.dale.erori and not self.imgs: fundal_log(f"{S['nume']}: {v.dale.erori[src]}")
        self.atribuire()

    def legenda(self):
        """Legenda iconițelor, în colțul hărții."""
        c = self.c; c.delete("leg")
        c.create_rectangle(8, 8, 142, 172, fill="white", outline="#dde2e8", tags=("leg",))
        for i, (k, sp, t) in enumerate((("copac", "plop", "Plop"), ("copac", "nuc", "Posibil nuc"), ("copac", None, "Copac"),
                                         ("groapa", None, "Groapă"), ("semn", None, "Indicator"))):
            icona(c, 30, 40 + i * 31 + (-6 if k == "groapa" else 0), k, 0.8, ("leg",), sp)
            c.create_text(54, 32 + i * 31, text=t, anchor="w", font=(FONT, 9), fill=TEXT, tags=("leg",))

    def atribuire(self):
        c = self.c; c.delete("atr")
        t = c.create_text(c.winfo_width() - 6, c.winfo_height() - 5, text=fundal.sursa(self.src)["atr"], anchor="se",
                          font=(FONT, 8), fill="#333", tags=("atr",))
        b = c.bbox(t); c.create_rectangle(b[0] - 3, b[1] - 1, b[2] + 3, b[3] + 1, fill="white", outline="", tags=("atr",))
        c.tag_raise(t)
        if self is self.v.harti[0] and not c.find_withtag("leg"): self.legenda()     # legenda doar o dată, pe harta din stânga
        c.tag_raise("leg")


class Vizualizare(tk.Toplevel):
    def __init__(self, root, comuta_pauza=None):
        super().__init__(root, bg=BG); self.title("Vizualizare live – Drum RM"); self.comuta_pauza = comuta_pauza
        sw, sh = self.winfo_screenwidth(), self.winfo_screenheight()             # cât încape pe ecran
        self.geometry(f"{min(1500, sw - 40)}x{min(860, sh - 90)}+10+10")
        try:
            if sw < 1600: self.state("zoomed")                                     # ecran mic: pe tot ecranul (Windows)
        except tk.TclError: pass
        self.q = queue.Queue(); self.dale = fundal.Dale(lambda src: self.q.put(("dala", src)))
        h = tk.Frame(self, bg=ANTET); h.pack(fill="x")
        tk.Label(h, text="🗺  Vizualizare live", bg=ANTET, fg="white", font=(FONT, 12, "bold")).pack(side="left", padx=14, pady=8)
        self.titlu = tk.Label(h, text="", bg=ANTET, fg="#a9c1d9", font=(FONT, 10)); self.titlu.pack(side="left")
        Buton(h, "🔑 Cheie Google", self.cheie, tip="antet").pack(side="right", padx=(0, 10))
        self.btn_pauza = Buton(h, "⏸ Pauză", lambda: self.comuta_pauza and self.comuta_pauza(), tip="antet"); self.btn_pauza.pack(side="right")
        Buton(h, "⤢ Tot traseul", lambda: self.potriveste(self.tr_plan), tip="antet").pack(side="right")
        self.urm = tk.BooleanVar(value=True)
        tk.Checkbutton(h, text="Urmărește mașina", variable=self.urm, bg=ANTET, fg="white", selectcolor=ANTET,
                       activebackground=ANTET, activeforeground="white", font=(FONT, 9)).pack(side="right", padx=8)

        corp = tk.PanedWindow(self, orient="horizontal", sashwidth=6, bg=BG, bd=0); corp.pack(fill="both", expand=True, padx=10, pady=10)
        hartile = tk.PanedWindow(corp, orient="horizontal", sashwidth=6, bg=BG, bd=0); corp.add(hartile, stretch="always", minsize=700)
        self.harti = [Harta(self, hartile, ["osm"], "osm"),
                      Harta(self, hartile, ["google_satelit", "google_harta", "esri", "wayback"], "google_satelit" if fundal.cheie_google() else "esri")]
        for m in self.harti: hartile.add(m.frame, stretch="always", minsize=300)
        dr = tk.Frame(corp, bg=BG); corp.add(dr, minsize=420)
        f = tk.Frame(dr, bg=CARD, highlightthickness=1, highlightbackground="#dde2e8"); f.pack(fill="x")
        tk.Label(f, text="FILMAREA – cadrul analizat acum", bg=CARD, fg=GRI, font=(FONT, 9, "bold"), anchor="w").pack(fill="x", padx=10, pady=(6, 2))
        self._gol = tk.PhotoImage(width=420, height=236)                       # până vine primul cadru: mărime în pixeli
        self.video = tk.Label(f, bg="#111", image=self._gol); self.video.pack(padx=10)
        r = tk.Frame(f, bg=CARD); r.pack(fill="x", padx=10, pady=(4, 0))
        self.timp = tk.Label(r, text="⏱ 00:00 / 00:00", bg=CARD, fg=TEXT, font=(FONT, 11, "bold")); self.timp.pack(side="left")
        self.vinfo = tk.Label(r, text="", bg=CARD, fg=GRI, font=(FONT, 9)); self.vinfo.pack(side="right")
        r = tk.Frame(f, bg=CARD); r.pack(fill="x", padx=10)
        self.viteza = tk.Label(r, text="— km/h", bg=CARD, fg=ALBASTRU, font=(FONT, 16, "bold")); self.viteza.pack(side="left")
        self.gpsinfo = tk.Label(r, text="GPS: —", bg=CARD, fg=TEXT, font=(FONT, 9), justify="left"); self.gpsinfo.pack(side="left", padx=12)
        self.tbar = tk.Canvas(f, height=6, bg="#e4e8ec", highlightthickness=0); self.tbar.pack(fill="x", padx=10, pady=(4, 2))
        # înapoi în timp: bara de timp, butoanele și „Mergi la”
        self.ts = tk.DoubleVar(value=0); self._set = False
        self.scala = ttk.Scale(f, from_=0, to=1, variable=self.ts, command=lambda v: None if self._set else self.revizuieste(float(v)))
        self.scala.pack(fill="x", padx=10)
        r = tk.Frame(f, bg=CARD); r.pack(fill="x", padx=10, pady=(2, 4))
        for t, d in (("⏪ 10s", -10000), ("◀ 1s", -1000), ("1s ▶", 1000), ("10s ⏩", 10000)):
            Buton(r, t, lambda d=d: self.revizuieste(self.ts.get() + d)).pack(side="left", padx=(0, 3))
        self.btn_live = Buton(r, "● LIVE", self.live, tip="rosu"); self.btn_live.pack(side="left", padx=(6, 0))
        r = tk.Frame(f, bg=CARD); r.pack(fill="x", padx=10, pady=(0, 8))
        tk.Label(r, text="Mergi la minutul (mm:ss):", bg=CARD, fg=GRI, font=(FONT, 9)).pack(side="left", padx=(0, 6))
        self.mergi = tk.StringVar()
        e = tk.Entry(r, textvariable=self.mergi, width=7, bd=0, highlightthickness=1, highlightbackground="#dde2e8", font=(FONT, 10), justify="center")
        e.pack(side="left", ipady=2); e.bind("<Return>", lambda ev: self.mergi_la())
        Buton(r, "↵", self.mergi_la).pack(side="left", padx=2)
        f = tk.Frame(dr, bg=CARD, highlightthickness=1, highlightbackground="#dde2e8"); f.pack(fill="x", pady=(8, 0))
        tk.Label(f, text="STRATURI (pe ambele hărți)", bg=CARD, fg=GRI, font=(FONT, 9, "bold"), anchor="w").pack(fill="x", padx=10, pady=(6, 0))
        rr = [tk.Frame(f, bg=CARD), tk.Frame(f, bg=CARD)]; self.vis = {}
        for x in rr: x.pack(fill="x", padx=10)
        rr[1].pack_configure(pady=(0, 6))
        for i, (tag, nume) in enumerate((("drum", "Axe drumuri OSM"), ("traseu", "Traseu"), ("gps", "Puncte GPS"), ("raza", "Raze (calcul)"), ("proiectie", "Proiecții pe sol"),
                                         ("copac", "Copaci"), ("groapa", "Gropi"), ("semn", "Indicatoare"))):
            v = self.vis[tag] = tk.BooleanVar(value=tag != "drum")
            tk.Checkbutton(rr[i // 4 if i < 8 else 1], text=nume, variable=v, bg=CARD, font=(FONT, 9), bd=0, highlightthickness=0,
                           command=lambda t=tag: self.arata(t)).pack(side="left", padx=(0, 6))
        f = tk.Frame(dr, bg=CARD, highlightthickness=1, highlightbackground="#dde2e8"); f.pack(fill="both", expand=True, pady=(8, 0))
        tk.Label(f, text="SELECȚIA – click pe o rază sau pe un obiect", bg=CARD, fg=GRI, font=(FONT, 9, "bold"), anchor="w").pack(fill="x", padx=10, pady=(6, 0))
        self.info = tk.Text(f, height=10, bd=0, bg="#f7f9fb", fg=TEXT, font=("Consolas", 9), wrap="word")
        self.info.pack(fill="both", expand=True, padx=10, pady=(2, 10)); self.info.tag_config("b", font=("Consolas", 9, "bold"))
        self.after(150, lambda: corp.sash_place(0, int(self.winfo_width() * 0.68), 0))
        self.X0 = None; self.reset()
        self.after(60, self.poll)

    # ------------------------------------------------ transformarea (comună celor două hărți)
    def reset(self):
        for m in self.harti: m.c.delete("all"); m.imgs.clear(); m.tip_item.clear()
        self.X0 = self.Y0 = None; self.s = 1.0; self.ox = 300; self.oy = 300; self.durata = 0
        self.tr = []; self.tr_plan = []; self.raze = {}; self.obj = {}; self.sel = None; self.foto = None
        self.masini = {}; self.drag = None; self.br = 0; self.lat = {}; self.k = 1.0; self.gps = []; self.gps_cur = None
        self.ist = []; self.ist_t = []; self.img_t = []; self.img = []; self.revizie = False
        self.info.delete("1.0", "end")

    def zoom(self, x, y, f):
        if self.X0 is None: return
        for m in self.harti: m.c.scale("vector", x, y, f, f)
        self.s *= f; self.ox = x + (self.ox - x) * f; self.oy = y + (self.oy - y) * f
        self.redeseneaza(); self._fundal_curand()

    def muta(self, dx, dy):
        for m in self.harti: m.c.move("vector", dx, dy); m.c.move("dala", dx, dy)
        self.ox += dx; self.oy += dy; self._fundal_curand()

    def _fundal_curand(self):
        if getattr(self, "_jf", None): self.after_cancel(self._jf)
        self._jf = self.after(120, lambda: [m.fundal() for m in self.harti])

    def potriveste(self, pts):
        if len(pts) < 2: return
        a = np.array(pts); c = self.harti[0].c; w = max(c.winfo_width(), 300); h = max(c.winfo_height(), 300)
        f = min(w / (np.ptp(a[:, 0]) + 40), h / (np.ptp(a[:, 1]) + 40)) / self.s
        x, y = self.harti[0].xy(*a.mean(0)); self.zoom(x, y, f)
        x, y = self.harti[0].xy(*a.mean(0)); self.muta(w / 2 - x, h / 2 - y)

    def arata(self, tag):
        for m in self.harti: m.c.itemconfigure(tag, state="normal" if self.vis[tag].get() else "hidden")

    def cheie(self):
        k = simpledialog.askstring("Cheie Google", "Cheia API Google (Map Tiles API pornit în Google Cloud Console).\n"
                                   "Se folosește doar pentru afișarea hărții Google.", show="•", parent=self)
        if not k: return
        fundal.seteaza_cheie_google(k.strip(), messagebox.askyesno("Cheie Google", "Țin minte cheia pe acest calculator?\n"
                                                                    "(criptată cu contul tău de Windows)", parent=self))
        m = self.harti[1]; m.sursa.set(fundal.SURSE["google_satelit"]["nume"]); m.fundal(True)

    # ------------------------------------------------ mouse
    def apasa(self, e): self.drag = (e.x, e.y, e.x, e.y)

    def trage(self, e):
        if not self.drag: return
        x0, y0, lx, ly = self.drag
        if abs(e.x - x0) + abs(e.y - y0) > 4: self.urm.set(False); self.muta(e.x - lx, e.y - ly)
        self.drag = (x0, y0, e.x, e.y)

    def elibereaza(self, e, harta):
        if self.drag and abs(e.x - self.drag[0]) + abs(e.y - self.drag[1]) <= 4:
            for it in reversed(harta.c.find_overlapping(e.x - 4, e.y - 4, e.x + 4, e.y + 4)):
                tags = harta.c.gettags(it)
                tid = next((int(t[1:]) for t in tags if t.startswith("t") and t[1:].isdigit()), None)
                if tid is not None: self.alege(tid, next((t for t in tags if t.startswith("r_")), None)); break
            else:
                self.alege(None, None)
        self.drag = None

    # ------------------------------------------------ desenul vectorilor (pe ambele hărți)
    def linie(self, pts, tags, **kw):
        out = []
        for m in self.harti:
            it = m.c.create_line(*[c for p in pts for c in m.xy(*p)], tags=("vector",) + tags, **kw); out.append((m, it))
        return out

    def redeseneaza(self):
        """Punctele și mașina își păstrează mărimea pe ecran; axele drumurilor au lățimea reală a carosabilului."""
        for m in self.harti:
            for it in m.c.find_withtag("drum"): m.c.itemconfigure(it, width=max(2, self.lat.get(it, 6) * self.s))
        for tid, o in self.obj.items():
            self._punct(tid, o["kind"], o["X"], o["Y"], r=7 if o.get("final") else 6, specie=o.get("specie"))
        if getattr(self, "gps", None): self._puncte_gps()
        if self.tr: self._masina(*self.tr[-1], self.br)
        for m in self.harti:
            if self.sel is not None: m.c.tag_raise(f"o{self.sel}")
            m.c.tag_raise("masina"); m.c.tag_raise("atr")

    @staticmethod
    def cul_gps(a): return "#9aa5b1" if a is None else ("#2e9d3a" if a < 3 else ("#f0a020" if a < 8 else "#d32f2f"))

    def _puncte_gps(self):
        """Fiecare poziție GPS înregistrată de telefon, colorată după precizie."""
        for m in self.harti:
            m.c.delete("gps")
            for X, Y, a in self.gps:
                x, y = m.xy(X, Y)
                it = m.c.create_oval(x - 3.5, y - 3.5, x + 3.5, y + 3.5, fill=self.cul_gps(a), outline="white", tags=("vector", "gps"))
                if not self.vis["gps"].get(): m.c.itemconfigure(it, state="hidden")

    def _punct(self, tid, kind, X, Y, r=6, specie=None):
        """Iconița obiectului după ce s-a detectat (și specia copacului); punctul alb de la bază = locul exact."""
        for m in self.harti:
            m.c.delete(f"o{tid}"); x, y = m.xy(X, Y)
            its = icona(m.c, x, y, kind, r / 6.0, ("vector", kind, f"t{tid}", f"o{tid}"), specie)
            if not self.vis[kind].get():
                for it in its: m.c.itemconfigure(it, state="hidden")

    def _masina(self, X, Y, a):
        self.br = a
        for m in self.harti:
            x, y = m.xy(X, Y); L = 13
            p = [x + L * math.sin(a), y - L * math.cos(a), x + 8 * math.sin(a + 2.5), y - 8 * math.cos(a + 2.5),
                 x + 8 * math.sin(a - 2.5), y - 8 * math.cos(a - 2.5)]
            if m in self.masini: m.c.coords(self.masini[m], *p)
            else: self.masini[m] = m.c.create_polygon(*p, fill="#ff7a00", outline="white", width=2, tags=("vector", "masina"))
            m.c.delete("gpscur")
            acc, v = self.gps_cur[:2] if getattr(self, "gps_cur", None) else (None, None)
            if acc:                                                         # cercul de precizie GPS
                rr = max(4, acc * self.k * self.s)
                m.c.create_oval(x - rr, y - rr, x + rr, y + rr, outline="#1d6fe0", width=2, fill="#1d6fe0", stipple="gray12", tags=("vector", "masina", "gpscur"))
            if acc or v is not None:
                t = (f"{v:.0f} km/h" if v is not None else "") + (f" · ±{acc:.1f} m" if acc else "")
                tx = m.c.create_text(x + 16, y - 16, text=t, anchor="w", font=(FONT, 9, "bold"), fill="#0b2540", tags=("vector", "masina", "gpscur"))
                b = m.c.bbox(tx); bg = m.c.create_rectangle(b[0] - 4, b[1] - 2, b[2] + 4, b[3] + 2, fill="white", outline="#1d6fe0", tags=("vector", "masina", "gpscur"))
                m.c.tag_raise(tx, bg)
            m.c.tag_raise("masina"); m.c.tag_raise(self.masini[m])

    # ------------------------------------------------ selecția
    def alege(self, tid, rid):
        if self.sel is not None:
            for m in self.harti:
                for it in m.c.find_withtag(f"t{self.sel}"):
                    if it in m.tip_item: m.c.itemconfigure(it, **m.tip_item[it])
        self.sel = tid; self.info.delete("1.0", "end")
        if tid is None: return
        for m in self.harti:
            for it in m.c.find_withtag(f"t{tid}"):
                tags = m.c.gettags(it)
                if "raza" in tags or "proiectie" in tags:
                    on = rid and rid in tags
                    m.c.itemconfigure(it, fill="#ff2fd0" if on else "#ffe600", width=4 if on else 2)
                m.c.tag_raise(it)
            m.c.tag_raise(f"o{tid}"); m.c.tag_raise("masina")
        o = self.obj.get(tid); rz = self.raze.get(tid, [])
        k = o["kind"] if o else (rz[0]["kind"] if rz else "?")
        sp = o.get("specie") if o else None
        self.info.insert("end", f"{({'plop': 'Plop', 'nuc': 'Posibil nuc'}).get(sp) or NUME.get(k, k)} – urma {tid}\n", "b")
        if o and o.get("specie_txt"): self.info.insert("end", f"Specie: {o['specie_txt']}\n")
        if o:
            self.info.insert("end", f"Poziție: X={o['E']:.2f}  Y={o['N']:.2f}  (MOLDREF99)\nMetoda: {o['met']} · {len(rz)} raze / observații\n")
            if o.get("nota"): self.info.insert("end", f"Notă: {o['nota']}\n")
            if o.get("osm"): self.info.insert("end", f"OSM: {o['osm']}\n")
        else:
            self.info.insert("end", "Încă se urmărește (poziția apare când obiectul iese din cadru).\n")
        self.info.insert("end", "\nRaze (minut în video · azimut · distanța razei față de poziție):\n", "b")
        for r in rz:
            sel = rid == f"r_{r['frame']}_{tid}"; rez = ""
            if o:
                d = np.array([math.sin(r["az"]), math.cos(r["az"])]); v = np.array([o["E"], o["N"]]) - np.array(r["cam"])
                rez = f" · {abs(v[0] * d[1] - v[1] * d[0]):.2f} m"
            self.info.insert("end", f"{'▶ ' if sel else '  '}{mmss(r['t'])} (cadrul {r['frame']}) · {math.degrees(r['az']) % 360:5.1f}°{rez}\n", "b" if sel else "")
        if o and o.get("foto"): self.cadru_imagine(o["foto"], f"{NUME.get(k, k)} {tid} – cea mai bună poză")

    # ------------------------------------------------ evenimentele analizei
    def poll(self):
        if not self.winfo_exists(): return
        dale = False
        try:
            for _ in range(500):
                ev = self.q.get_nowait()
                if ev[0] == "dala": dale = True
                elif ev[0] == "ani": ev[1].ani_gata(ev[2], ev[3])
                else: getattr(self, "ev_" + ev[0])(*ev[1:])
        except queue.Empty:
            pass
        if dale: [m.fundal() for m in self.harti]
        self.after(60, self.poll)

    def ev_start(self, nume, traseu, drumuri, durata_ms=0, gps=()):
        self.reset(); self.titlu.config(text=nume); self.durata = durata_ms
        pl = [merc(*p) for p in traseu]; self.tr_plan = pl; self.X0, self.Y0 = pl[0]
        a, b = merc(*traseu[0]), merc(traseu[0][0] + 1, traseu[0][1]); self.k = math.hypot(b[0] - a[0], b[1] - a[1])
        for xy, half in drumuri:
            for m, it in self.linie([merc(*p) for p in xy], ("drum",), fill="#c9c2b0", width=4, capstyle="round", joinstyle="round"):
                self.lat[it] = 2 * half * self.k
        self.linie(pl, ("traseu",), fill="#ffb366", width=2, dash=(4, 3))
        self.gps = [(*merc(E, N), a) for E, N, a in gps]; self._puncte_gps()
        self.update_idletasks(); self.potriveste(pl)
        for t in self.vis: self.arata(t)

    def ev_drumuri(self, drumuri):
        """Drumurile OSM au sosit (după start): axele, sub restul desenului."""
        for xy, half in drumuri:
            for m, it in self.linie([merc(*p) for p in xy], ("drum",), fill="#c9c2b0", width=max(2, 2 * half * self.k * self.s),
                                    capstyle="round", joinstyle="round"):
                self.lat[it] = 2 * half * self.k; m.c.tag_lower(it); m.c.tag_lower("dala")
                if not self.vis["drum"].get(): m.c.itemconfigure(it, state="hidden")

    # ------------------------------------------------ pauză și înapoi în timp
    def arata_pauza(self, on):
        self.btn_pauza.config(text="▶ Continuă" if on else "⏸ Pauză")
        if on: self.vinfo.config(text="În pauză – trage bara de timp sau scrie „Mergi la”")

    def mergi_la(self):
        t = citeste_timp(self.mergi.get())
        if t is not None: self.revizuieste(t)

    def revizuieste(self, t):
        """Afișează momentul t (ms) din filmare: cadrul analizat atunci și mașina „fantomă” pe hărți."""
        if not self.ist_t: return
        t = max(self.ist_t[0], min(self.ist_t[-1], t)); self.revizie = True
        self._set = True; self.ts.set(t); self._set = False
        i = max(0, bisect.bisect_right(self.ist_t, t) - 1); _, X, Y, br, gps = self.ist[i]
        for m in self.harti:
            m.c.delete("fantoma"); x, y = m.xy(X, Y); L = 14
            m.c.create_polygon(x + L * math.sin(br), y - L * math.cos(br), x + 9 * math.sin(br + 2.5), y - 9 * math.cos(br + 2.5),
                               x + 9 * math.sin(br - 2.5), y - 9 * math.cos(br - 2.5), fill="#1d6fe0", outline="white", width=2,
                               tags=("vector", "fantoma"))
            m.c.tag_raise("fantoma")
        j = bisect.bisect_right(self.img_t, t) - 1
        if j >= 0:
            img = cv2.imdecode(np.frombuffer(self.img[j][0], np.uint8), cv2.IMREAD_COLOR)
            self.cadru_imagine(img, self.img[j][1])
        self.timp.config(text=f"⏪ {mmss(t)} / {mmss(self.durata)}", fg=ALBASTRU)
        if gps and gps[1] is not None: self.viteza.config(text=f"{gps[1]:.0f} km/h")
        self.btn_live.config(state="normal")

    def live(self):
        self.revizie = False
        for m in self.harti: m.c.delete("fantoma")
        self.timp.config(fg=TEXT)
        if self.img: self.cadru_imagine(cv2.imdecode(np.frombuffer(self.img[-1][0], np.uint8), cv2.IMREAD_COLOR), self.img[-1][1])

    def ev_cadru(self, E, N, br, img, text, t_ms=None, gps=None):
        X, Y = merc(E, N); self.tr.append((X, Y)); self.gps_cur = gps
        if t_ms is not None:                                  # istoria, pentru „înapoi”
            self.ist.append((t_ms, X, Y, br, gps)); self.ist_t.append(t_ms)
            if img is not None and (not self.img_t or t_ms - self.img_t[-1] >= 400):
                sm = cv2.resize(img, (640, int(img.shape[0] * 640 / img.shape[1])), interpolation=cv2.INTER_AREA)
                ok, b = cv2.imencode(".jpg", sm, [cv2.IMWRITE_JPEG_QUALITY, 72])
                if ok: self.img_t.append(t_ms); self.img.append((b.tobytes(), text))
            if self.durata: self.scala.configure(to=self.durata)
            if not self.revizie: self._set = True; self.ts.set(t_ms); self._set = False
        if self.revizie:                                      # se privește în urmă: harta crește, filmarea rămâne pe momentul ales
            if len(self.tr) > 1: self.linie(self.tr[-2:], ("traseu",), fill="#ff7a00", width=3, capstyle="round")
            self._masina(X, Y, br); return
        if gps:
            acc, v, lat, lon = gps
            self.viteza.config(text=f"{v:.0f} km/h" if v is not None else "— km/h",
                               fg=ROSU if v is not None and v > 45 else ALBASTRU)          # peste ~40 km/h obiectele au prea puține cadre
            self.gpsinfo.config(text=f"GPS {lat:.6f}, {lon:.6f}\nprecizie ±{acc:.1f} m" if acc else f"GPS {lat:.6f}, {lon:.6f}",
                                fg=TEXT if not acc or acc < 8 else ROSU)
        if len(self.tr) > 1: self.linie(self.tr[-2:], ("traseu",), fill="#ff7a00", width=3, capstyle="round")
        self._masina(X, Y, br)
        if self.urm.get():
            c = self.harti[0].c; x, y = self.harti[0].xy(X, Y); w, h = c.winfo_width(), c.winfo_height()
            if not (w * 0.25 < x < w * 0.75 and h * 0.25 < y < h * 0.75): self.muta(w / 2 - x, h / 2 - y)
        if t_ms is not None:
            self.timp.config(text=f"⏱ {mmss(t_ms)} / {mmss(self.durata)}" if self.durata else f"⏱ {mmss(t_ms)}")
            if self.durata:
                w = self.tbar.winfo_width(); self.tbar.delete("all")
                self.tbar.create_rectangle(0, 0, w * min(1, t_ms / self.durata), 6, fill=VERDE, width=0)
        if img is not None: self.cadru_imagine(img, text)

    def cadru_imagine(self, img, text):
        if isinstance(img, str): img = cv2.imread(img)
        if img is None: return
        w = max(320, self.video.master.winfo_width() - 22)
        self.foto = png_tk(img, w); self.video.config(image=self.foto, width=w, height=self.foto.height()); self.vinfo.config(text=text)

    def ev_raza(self, tid, kind, frame, cam, az, gnd, dist, t_ms=0):
        self.raze.setdefault(tid, []).append(dict(kind=kind, frame=frame, cam=cam, az=az, gnd=gnd, t=t_ms))
        tags = (f"t{tid}", f"r_{frame}_{tid}")
        if kind == "groapa" and gnd:
            out = self.linie([merc(*cam), merc(*gnd)], ("proiectie",) + tags, fill=RAZA[kind], width=1); lay = "proiectie"
        else:
            L = min(max(dist or 25, 8), 60) * 1.15
            out = self.linie([merc(*cam), merc(cam[0] + L * math.sin(az), cam[1] + L * math.cos(az))], ("raza",) + tags,
                             fill=RAZA[kind], width=1); lay = "raza"
        for m, it in out:
            m.tip_item[it] = dict(fill=RAZA[kind], width=1); m.c.tag_raise("masina")
            if not self.vis[lay].get(): m.c.itemconfigure(it, state="hidden")

    def ev_obiect(self, tid, kind, E, N, met, foto, specie=None):
        X, Y = merc(E, N); self.obj[tid] = dict(kind=kind, E=E, N=N, X=X, Y=Y, met=met, foto=foto, specie=specie)
        self._punct(tid, kind, X, Y, specie=specie)
        for m in self.harti: m.c.tag_raise("masina")
        if self.sel == tid: self.alege(tid, None)

    def ev_ignorat(self, tid, motiv):
        """Un „indicator” care nu e semn rutier (panou, reclamă, monument): razele lui se sting."""
        for m in self.harti:
            for it in m.c.find_withtag(f"t{tid}"):
                if m.c.type(it) == "line": m.c.itemconfigure(it, fill="#c0c4c8", dash=(2, 3))   # razele lui se sting
        self.obj.pop(tid, None)
        for m in self.harti: m.c.delete(f"o{tid}")

    def ev_final(self, objs):
        """Pozițiile finale: dublurile unite dispar, copacii mutați de pe carosabil au o săgeată de la poziția veche."""
        pastrate = set()
        for o in objs:
            ids = sorted(o.get("ids", {o["id"]})); tid = o["id"]; pastrate |= set(ids); old = self.obj.get(tid)
            X, Y = merc(o["E"], o["N"])
            for t in ids:
                if t == tid: continue
                for m in self.harti: m.c.delete(f"o{t}"); m.c.addtag_withtag(f"t{tid}", f"t{t}")
                self.raze.setdefault(tid, []).extend(self.raze.pop(t, [])); self.obj.pop(t, None)
            if old and math.hypot(old["E"] - o["E"], old["N"] - o["N"]) > 0.5:
                self.linie([(old["X"], old["Y"]), (X, Y)], (o["kind"], f"t{tid}"), arrow="last", dash=(3, 2), fill="#ffd400", width=2)
            self.obj[tid] = dict(kind=o["kind"], E=o["E"], N=o["N"], X=X, Y=Y, met=o["met"], foto=o.get("foto"),
                                 nota=o.get("nota"), osm=o.get("osm"), final=True, specie=o.get("specie"), specie_txt=o.get("specie_txt"))
            self._punct(tid, o["kind"], X, Y, r=7, specie=o.get("specie"))
        for t in list(self.obj):
            if t not in pastrate:
                for m in self.harti: m.c.delete(f"o{t}")
                self.obj.pop(t)
        self.vinfo.config(text=f"Gata: {len(objs)} obiecte vectorizate")
