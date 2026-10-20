"""Drum RM – Analiza: fereastra programului (portabil, fără instalare).

Tragi arhiva .zip a filmării peste fereastră (sau peste Drum_Analiza.exe), alegi unde se salvează rezultatul
și apeși Analizează. Bara arată cât s-a făcut și cât timp a mai rămas."""
import os, sys, threading, time, queue, traceback

# datele GDAL/PROJ din pachet (la .exe stau lângă program)
_BAZA = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
for var, sub in (("PROJ_DATA", "proj"), ("PROJ_LIB", "proj"), ("GDAL_DATA", "gdal-data")):
    p = os.path.join(_BAZA, sub)
    if os.path.isdir(p): os.environ[var] = p


def _incarca_cv2():
    """În .exe: încarcă direct modulul binar OpenCV (cv2*.pyd), fără „bootstrap”-ul pachetului cv2.
    Bootstrap-ul caută binarul după căi scrise la construire; pe alt calculator nu le găsește și dă
    „recursion is detected during loading of cv2”."""
    if not getattr(sys, "frozen", False) or "cv2" in sys.modules: return
    import glob, importlib.util
    pyd = sorted(glob.glob(os.path.join(_BAZA, "**", "cv2*.pyd"), recursive=True), key=len)
    if not pyd:
        raise ImportError("Lipsește fișierul OpenCV (cv2*.pyd) din folderul _internal – arhiva n-a fost extrasă întreagă "
                          "sau antivirusul l-a șters. Extrage din nou toată arhiva și adaugă folderul la excepțiile antivirusului.")
    dll = {_BAZA, os.path.dirname(pyd[0])} | {os.path.dirname(f) for f in glob.glob(os.path.join(_BAZA, "**", "opencv_*.dll"), recursive=True)}
    for d in dll:
        try: os.add_dll_directory(d)
        except (OSError, AttributeError): pass
    os.environ["PATH"] = os.pathsep.join(dll) + os.pathsep + os.environ.get("PATH", "")
    try:
        spec = importlib.util.spec_from_file_location("cv2", pyd[0])
        mod = importlib.util.module_from_spec(spec); sys.modules["cv2"] = mod; spec.loader.exec_module(mod)
    except Exception as e:
        sys.modules.pop("cv2", None)
        raise ImportError(f"OpenCV nu se încarcă din {pyd[0]}: {e}\n"
                          "Dacă lipsește o bibliotecă DLL: instalează Microsoft Visual C++ Redistributable x64 "
                          "și verifică dacă antivirusul n-a șters fișiere din folderul _internal.") from e


_incarca_cv2()

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog

try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    _DND = True
except Exception:
    _DND = False

import analiza, panouri

TITLU = "Drum RM – Analiza filmărilor"


def durata(s):
    s = int(max(0, s))
    if s < 60: return f"{s} s"
    if s < 3600: return f"{s // 60} min {s % 60:02d} s"
    return f"{s // 3600} h {s % 3600 // 60:02d} min"


