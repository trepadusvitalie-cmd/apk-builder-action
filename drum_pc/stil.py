"""Aspectul ferestrei: culori, butoane plate cu efect la trecerea mouse-ului, carduri."""
import tkinter as tk
from tkinter import ttk

FONT = "Segoe UI"
BG = "#eef1f4"; CARD = "#ffffff"; MARGINE = "#dde2e8"; TEXT = "#1f2933"; GRI = "#6b7785"
VERDE = "#2e7d32"; ROSU = "#c62828"; ALBASTRU = "#1d5fa8"; PORTOCALIU = "#b35c00"; ANTET = "#17324d"

# (fundal, fundal sub mouse, text)
TIPURI = {"principal": (VERDE, "#3b8f40", "#ffffff"), "albastru": (ALBASTRU, "#2a6fbd", "#ffffff"),
          "rosu": (ROSU, "#d63a3a", "#ffffff"), "simplu": ("#ffffff", "#eef3f8", TEXT),
          "antet": (ANTET, "#24476b", "#ffffff")}


class Buton(tk.Label):
    """Buton plat: își schimbă culoarea sub mouse; config(state="disabled") îl stinge."""

    def __init__(self, master, text, command, tip="simplu", mare=False, **kw):
        self.c = TIPURI[tip]; self.command = command
        super().__init__(master, text=text, bg=self.c[0], fg=self.c[2], cursor="hand2",
                         font=(FONT, 11 if mare else 10, "bold"), padx=18 if mare else 12, pady=9 if mare else 6,
                         disabledforeground="#a9b1bb", highlightthickness=1 if tip == "simplu" else 0,
                         highlightbackground=MARGINE, **kw)
        self.bind("<Enter>", lambda e: self._ok() and self.configure(bg=self.c[1]))
        self.bind("<Leave>", lambda e: self.configure(bg=self.c[0]))
        self.bind("<ButtonRelease-1>", lambda e: self._ok() and self.command())

    def _ok(self): return str(self.cget("state")) != "disabled"

    def configure(self, cnf=None, **kw):
        if kw.get("state") == "disabled": kw.setdefault("bg", "#e4e8ec"); kw["cursor"] = "arrow"
        elif kw.get("state") == "normal": kw.setdefault("bg", self.c[0]); kw["cursor"] = "hand2"
        return super().configure(cnf, **kw)
    config = configure


def card(master, titlu=None, **pack):
    """Un card alb cu titlu; întoarce interiorul."""
    out = tk.Frame(master, bg=CARD, highlightthickness=1, highlightbackground=MARGINE)
    out.pack(fill="both" if pack.get("expand") else "x", padx=14, pady=(0, 10), **pack)
    if titlu: tk.Label(out, text=titlu, bg=CARD, fg=GRI, font=(FONT, 9, "bold"), anchor="w").pack(fill="x", padx=12, pady=(8, 0))
    inner = tk.Frame(out, bg=CARD); inner.pack(fill="both", expand=True, padx=12, pady=(4, 10))
    return inner


def teme(root):
    root.configure(bg=BG)
    s = ttk.Style(root)
    try: s.theme_use("clam")
    except tk.TclError: pass
    s.configure("Drum.Horizontal.TProgressbar", troughcolor="#e4e8ec", background=VERDE, bordercolor="#e4e8ec",
                lightcolor=VERDE, darkcolor=VERDE, thickness=14)
