"""Panoul de debug (erorile cu tot
detaliul, jurnalul, datele calculatorului – de copiat sau salvat ca raport)."""
import datetime, os, platform, sys, traceback
import tkinter as tk
from tkinter import filedialog
from stil import Buton, FONT, CARD, GRI, ROSU, ANTET

JURNAL = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "DrumRM", "jurnal.log")


def scrie_jurnal(text):
    """Tot ce apare în program ajunge și în %APPDATA%\\DrumRM\\jurnal.log (se păstrează ~2 MB)."""
    try:
        os.makedirs(os.path.dirname(JURNAL), exist_ok=True)
        if os.path.exists(JURNAL) and os.path.getsize(JURNAL) > 2_000_000: os.replace(JURNAL, JURNAL + ".vechi")
        with open(JURNAL, "a", encoding="utf-8") as f: f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S}  {text}\n")
    except OSError:
        pass



class Debug(tk.Toplevel):
    """Erorile cu tot detaliul. Se deschide singur la o eroare sau din butonul 🐞 Debug."""

    def __init__(self, root, jurnal, info):
        super().__init__(root, bg=CARD); self.title("Debug – Drum RM"); self.geometry("860x560")
        tk.Label(self, text="🐞  Debug", bg=ANTET, fg="white", font=(FONT, 12, "bold"), anchor="w", padx=14, pady=8).pack(fill="x")
        tk.Label(self, text="Dacă ceva nu merge: apasă „Copiază tot” și trimite textul (sau „Salvează raportul…”).",
                 anchor="w", bg=CARD, fg=GRI, font=(FONT, 9)).pack(fill="x", padx=14, pady=(8, 2))
        self.txt = tk.Text(self, font=("Consolas", 9), wrap="none", bd=0, bg="#f7f9fb", fg="#3a4652")
        self.txt.pack(fill="both", expand=True, padx=14, pady=4)
        self.txt.tag_config("err", foreground=ROSU, background="#fdf0f0")
        r = tk.Frame(self, bg=CARD); r.pack(fill="x", padx=14, pady=(4, 12))
        Buton(r, "📋 Copiază tot", self.copy, tip="albastru").pack(side="left")
        Buton(r, "💾 Salvează raportul…", self.save).pack(side="left", padx=6)
        Buton(r, "📄 Deschide jurnalul", lambda: os.name == "nt" and os.path.exists(JURNAL) and os.startfile(JURNAL)).pack(side="left")
        Buton(r, "Închide", self.destroy).pack(side="right")
        self.txt.insert("end", "=== Calculatorul și programul ===\n" + "\n".join(f"{k}: {v}" for k, v in info.items()) + "\n\n=== Jurnal ===\n")
        for s in jurnal: self.add(s)

    def add(self, s):
        self.txt.insert("end", s + "\n", "err" if s.startswith(("EROARE", "Traceback")) or "Error" in s else ""); self.txt.see("end")

    def copy(self):
        self.clipboard_clear(); self.clipboard_append(self.txt.get("1.0", "end"))

    def save(self):
        p = filedialog.asksaveasfilename(parent=self, defaultextension=".txt", initialfile=f"DrumRM_debug_{datetime.datetime.now():%Y%m%d_%H%M}.txt")
        if p: open(p, "w", encoding="utf-8").write(self.txt.get("1.0", "end"))


def info_sistem(model):
    d = {"Model": model, "Python": sys.version.split()[0],
         "Windows": platform.platform(), "Procesor": platform.processor() or "?", "Nuclee": os.cpu_count(),
         "Folder program": os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__)),
         "Jurnal": JURNAL}
    for k, mod in (("GDAL", "osgeo.gdal"), ("OpenCV", "cv2"), ("onnxruntime", "onnxruntime"), ("pyproj", "pyproj")):
        try: d[k] = getattr(__import__(mod, fromlist=["x"]), "__version__", "?")
        except Exception as e: d[k] = f"LIPSĂ ({e})"
    return d


def text_eroare(e):
    return "EROARE: " + "".join(traceback.format_exception(type(e), e, e.__traceback__)).rstrip()