class App:
    def __init__(self, root, initial):
        self.root = root; root.title(TITLU); root.geometry("820x900"); root.minsize(720, 800)
        self.q = queue.Queue(); self.jurnal = []; self.dbg = None; self.viz = None; self.pauza = False; self.files = []; self.running = False; self.stop = False; self.results = []
        self.out = tk.StringVar(value=os.path.join(os.path.expanduser("~"), "Documents", "Drum_rezultate"))
        from stil import Buton, card, teme, FONT, CARD, BG, TEXT, GRI, VERDE, ROSU, ALBASTRU, PORTOCALIU, ANTET
        teme(root)

        # antet: titlul, versiunea, Actualizează și Debug
        h = tk.Frame(root, bg=ANTET); h.pack(fill="x")
        tk.Label(h, text="Drum RM", bg=ANTET, fg="white", font=(FONT, 16, "bold")).pack(side="left", padx=(16, 6), pady=10)
        tk.Label(h, text="Analiza filmărilor  ·  copaci, gropi, indicatoare", bg=ANTET, fg="#a9c1d9", font=(FONT, 10)).pack(side="left", pady=(6, 0))
        Buton(h, "🐞 Debug", self.debug, tip="antet").pack(side="right", padx=(0, 12))
        tk.Frame(root, bg=BG, height=12).pack(fill="x")

        # 1. filmările
        c = card(root, "1 · FILMĂRILE (.zip descărcate de pe portal)")
        self.drop = tk.Label(c, text="⬇  Trage aici arhivele .zip\nsau apasă „Alege filmări…”", bg="#f1f7f1", fg="#2c5a2f",
                             font=(FONT, 12), height=3, highlightthickness=2, highlightbackground="#a5d0a8")
        self.drop.pack(fill="x")
        if _DND:
            self.drop.drop_target_register(DND_FILES); self.drop.dnd_bind("<<Drop>>", self.on_drop)
            root.drop_target_register(DND_FILES); root.dnd_bind("<<Drop>>", self.on_drop)
        r = tk.Frame(c, bg=CARD); r.pack(fill="x", pady=(8, 0))
        Buton(r, "📁 Alege filmări…", self.pick).pack(side="left")
        Buton(r, "✕ Golește lista", self.clear).pack(side="left", padx=6)
        self.lst = tk.Listbox(c, height=3, bd=0, highlightthickness=1, highlightbackground="#dde2e8", font=(FONT, 9),
                              selectbackground="#d6e8d7", selectforeground=TEXT)
        self.lst.pack(fill="x", pady=(8, 0))
        r = tk.Frame(c, bg=CARD); r.pack(fill="x", pady=(8, 0))
        tk.Label(r, text="Rezultatul în:", bg=CARD, fg=GRI, font=(FONT, 9)).pack(side="left")
        tk.Entry(r, textvariable=self.out, bd=0, highlightthickness=1, highlightbackground="#dde2e8", font=(FONT, 9)
                 ).pack(side="left", fill="x", expand=True, padx=8, ipady=5)
        Buton(r, "Schimbă…", self.pick_out).pack(side="left")

        # 2. analiza: butoanele, bara, timpul rămas, obiectele vectorizate
        c = card(root, "2 · ANALIZA")
        r = tk.Frame(c, bg=CARD); r.pack(fill="x")
        self.btn = Buton(r, "▶  Analizează", self.start, tip="principal", mare=True); self.btn.pack(side="left")
        self.btn_stop = Buton(r, "■  Oprește", self.cancel, tip="rosu", mare=True); self.btn_stop.pack(side="left", padx=8)
        self.btn_stop.config(state="disabled")
        self.btn_pauza = Buton(r, "⏸ Pauză", self.comuta_pauza, mare=True); self.btn_pauza.pack(side="left", padx=(0, 8))
        self.btn_pauza.config(state="disabled")
        self.btn_open = Buton(r, "📂 Deschide rezultatul", self.open_result, mare=True); self.btn_open.pack(side="left")
        self.btn_open.config(state="disabled")
        r = tk.Frame(c, bg=CARD); r.pack(fill="x", pady=(10, 0))
        tk.Label(r, text="Analizează din filmare: de la", bg=CARD, fg=GRI, font=(FONT, 9)).pack(side="left")
        self.t_de = tk.StringVar(); self.t_pana = tk.StringVar()
        for v, txt in ((self.t_de, "până la"), (self.t_pana, "(mm:ss; gol = toată filmarea)")):
            tk.Entry(r, textvariable=v, width=7, bd=0, highlightthickness=1, highlightbackground="#dde2e8", font=(FONT, 10),
                     justify="center").pack(side="left", padx=6, ipady=3)
            tk.Label(r, text=txt, bg=CARD, fg=GRI, font=(FONT, 9)).pack(side="left")
        r = tk.Frame(c, bg=CARD); r.pack(fill="x", pady=(10, 0))
        tk.Label(r, text="Modelul de analiză:", bg=CARD, fg=GRI, font=(FONT, 9)).pack(side="left")
        self.model = tk.StringVar()
        self.cb_model = ttk.Combobox(r, textvariable=self.model, state="readonly", width=34, font=(FONT, 10))
        self.cb_model.pack(side="left", padx=8); self.cb_model.bind("<<ComboboxSelected>>", lambda e: self.model_ales())
        Buton(r, "➕ Adaugă model…", self.adauga_model).pack(side="left")
        self.minfo = tk.Label(c, text="", bg=CARD, fg=GRI, font=(FONT, 9), anchor="w"); self.minfo.pack(fill="x", pady=(2, 0))
        self.incarca_modele()
        self.pb = ttk.Progressbar(c, maximum=1000, style="Drum.Horizontal.TProgressbar"); self.pb.pack(fill="x", pady=(12, 4))
        r = tk.Frame(c, bg=CARD); r.pack(fill="x")
        self.status = tk.Label(r, text="Gata de lucru.", anchor="w", bg=CARD, fg=TEXT, font=(FONT, 10, "bold")); self.status.pack(side="left")
        self.eta = tk.Label(r, text="", anchor="e", bg=CARD, fg=ALBASTRU, font=(FONT, 10, "bold")); self.eta.pack(side="right")
        r = tk.Frame(c, bg=CARD); r.pack(fill="x", pady=(10, 0)); self.cnt = {}
        for k, nume, col, fon in (("copac", "🌳 Copaci", VERDE, "#eaf5eb"), ("groapa", "⚠ Gropi", ROSU, "#fbeaea"),
                                  ("semn", "🛑 Indicatoare", ALBASTRU, "#e8f0fa")):
            f = tk.Frame(r, bg=fon); f.pack(side="left", fill="x", expand=True, padx=(0, 8) if k != "semn" else 0)
            self.cnt[k] = tk.Label(f, text="0", bg=fon, fg=col, font=(FONT, 22, "bold")); self.cnt[k].pack(pady=(6, 0))
            tk.Label(f, text=nume, bg=fon, fg=col, font=(FONT, 9, "bold")).pack(pady=(0, 6))

        # 3. după corecturile din QGIS/ArcGIS: pe portal sau ca .gdb pentru ArcGIS / ArcGIS Pro
        c = card(root, "3 · REZULTATUL (și după corectare)")
        r = tk.Frame(c, bg=CARD); r.pack(fill="x")
        self.btn_portal = Buton(r, "☁  Salvează pe portal", self.send_portal, tip="albastru", mare=True); self.btn_portal.pack(side="left")
        self.btn_gdb = Buton(r, "🗂  Export GDB · ArcGIS / ArcGIS Pro", self.export_gdb, mare=True); self.btn_gdb.pack(side="left", padx=8)

        # jurnalul
        c = card(root, "JURNAL", expand=True)
        self.txt = tk.Text(c, height=6, font=("Consolas", 9), bd=0, bg="#f7f9fb", fg="#3a4652", highlightthickness=0)
        self.txt.pack(fill="both", expand=True)

        analiza._logf[0] = lambda s: self.q.put(("log", s))
        # orice eroare neprinsă ajunge în panoul de debug
        root.report_callback_exception = lambda t, e, tb: self.eroare(e)
        threading.excepthook = lambda a: self.q.put(("err", panouri.text_eroare(a.exc_value)))
        self.add(initial)
        root.after(100, self.poll)
        if self.files: root.after(400, self.start)          # zip tras peste .exe: pornește singur

    # ---------------------------------------------------- fișiere
    def add(self, paths):
        for p in paths:
            p = p.strip("{}")
            if p.lower().endswith(".zip") and os.path.exists(p) and p not in self.files:
                self.files.append(p); self.lst.insert("end", p)

    def on_drop(self, e):
        self.add(self.root.tk.splitlist(e.data))

    def pick(self):
        self.add(filedialog.askopenfilenames(title="Filmările (.zip)", filetypes=[("Arhive filmări", "*.zip")]))

    def clear(self):
        if not self.running: self.files.clear(); self.lst.delete(0, "end")

    def pick_out(self):
        d = filedialog.askdirectory(title="Unde salvez rezultatul")
        if d: self.out.set(d)

    # ---------------------------------------------------- analiza
    def start(self):
        if self.running: return
        if not self.files: messagebox.showinfo(TITLU, "Adaugă întâi o filmare (.zip)."); return
        os.makedirs(self.out.get(), exist_ok=True)
        self.running = True; self.stop = False; self.results = []; self.pauza = False
        self._interval = self.interval()                    # citit aici, nu din firul analizei
        self.btn.config(state="disabled"); self.btn_stop.config(state="normal"); self.btn_pauza.config(state="normal", text="⏸ Pauză")
        self.btn_open.config(state="disabled")
        import vizualizare
        if not (self.viz and self.viz.winfo_exists()): self.viz = vizualizare.Vizualizare(self.root, self.comuta_pauza)
        self.viz.lift()
        threading.Thread(target=self.work, args=(list(self.files), self.out.get(), self.viz.q), daemon=True).start()

    def comuta_pauza(self):
        if not self.running: return
        self.pauza = not self.pauza
        self.btn_pauza.config(text="▶ Continuă" if self.pauza else "⏸ Pauză")
        self.status.config(text="În pauză – poți da înapoi în fereastra cu hărțile." if self.pauza else "Se continuă…")
        if self.viz and self.viz.winfo_exists(): self.viz.arata_pauza(self.pauza)

    def interval(self):
        """(de la, până la) în ms din câmpurile mm:ss; None dacă sunt goale."""
        import vizualizare
        a, b = vizualizare.citeste_timp(self.t_de.get()), vizualizare.citeste_timp(self.t_pana.get())
        return None if a is None and b is None else (a or 0, b)

    def cancel(self):
        self.stop = True; self.status.config(text="Se oprește…")

    def work(self, files, out, vq):
        try:
            model = analiza.Model(self.model_path())
            n = len(files)
            for k, z in enumerate(files):
                t0 = time.time()
                def prog(frac, text, cnt, k=k, t0=t0):
                    el = time.time() - t0
                    # timpul rămas: din ritmul de până acum (filmarea curentă + cele care urmează, cam la fel de lungi)
                    rest = el / frac * (1 - frac) + (n - k - 1) * el / frac if frac > 0.03 else None
                    self.q.put(("prog", (k + frac) / n, f"Filmarea {k + 1} din {n} · {frac * 100:.0f}% · {text}", rest, cnt))
                self.q.put(("prog", k / n, f"Filmarea {k + 1} din {n}: se pregătește…", None, None))
                self.results.append(analiza.analizeaza(z, model, out, prog, lambda: self.stop, viz=lambda *a: vq.put(a),
                                                        pauza=lambda: self.pauza, interval=self._interval))
                if self.stop: break                         # filmările rămase nu mai pornesc
            self.q.put(("done", "oprit" if self.stop else None))
        except Exception as e:
            if str(e).startswith("oprit"): self.q.put(("log", "Oprit."))
            else: self.q.put(("err", panouri.text_eroare(e)))
            self.q.put(("done", str(e)))

    def poll(self):
        try:
            while True:
                m = self.q.get_nowait()
                if m[0] == "log": self.log(m[1])
                elif m[0] == "err": self.eroare(m[1])
                elif m[0] == "prog":
                    _, frac, text, rest, cnt = m
                    self.pb["value"] = frac * 1000
                    self.status.config(text=text)
                    self.eta.config(text=f"Mai durează ~{durata(rest)}" if rest is not None else "Se calculează timpul rămas…")
                    if cnt is not None:
                        for k, lab in self.cnt.items(): lab.config(text=str(cnt.get(k, 0)))
                elif m[0] == "done":
                    self.running = False; self.pauza = False; self.btn.config(state="normal"); self.btn_stop.config(state="disabled")
                    self.btn_pauza.config(state="disabled", text="⏸ Pauză")
                    if self.results: self.btn_open.config(state="normal")
                    if m[1] is None:
                        self.pb["value"] = 1000; self.eta.config(text="")
                        self.status.config(text=f"Gata: {len(self.results)} filmări analizate.")
                    else:
                        if str(m[1]).startswith("oprit"):
                            self.status.config(text="Oprit – rezultatul de până acum e salvat (Deschide / Export GDB / portal)."
                                               if self.results else "Oprit.")
                        else:
                            self.status.config(text=f"Eroare: {m[1]}")
        except queue.Empty:
            pass
        self.root.after(150, self.poll)

    # ---------------------------------------------------- după analiză
    def open_result(self):
        if self.results and os.name == "nt": os.startfile(self.results[-1])

    # ---------------------------------------------------- jurnal și debug
    def log(self, s):
        self.jurnal.append(s); panouri.scrie_jurnal(s)
        self.txt.insert("end", s + "\n"); self.txt.see("end")
        if self.dbg and self.dbg.winfo_exists(): self.dbg.add(s)

    def debug(self):
        if self.dbg and self.dbg.winfo_exists(): self.dbg.lift(); return
        self.dbg = panouri.Debug(self.root, self.jurnal, panouri.info_sistem(self.model_name()))

    def eroare(self, e, mesaj=None):
        """O eroare: în jurnal, panoul de debug se deschide singur, plus un mesaj scurt dacă e cazul."""
        text = e if isinstance(e, str) else panouri.text_eroare(e)
        self.log(text); self.debug()
        if mesaj: messagebox.showerror(TITLU, mesaj + "\n\nDetaliile sunt în panoul de debug.", parent=self.dbg)

    # ---------------------------------------------------- modelele de analiză
    MODELE = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "DrumRM", "modele")
    SETARI = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "DrumRM", "setari.json")

    def modele(self):
        """{nume afișat: cale} – cele incluse în program și cele adăugate de tine."""
        out = {}
        for d, eticheta in ((os.path.join(analiza.date_dir(), "model"), "inclus"), (self.MODELE, "adăugat")):
            if not os.path.isdir(d): continue
            for f in sorted(os.listdir(d)):
                if f.lower().endswith((".onnx", ".pt", ".tflite")):
                    out[f"{f}  ({eticheta})"] = os.path.join(d, f)
        return out

    def setari(self, **kw):
        import json
        try: s = json.load(open(self.SETARI, encoding="utf-8"))
        except Exception: s = {}
        if kw:
            s.update(kw); os.makedirs(os.path.dirname(self.SETARI), exist_ok=True)
            json.dump(s, open(self.SETARI, "w", encoding="utf-8"), ensure_ascii=False)
        return s

    def incarca_modele(self, alege=None):
        m = self.modele(); self.cb_model["values"] = list(m)
        dorit = alege or self.setari().get("model")
        nume = next((k for k, v in m.items() if v == dorit), None) or next((k for k in m if ".onnx" in k), None) or next(iter(m), "")
        self.model.set(nume); self.model_ales(salveaza=False)

    def model_ales(self, salveaza=True):
        p = self.model_path()
        if not p: self.minfo.config(text="niciun model"); return
        ext = os.path.splitext(p)[1].lower()
        desc = {".onnx": "rulează pe procesor", ".pt": "PyTorch – placa video, doar varianta .bat", ".tflite": "TensorFlow Lite – procesor"}[ext]
        self.minfo.config(text=f"{os.path.basename(p)} · {os.path.getsize(p) / 1048576:.1f} MB · {desc}")
        if salveaza: self.setari(model=p); self.log(f"Model ales: {os.path.basename(p)}")

    def model_path(self):
        return self.modele().get(self.model.get(), "")

    def model_name(self):
        return os.path.basename(self.model_path())

    def adauga_model(self):
        import shutil
        f = filedialog.askopenfilename(title="Modelul de detectare", filetypes=[("Modele", "*.onnx *.pt *.tflite"), ("Toate", "*.*")])
        if not f: return
        os.makedirs(self.MODELE, exist_ok=True); dest = os.path.join(self.MODELE, os.path.basename(f))
        if os.path.exists(dest) and not messagebox.askyesno(TITLU, f"{os.path.basename(f)} există deja. Îl înlocuiesc?"): return
        try:
            shutil.copy2(f, dest)
            lab = os.path.join(os.path.dirname(f), "labels.txt")          # etichetele modelului, dacă stau lângă el
            if os.path.exists(lab): shutil.copy2(lab, os.path.splitext(dest)[0] + ".labels.txt")
        except Exception as e:
            self.eroare(e, f"Nu s-a putut adăuga modelul: {e}"); return
        self.incarca_modele(alege=dest); self.setari(model=dest); self.log(f"Model adăugat: {os.path.basename(f)}")

    def result_folders(self, ce):
        """Rezultatele de acum sau, dacă n-ai analizat nimic acum, un folder de rezultat ales (cu Drum.gdb)."""
        if self.results: return self.results
        d = filedialog.askdirectory(title=f"Folderul rezultatului pentru {ce} (cel cu Drum.gdb)", initialdir=self.out.get())
        if not d: return []
        if d.lower().endswith(".gdb"): d = os.path.dirname(d)
        if not os.path.isdir(os.path.join(d, "Drum.gdb")):
            messagebox.showerror(TITLU, "În folderul ales nu e Drum.gdb.\n\nAlege folderul cu numele filmării din "
                                 f"{self.out.get()} (de exemplu …\\DrumFilm_2026-10-19_21-17)."); return []
        return [d]

    def export_gdb(self):
        import shutil
        rez = self.result_folders("export")
        if not rez: return
        dest = filedialog.askdirectory(title="Unde salvez GDB-ul pentru ArcGIS / ArcGIS Pro")
        if not dest: return
        gata = []
        try:
            for r in rez:
                t = os.path.join(dest, os.path.basename(os.path.normpath(r)) + ".gdb")
                if os.path.exists(t):
                    if not messagebox.askyesno(TITLU, f"{t} există deja. Îl înlocuiesc?"): continue
                    shutil.rmtree(t)
                shutil.copytree(os.path.join(r, "Drum.gdb"), t)                # pozele sunt atașamente în GDB
                gata.append(t)
        except Exception as e:
            self.eroare(e, f"Exportul GDB a eșuat: {e}"); return
        if gata:
            self.log("Export GDB: " + ", ".join(gata))
            messagebox.showinfo(TITLU, "GDB salvat:\n" + "\n".join(gata) +
                                "\n\nÎn ArcGIS Pro: Catalog → Add Folder Connection → trage straturile pe hartă.\n"
                                "Pozele sunt atașate la puncte (Attachments).")

    def send_portal(self):
        import trimite_portal
        def login():
            mail = simpledialog.askstring(TITLU, "Emailul contului de pe portal:", parent=self.root)
            if not mail: return None
            pw = simpledialog.askstring(TITLU, "Parola (nu se salvează):", show="•", parent=self.root)
            return (mail, pw) if pw else None
        try:
            rez = self.result_folders("portal")
            if not rez: return
            for r in rez:
                trimite_portal.trimite(r, login=login, log=lambda s: (self.log(s), self.root.update()))
            messagebox.showinfo(TITLU, "Salvat în „Conținutul meu” pe portal.")
        except SystemExit as e:
            messagebox.showerror(TITLU, str(e))
        except Exception as e:
            self.eroare(panouri.text_eroare(e), f"Nu s-a putut salva pe portal: {e}")


def main():
    root = TkinterDnD.Tk() if _DND else tk.Tk()
    App(root, [a for a in sys.argv[1:] if a.lower().endswith(".zip")])
    root.mainloop()


if __name__ == "__main__":
    main()
