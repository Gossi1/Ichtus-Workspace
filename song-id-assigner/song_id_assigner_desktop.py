#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SONG ID ASSIGNER — desktop edition (tkinter)
=============================================
Dezelfde logica als de web-app (song-id-assigner/js/app.js), maar dan als
lokale Python desktop-app — geen browser of server nodig.

  - Bibliotheek: song-id-assigner/library-ids.json — het ZELFDE bestand
    als de webversie, dus de data is uitwisselbaar tussen beide apps.
  - Importeer via het klembord (kopieer de liederenlijst uit WorshipTools
    en klik op "Importeer uit klembord") of via een plak-venster.
  - De import-preview splitst in 4 kolommen:
      Met ID / Zonder ID / Alternatieve titel / Dubbele
    Een EN-origineel met een NL-vertaling onder hetzelfde ID wordt
    gekoppeld als alternatieve titel i.p.v. overgeslagen.
  - Na bevestigen toont een resultaat-paneel wat is toegevoegd, welke
    vertalingen zijn gekoppeld en wat er is overgeslagen + waarom.

Start:  python song_id_assigner_desktop.py
        (of dubbelklik op "Song ID Assigner.bat")
"""

import json
import os
import re
import time
import tkinter as tk
from tkinter import scrolledtext, ttk, messagebox, filedialog

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------

DATA_FILE = 'library-ids.json'  # same file the web app / server.py uses

BG = '#12141a'
CARD = '#181d28'
PANEL = '#1a1f2b'
BORDER = '#2a3142'
TEXT = '#e8e6e3'
DIM = '#9aa4b2'
ACCENT = '#fbbf24'
GREEN = '#34d399'
RED = '#f87171'
BLUE = '#60a5fa'

FONT = ('Segoe UI', 10)
BOLD = ('Segoe UI', 10, 'bold')
BOLD_LARGE = ('Segoe UI', 15, 'bold')
TITLE_FONT = ('Segoe UI', 17, 'bold')
CARD_TITLE = ('Segoe UI', 12, 'bold')

PREFIX_RE = re.compile(r'^([A-Za-z]{1,4})\s*(\d{1,4})(?:\s|-|\.|$)(.*)$')
PREFIX_PATTERN = re.compile(r'^[A-Z]{1,4}$')


def data_path():
    """Absolute path to the shared library-ids.json."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), DATA_FILE)


# ---------------------------------------------------------------------------
#  Pure logic — 1:1 port of song-id-assigner/js/app.js
# ---------------------------------------------------------------------------

def normalize_title(t):
    """'Great I Am!' → 'great i am' (Unicode letters/numbers kept, like \p{L}\p{N})."""
    chars = ''.join(c if c.isalnum() else ' ' for c in str(t or '').lower())
    return ' '.join(chars.split())


def parse_line(line, artist=None):
    """
    'D044 Great I Am'  → {prefix:'D', number:'044', id:'D044', title:'Great I Am'}
    'LvK 9 ...'        → {prefix:'LvK', number:'9', ...}
    'Great I Am'       → {title:'Great I Am'}  (no id)
    """
    text = str(line or '').strip()
    if not text:
        return None
    m = PREFIX_RE.match(text)
    if m and m.group(1) and m.group(2):
        prefix = m.group(1)
        number = m.group(2)
        rest = m.group(3).strip()
        parsed = {'prefix': prefix, 'number': number,
                  'id': prefix + number, 'title': rest or text}
        if artist:
            parsed['artist'] = artist
        return parsed
    parsed = {'title': text}
    if artist:
        parsed['artist'] = artist
    return parsed


class SongLibrary:
    """Model layer — mirrors the web app's state + logic exactly."""

    def __init__(self, path=None):
        self.path = path or data_path()
        self.songs = []      # [{uid, id, prefix, number, title, artist, altTitles}]
        self._uid_seq = 0

    # -- uid ----------------------------------------------------------------
    def new_uid(self):
        self._uid_seq += 1
        return 's%d-%s' % (self._uid_seq, format(int(time.time() * 1000), 'x'))

    def ensure_uid(self, s):
        if not s:
            return s
        if not s.get('uid'):
            s['uid'] = self.new_uid()
        if not isinstance(s.get('altTitles'), list):
            s['altTitles'] = []
        s.pop('source', None)  # 'bron' is weg — legacy veld opschonen bij het laden
        return s

    # -- titles & alt titles ------------------------------------------------
    @staticmethod
    def song_titles(s):
        titles = [s.get('title')] + list(s.get('altTitles') or [])
        return [t for t in titles if t]

    def song_has_title(self, s, norm):
        return any(normalize_title(t) == norm for t in self.song_titles(s))

    def find_song_by_title(self, norm, exclude_uid=None):
        for s in self.songs:
            if s.get('uid') != exclude_uid and self.song_has_title(s, norm):
                return s
        return None

    def find_song_by_id(self, song_id):
        for s in self.songs:
            if s.get('id') == song_id:
                return s
        return None

    def add_alt_title(self, song, title):
        """Add a translation as alt title. Returns True when actually added."""
        t = str(title or '').strip()
        if not t or not song:
            return False
        if self.song_has_title(song, normalize_title(t)):
            return False
        song.setdefault('altTitles', [])
        song['altTitles'].append(t)
        return True

    # -- numbering — 'hoogste + 1', keep per-prefix number format -----------
    def songs_for_prefix(self, prefix):
        return [s for s in self.songs if s.get('prefix') == prefix]

    def max_number_for(self, prefix):
        mx = 0
        for s in self.songs_for_prefix(prefix):
            try:
                n = int(s.get('number'))
            except (TypeError, ValueError):
                continue
            if n > mx:
                mx = n
        return mx

    def format_for(self, prefix):
        """'D044' → 3 digits zero-padded; 'LvK 9' → no padding. New prefix → 3 digits."""
        existing = [s.get('number') for s in self.songs_for_prefix(prefix) if s.get('number')]
        if not existing:
            return {'width': 3, 'pad': True}
        has_pad = any(len(n) > 1 and n.startswith('0') for n in existing)
        max_len = max(len(n) for n in existing)
        return {'width': max(max_len if has_pad else 1, 1), 'pad': has_pad}

    def format_number(self, prefix, num):
        fmt = self.format_for(prefix)
        s = str(num)
        return s.zfill(fmt['width']) if fmt['pad'] else s

    def next_number_for(self, prefix):
        candidate = self.max_number_for(prefix) + 1
        taken = set(s.get('number') for s in self.songs_for_prefix(prefix))
        while self.format_number(prefix, candidate) in taken:
            candidate += 1
        return candidate

    def canonical_id(self, prefix, number):
        try:
            n = int(number) or 0
        except (TypeError, ValueError):
            n = 0
        return prefix + self.format_number(prefix, n)

    # -- duplicate check ----------------------------------------------------
    def find_duplicates(self, prefix, number, title, exclude_uid=None):
        """Checks for an already-used ID or an already-known title. exclude_uid
        lets 'assign' skip the song being assigned itself (it is already in
        self.songs), so the title check doesn't trip on itself."""
        issues = []
        normalized = normalize_title(title)
        song_id = self.canonical_id(prefix, number)
        if any(s.get('id') == song_id for s in self.songs):
            issues.append('ID ' + song_id + ' bestaat al')
        if normalized:
            same = self.find_song_by_title(normalized, exclude_uid)
            if same:
                issues.append('"' + same.get('title') + '" staat al in de bibliotheek als '
                              + str(same.get('id') or 'zonder ID'))
        return issues

    # -- import classification ----------------------------------------------
    def classify_import(self, p, ctx):
        """
        Bucket one parsed import item:
          'withId' → new ID → left column
          'noId'   → no ID yet → stored for later assignment
          'alt'    → same ID, different title → merge as alternative title
          'dupe'   → truly already known
        ctx = {'seen_titles': {}, 'seen_ids': {}} shared across the batch.
        """
        norm = normalize_title(p.get('title'))
        prev = ctx['seen_titles'].get(norm)
        if p.get('prefix') and p.get('number'):
            song_id = self.canonical_id(p['prefix'], p['number'])
            existing = ctx['seen_ids'].get(song_id) or self.find_song_by_id(song_id)
            if existing:
                if self.song_has_title(existing, norm):
                    return {'bucket': 'dupe',
                            'reason': '"%s" staat al aan ID %s gekoppeld' % (p['title'], existing['id'])}
                return {'bucket': 'alt', 'targetId': song_id,
                        'reason': 'wordt toegevoegd als alternatieve titel bij ' + song_id}
            title_song = self.find_song_by_title(norm)
            if not title_song:
                for s in ctx['seen_ids'].values():
                    if self.song_has_title(s, norm):
                        title_song = s
                        break
            if title_song:
                return {'bucket': 'dupe',
                        'reason': '"%s" bestaat al als %s' % (p['title'], title_song['id'])}
            if prev:
                return {'bucket': 'dupe', 'reason': 'komt al voor in deze import als ' + str(prev)}
            if norm not in ctx['seen_titles']:
                ctx['seen_titles'][norm] = song_id
            return {'bucket': 'withId', 'id': song_id}
        # No ID yet — check library (incl. alt titles) then batch.
        lib_same = self.find_song_by_title(norm)
        if not lib_same:
            for s in ctx['seen_ids'].values():
                if self.song_has_title(s, norm):
                    lib_same = s
                    break
        if lib_same:
            return {'bucket': 'dupe',
                    'reason': '"%s" staat al in de bibliotheek als %s'
                              % (lib_same['title'], lib_same.get('id') or 'zonder ID')}
        if prev:
            return {'bucket': 'dupe', 'reason': 'komt al voor in deze import als ' + str(prev)}
        if norm not in ctx['seen_titles']:
            ctx['seen_titles'][norm] = p['title']
        return {'bucket': 'noId'}

    def apply_import(self, parsed):
        """
        Confirm an import — the same classifier + ctx as the preview, so what
        you see in the preview is exactly what gets added/skipped/merged.
        Returns {'added', 'noId', 'merged', 'merged_list', 'skipped_list'}.
        """
        added = skipped = no_id = merged = 0
        skipped_list = []
        merged_list = []
        ctx = {'seen_titles': {}, 'seen_ids': {}}
        for p in parsed:
            if not p:
                continue
            cls = self.classify_import(p, ctx)
            if cls['bucket'] == 'dupe':
                skipped += 1
                skipped_list.append({'id': p.get('id'), 'title': p.get('title'),
                                     'artist': p.get('artist'), 'reason': cls['reason']})
                continue
            if cls['bucket'] == 'alt':
                target = ctx['seen_ids'].get(cls['targetId']) or self.find_song_by_id(cls['targetId'])
                if target and self.add_alt_title(target, p.get('title')):
                    merged += 1
                    merged_list.append({'id': target.get('id'), 'title': p.get('title'),
                                        'artist': p.get('artist')})
                elif not target:
                    skipped += 1
                    skipped_list.append({'id': p.get('id'), 'title': p.get('title'),
                                         'artist': p.get('artist'),
                                         'reason': 'doel ' + cls['targetId'] + ' niet gevonden'})
                continue
            if cls['bucket'] == 'noId':
                self.songs.append({'uid': self.new_uid(), 'id': '', 'prefix': '', 'number': '',
                                   'title': p['title'], 'artist': p.get('artist') or '',
                                   'altTitles': []})
                no_id += 1
                added += 1
                continue
            # withId
            try:
                n = int(p['number'])
            except (TypeError, ValueError):
                n = 0
            number = self.format_number(p['prefix'], n)
            song = {'uid': self.new_uid(), 'id': p['prefix'] + number, 'prefix': p['prefix'],
                    'number': number, 'title': p['title'], 'artist': p.get('artist') or '',
                    'altTitles': []}
            self.songs.append(song)
            ctx['seen_ids'][song['id']] = song
            added += 1
        return {'added': added, 'noId': no_id, 'merged': merged,
                'merged_list': merged_list, 'skipped_list': skipped_list}

    # -- add / assign / remove ----------------------------------------------
    def add_song(self, title, prefix):
        """Manual add. Returns (ok, message). Empty prefix → stored 'zonder ID'."""
        title = (title or '').strip()
        prefix = (prefix or '').strip().upper()
        if not title:
            return False, '❌ Vul een titel in'
        if prefix and not PREFIX_PATTERN.match(prefix):
            return False, '❌ ID letter: 1–4 letters (bijv. D, H, O, OK, K, LvK) — of leeg laten voor "zonder ID"'
        existing = self.find_song_by_title(normalize_title(title))
        if existing:
            return False, '❌ "%s" staat al in de bibliotheek als %s — niet opnieuw toegevoegd.' \
                          % (title, existing.get('id') or 'zonder ID')
        if not prefix:
            self.songs.append({'uid': self.new_uid(), 'id': '', 'prefix': '', 'number': '',
                               'title': title, 'artist': '', 'altTitles': []})
            return True, '✅ Toegevoegd zonder ID: %s — ken later een letter toe in de rechterkolom.' % title
        number = self.next_number_for(prefix)
        song_id = prefix + self.format_number(prefix, number)
        issues = self.find_duplicates(prefix, number, title)
        if issues:
            return False, '⚠️ ' + issues[0]
        self.songs.append({'uid': self.new_uid(), 'id': song_id, 'prefix': prefix,
                           'number': self.format_number(prefix, number), 'title': title,
                           'artist': '', 'altTitles': []})
        return True, '✅ Toegevoegd: %s — %s' % (song_id, title)

    def assign_id(self, song, prefix):
        """Operator picks the letter, the app picks the next free number."""
        if not song:
            return False, ''
        if song.get('id'):
            return False, '⚠️ "%s" heeft al een ID (%s)' % (song.get('title'), song['id'])
        prefix = (prefix or '').strip().upper()
        if not prefix:
            return False, '⚠️ Kies een letter (bijv. D, H, OK)'
        if not PREFIX_PATTERN.match(prefix):
            return False, '⚠️ Letter: 1–4 letters (bijv. D, H, O, OK, K, LvK)'
        existing = self.find_song_by_title(normalize_title(song.get('title')), song.get('uid'))
        if existing:
            return False, '⚠️ "%s" bestaat al als %s' % (song['title'], existing.get('id') or 'zonder ID')
        number = self.next_number_for(prefix)
        song_id = prefix + self.format_number(prefix, number)
        issues = self.find_duplicates(prefix, number, song.get('title'), song.get('uid'))
        if issues:
            return False, '⚠️ ' + issues[0]
        song['prefix'] = prefix
        song['number'] = self.format_number(prefix, number)
        song['id'] = song_id
        return True, '✅ %s toegekend aan "%s"' % (song_id, song['title'])

    def remove_by_uid(self, uid):
        self.songs = [s for s in self.songs if s.get('uid') != uid]

    # -- persistence ---------------------------------------------------------
    def save(self, path=None):
        path = path or self.path
        payload = {'schemaVersion': 1,
                   'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
                   'songs': self.songs}
        # Safety net (parity with server.py /api/library/save): keep a
        # rotating .bak of the PREVIOUS file so a bad write is always
        # undoable by hand — copy first, then overwrite.
        try:
            import shutil as _shutil
            if os.path.exists(path):
                _shutil.copy2(path, path + '.bak')
        except Exception:
            pass  # backup is best-effort, never blocks the save
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return len(self.songs)

    def load(self, path=None):
        path = path or self.path
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (OSError, ValueError):
            self.songs = []
            return
        songs = data.get('songs') if isinstance(data, dict) else None
        self.songs = [self.ensure_uid(dict(s)) for s in (songs or []) if isinstance(s, dict)]


# ---------------------------------------------------------------------------
#  GUI — dark tkinter
# ---------------------------------------------------------------------------

class App:
    def __init__(self, root, lib=None):
        self.root = root
        self.lib = lib or SongLibrary()
        self._status_job = None
        self._noid_songs = []          # currently shown no-ID rows (listbox order)
        self._pending_parsed = []      # awaiting preview confirmation

        self.search_var = tk.StringVar()
        self.add_title_var = tk.StringVar()
        self.add_prefix_var = tk.StringVar()
        self.assign_var = tk.StringVar()

        self._build_style()
        self._build_ui()
        self.add_prefix_var.trace_add('write', lambda *a: self.update_next_id())
        self.search_var.trace_add('write', lambda *a: self.render_library())
        self.lib.load()
        self.render_all()
        self.set_status('✅ Bibliotheek geladen (' + str(len(self.lib.songs)) + ' liederen)', 'ok')
        root.protocol('WM_DELETE_WINDOW', self.on_close)

    # -- styling -------------------------------------------------------------
    def _build_style(self):
        self.style = ttk.Style(self.root)
        style = self.style
        style.theme_use('clam')
        style.configure('.', background=BG, foreground=TEXT, fieldbackground=PANEL,
                        bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER,
                        troughcolor=PANEL, font=FONT)
        style.configure('TButton', background='#232b3d', foreground=TEXT, borderwidth=1,
                        focusthickness=0, padding=(12, 6))
        style.map('TButton',
                  background=[('active', '#2c3550'), ('disabled', '#1d2230')],
                  foreground=[('disabled', '#5a6270')])
        style.configure('Accent.TButton', background='#4d3c10', foreground=ACCENT)
        style.map('Accent.TButton', background=[('active', '#5c4913')])
        style.configure('Green.TButton', background='#123a2c', foreground=GREEN)
        style.map('Green.TButton', background=[('active', '#164a37')])
        style.configure('Danger.TButton', background='#3d1420', foreground=RED)
        style.map('Danger.TButton', background=[('active', '#4a1a28')])
        style.configure('TEntry', fieldbackground=PANEL, foreground=TEXT, insertcolor=TEXT,
                        bordercolor=BORDER, padding=4)
        style.configure('Treeview', background=PANEL, fieldbackground=PANEL, foreground=TEXT,
                        borderwidth=0, rowheight=26)
        style.map('Treeview', background=[('selected', '#2b3650')],
                  foreground=[('selected', TEXT)])
        style.configure('Treeview.Heading', background='#222838', foreground='#c3cbd8',
                        font=('Segoe UI', 9, 'bold'), relief='flat')
        style.configure('Vertical.TScrollbar', background='#232b3d', troughcolor=BG,
                        bordercolor=BG, arrowcolor=DIM)

    # -- main layout ---------------------------------------------------------
    def _build_ui(self):
        self.root.title('Song ID Assigner — desktop')
        self.root.configure(bg=BG)
        self.root.geometry('1080x790')
        self.root.minsize(900, 620)
        try:
            img = tk.PhotoImage(file=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icon.png'))
            self.root.iconphoto(True, img)
            self._icon = img
        except Exception:
            pass

        # Scrollable main area
        canvas = tk.Canvas(self.root, bg=BG, highlightthickness=0)
        vsb = ttk.Scrollbar(self.root, orient='vertical', command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        inner = tk.Frame(canvas, bg=BG)
        inner_id = canvas.create_window((0, 0), window=inner, anchor='nw')

        def _sync_width(e):
            canvas.itemconfigure(inner_id, width=e.width)
        canvas.bind('<Configure>', _sync_width)

        def _sync_scroll(e):
            canvas.configure(scrollregion=canvas.bbox('all'))
        inner.bind('<Configure>', _sync_scroll)

        def _on_wheel(e):
            w = self.root.winfo_containing(e.x_root, e.y_root)
            if w is not None and w.winfo_class() in ('Text', 'Listbox', 'Treeview', 'Scrollbar', 'TScrollbar'):
                return  # those handle their own wheel
            canvas.yview_scroll(int(-e.delta / 120), 'units')
        self.root.bind_all('<MouseWheel>', _on_wheel)

        canvas.grid(row=0, column=0, sticky='nsew')
        vsb.grid(row=0, column=1, sticky='ns')
        self.root.grid_rowconfigure(0, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        # header
        header = tk.Frame(inner, bg=BG)
        header.pack(fill='x', padx=18, pady=(14, 4))
        title_box = tk.Frame(header, bg=BG)
        title_box.pack(side='left')
        tk.Label(title_box, text='🎵 Song ID Assigner', bg=BG, fg=TEXT,
                 font=TITLE_FONT).pack(anchor='w')
        tk.Label(title_box, text='Desktop-editie — jij kiest de letter, de app kiest het nummer',
                 bg=BG, fg=DIM, font=('Segoe UI', 9)).pack(anchor='w')
        self.status_lbl = tk.Label(header, text='—', bg=BG, fg=DIM, font=FONT,
                                   wraplength=520, justify='right')
        self.status_lbl.pack(side='right', padx=8)

        # stats
        stats = tk.Frame(inner, bg=BG)
        stats.pack(fill='x', padx=18, pady=(4, 0))
        self._stat_boxes = {}
        for key, icon in (('total', '🎵 liederen'), ('noid', '❓ zonder ID'),
                          ('prefixes', '🔤 prefixen')):
            box = tk.Frame(stats, bg=PANEL, highlightthickness=1,
                           highlightbackground=BORDER, padx=14, pady=6)
            box.pack(side='left', padx=(0, 10))
            tk.Label(box, text=icon, bg=PANEL, fg=DIM, font=('Segoe UI', 9)).pack(side='left')
            num = tk.Label(box, text='0', bg=PANEL, fg=ACCENT, font=BOLD_LARGE)
            num.pack(side='left', padx=(8, 0))
            self._stat_boxes[key] = num
        self.chips_lbl = tk.Label(stats, text='', bg=BG, fg=BLUE, font=FONT)
        self.chips_lbl.pack(side='left', padx=(6, 0))

        self._build_import_card(inner)
        self._build_add_card(inner)
        self._build_library_card(inner)

        # status bar
        bar = tk.Frame(self.root, bg='#0d1016')
        bar.grid(row=1, column=0, columnspan=2, sticky='ew')
        self.bar_lbl = tk.Label(bar, text='Bestand: ' + self.lib.path,
                                bg='#0d1016', fg=DIM, font=('Segoe UI', 9), anchor='w')
        self.bar_lbl.pack(fill='x', padx=14, pady=4)

    # -- cards ---------------------------------------------------------------
    def _card(self, parent):
        f = tk.Frame(parent, bg=CARD, highlightthickness=1, highlightbackground=BORDER)
        f.pack(fill='x', padx=18, pady=(10, 0))
        return f

    def _build_import_card(self, parent):
        card = self._card(parent)
        tk.Label(card, text='📥 Importeren', bg=CARD, fg=TEXT, font=CARD_TITLE).pack(anchor='w')
        tk.Label(card, text='Kopieer de liederenlijst uit WorshipTools (liederenpagina → selecteer alles → '
                            'kopiëren) en klik hieronder op "Importeer uit klembord", of plak handmatig.',
                 bg=CARD, fg=DIM, font=('Segoe UI', 9), justify='left').pack(anchor='w', pady=(2, 6))
        row = tk.Frame(card, bg=CARD)
        row.pack(fill='x')
        ttk.Button(row, text='📋 Importeer uit klembord', style='Accent.TButton',
                   command=self.on_import_clipboard).pack(side='left', padx=(0, 8))
        ttk.Button(row, text='📝 Plak lijst', command=self.open_paste_dialog).pack(side='left', padx=(0, 8))
        ttk.Button(row, text='📁 Importeren bestand', style='Accent.TButton',
                   command=self.on_import_file).pack(side='left', padx=(0, 8))
        ttk.Button(row, text='💾 Opslaan', style='Green.TButton', command=self.on_save).pack(side='right')

    def _build_add_card(self, parent):
        card = self._card(parent)
        tk.Label(card, text='➕ Nieuw lied toevoegen', bg=CARD, fg=TEXT, font=CARD_TITLE).pack(anchor='w')
        grid = tk.Frame(card, bg=CARD)
        grid.pack(fill='x', pady=(6, 2))
        tk.Label(grid, text='Titel', bg=CARD, fg=DIM, font=('Segoe UI', 9)).grid(row=0, column=0, sticky='w')
        tk.Label(grid, text='ID letter (optioneel)', bg=CARD, fg=DIM, font=('Segoe UI', 9)).grid(row=0, column=1, sticky='w', padx=(10, 0))
        tk.Label(grid, text='Volgende nummer', bg=CARD, fg=DIM, font=('Segoe UI', 9)).grid(row=0, column=2, sticky='w', padx=(10, 0))
        ttk.Entry(grid, textvariable=self.add_title_var, width=40).grid(row=1, column=0, sticky='we')
        ttk.Entry(grid, textvariable=self.add_prefix_var, width=14).grid(row=1, column=1, sticky='w', padx=(10, 0))
        self.next_id_lbl = tk.Label(grid, text='—', bg=CARD, fg=ACCENT, font=BOLD)
        self.next_id_lbl.grid(row=1, column=2, sticky='w', padx=(10, 0))
        ttk.Button(grid, text='Voeg toe', command=self.on_add_song).grid(row=1, column=3, sticky='w', padx=(14, 0))
        tk.Label(card, text='💡 Laat de letter leeg om een lied zonder ID op te slaan — ken de letter later toe in de rechterkolom.',
                 bg=CARD, fg=DIM, font=('Segoe UI', 9)).pack(anchor='w', pady=(4, 0))

    def _build_library_card(self, parent):
        card = self._card(parent)
        head = tk.Frame(card, bg=CARD)
        head.pack(fill='x')
        tk.Label(head, text='📚 Bibliotheek', bg=CARD, fg=TEXT, font=CARD_TITLE).pack(side='left')
        self.lib_count_lbl = tk.Label(head, text='0', bg=CARD, fg=ACCENT, font=BOLD)
        self.lib_count_lbl.pack(side='left', padx=(6, 0))
        ttk.Entry(head, textvariable=self.search_var, width=30).pack(side='right')
        tk.Label(head, text='Zoeken:', bg=CARD, fg=DIM, font=('Segoe UI', 9)).pack(side='right', padx=(0, 6))

        cols = tk.Frame(card, bg=CARD)
        cols.pack(fill='x', pady=(8, 0))
        cols.grid_columnconfigure(0, weight=1)
        cols.grid_columnconfigure(1, weight=1)

        # LEFT — with ID
        left = tk.Frame(cols, bg=PANEL, highlightthickness=1, highlightbackground=BORDER)
        left.grid(row=0, column=0, sticky='nsew', padx=(0, 6))
        left_head = tk.Frame(left, bg=PANEL)
        left_head.pack(fill='x', padx=10, pady=(8, 4))
        tk.Label(left_head, text='🎵 Met ID', bg=PANEL, fg=TEXT, font=BOLD).pack(side='left')
        self.with_id_badge = tk.Label(left_head, text='0', bg=PANEL, fg=ACCENT, font=BOLD)
        self.with_id_badge.pack(side='left', padx=(6, 0))

        tree_frame = tk.Frame(left, bg=PANEL)
        tree_frame.pack(fill='both', expand=True, padx=8)
        self.tree = ttk.Treeview(tree_frame, columns=('id', 'title', 'artist'),
                                 show='headings', height=9)
        for cid, txt, w in (('id', 'ID', 64), ('title', 'Titel', 230),
                            ('artist', 'Artiest', 120)):
            self.tree.heading(cid, text=txt)
            self.tree.column(cid, width=w, anchor='w')
        tvs = ttk.Scrollbar(tree_frame, orient='vertical', command=self.tree.yview)
        self.tree.configure(yscrollcommand=tvs.set)
        self.tree.pack(side='left', fill='both', expand=True)
        tvs.pack(side='right', fill='y')
        self.tree.bind('<Delete>', self.on_delete_tree)

        left_btns = tk.Frame(left, bg=PANEL)
        left_btns.pack(fill='x', padx=8, pady=(6, 8))
        ttk.Button(left_btns, text='✕ Verwijder geselecteerde', style='Danger.TButton',
                   command=self.on_delete_tree).pack(side='left')
        self.empty_hint = tk.Label(left, text='Nog geen liederen met een ID — importeer of voeg een lied toe.',
                                   bg=PANEL, fg=DIM, font=('Segoe UI', 9), anchor='w', justify='left')
        self.empty_hint.pack(fill='x', padx=10, pady=(0, 8))

        # RIGHT — without ID
        right = tk.Frame(cols, bg=PANEL, highlightthickness=1, highlightbackground=BORDER)
        right.grid(row=0, column=1, sticky='nsew', padx=(6, 0))
        right_head = tk.Frame(right, bg=PANEL)
        right_head.pack(fill='x', padx=10, pady=(8, 4))
        tk.Label(right_head, text='❓ Zonder ID', bg=PANEL, fg=TEXT, font=BOLD).pack(side='left')
        self.no_id_badge = tk.Label(right_head, text='0', bg=PANEL, fg=ACCENT, font=BOLD)
        self.no_id_badge.pack(side='left', padx=(6, 0))
        self.noid_hint = tk.Label(right, text='Deze liederen hebben nog geen ID. Selecteer er een, kies een letter en klik "Ken toe".',
                                  bg=PANEL, fg=DIM, font=('Segoe UI', 9), anchor='w', justify='left', wraplength=420)
        self.noid_hint.pack(fill='x', padx=10, pady=(0, 4))

        list_frame = tk.Frame(right, bg=PANEL)
        list_frame.pack(fill='both', expand=True, padx=8)
        self.noid_list = tk.Listbox(list_frame, bg=PANEL, fg=TEXT, selectbackground='#2b3650',
                                    selectforeground=TEXT, highlightthickness=1,
                                    highlightbackground=BORDER, relief='flat',
                                    font=FONT, activestyle='none')
        nvs = ttk.Scrollbar(list_frame, orient='vertical', command=self.noid_list.yview)
        self.noid_list.configure(yscrollcommand=nvs.set)
        self.noid_list.pack(side='left', fill='both', expand=True)
        nvs.pack(side='right', fill='y')
        self.noid_list.bind('<Delete>', self.on_delete_noid)
        self.noid_list.bind('<Double-Button-1>', lambda e: self.on_assign())

        assign_row = tk.Frame(right, bg=PANEL)
        assign_row.pack(fill='x', padx=8, pady=(6, 0))
        tk.Label(assign_row, text='Letter:', bg=PANEL, fg=DIM, font=('Segoe UI', 9)).pack(side='left')
        self.assign_entry = ttk.Entry(assign_row, textvariable=self.assign_var, width=8)
        self.assign_entry.pack(side='left', padx=(6, 8))
        ttk.Button(assign_row, text='Ken toe', style='Accent.TButton',
                   command=self.on_assign).pack(side='left')
        ttk.Button(assign_row, text='✕ Verwijder', style='Danger.TButton',
                   command=self.on_delete_noid).pack(side='right')
        self.root.bind('<Return>', self._enter_assign)
        hint2 = tk.Label(right, text='Enter in het letterveld = Ken toe.', bg=PANEL, fg=DIM,
                         font=('Segoe UI', 8))
        hint2.pack(anchor='w', padx=10, pady=(4, 8))

    def _enter_assign(self, e):
        # Only trigger 'Ken toe' when the letter field itself has focus; Return
        # events inside modal Toplevels never reach this root binding anyway.
        if self.root.focus_get() is not self.assign_entry:
            return
        self.on_assign()

    # -- rendering -----------------------------------------------------------
    def render_all(self):
        self.render_stats()
        self.update_next_id()
        self.render_library()

    def render_stats(self):
        total = len(self.lib.songs)
        noid = len([s for s in self.lib.songs if not (s.get('prefix') and s.get('number'))])
        prefixes = {}
        for s in self.lib.songs:
            if s.get('prefix'):
                prefixes[s['prefix']] = prefixes.get(s['prefix'], 0) + 1
        keys = sorted(prefixes)
        self._stat_boxes['total'].config(text=str(total))
        self._stat_boxes['noid'].config(text=str(noid))
        self._stat_boxes['prefixes'].config(text=str(len(keys)))
        self.lib_count_lbl.config(text=str(total))
        self.chips_lbl.config(text='   '.join('%s · %d' % (k, prefixes[k]) for k in keys))

    def _matches(self, s, q):
        if not q:
            return True
        hay = [s.get('title') or '', s.get('id') or '', s.get('artist') or '']
        hay += list(s.get('altTitles') or [])
        return any(q in (h or '').lower() for h in hay)

    def render_library(self):
        q = self.search_var.get().lower()
        has_id = [s for s in self.lib.songs if s.get('prefix') and s.get('number')]
        no_id = [s for s in self.lib.songs if not (s.get('prefix') and s.get('number'))]

        # left table
        rows = sorted([s for s in has_id if self._matches(s, q)],
                      key=lambda s: (s['prefix'], int(s.get('number') or 0)))
        # Liederen met een alternatieve titel (zelfde nummer, EN/NL-vertaling)
        # worden op een tweede regel getoond ('\n🌐 ...'). ttk.Treeview kan geen
        # per-rij hoogte — dus als er zulke rijen in beeld zijn, krijgt de hele
        # tabel 2-regel-hoogte zodat de vertaling NIET wordt afgesneden.
        has_alts = any(s.get('altTitles') for s in rows)
        self.style.configure('Treeview', rowheight=46 if has_alts else 26)
        self.tree.column('title', width=280 if has_alts else 230)
        self.tree.delete(*self.tree.get_children())
        for s in rows:
            title = s.get('title') or ''
            alts = s.get('altTitles') or []
            if alts:
                title += '\n🌐 ' + ' / '.join(alts)
            self.tree.insert('', 'end', iid=s['uid'],
                             values=(s.get('id'), title, s.get('artist') or '—'))
        self.with_id_badge.config(text=str(len(rows)))
        if has_id:
            self.empty_hint.pack_forget()
        else:
            self.empty_hint.pack(fill='x', padx=10, pady=(0, 8))

        # right list
        self._noid_songs = sorted([s for s in no_id if self._matches(s, q)],
                                  key=lambda s: s.get('title') or '')
        self.noid_list.delete(0, 'end')
        for s in self._noid_songs:
            self.noid_list.insert('end', s.get('title') or '')
        self.no_id_badge.config(text=str(len(self._noid_songs)))
        if not no_id:
            self.noid_hint.config(text='🎉 Alle liederen hebben een ID', fg=GREEN)
        elif not self._noid_songs:
            self.noid_hint.config(text='Geen resultaten voor deze zoekopdracht', fg=DIM)
        else:
            self.noid_hint.config(text='Selecteer een lied, kies een letter en klik "Ken toe" — '
                                       'de app stelt het eerstvolgende vrije nummer voor.', fg=DIM)

    def update_next_id(self):
        prefix = self.add_prefix_var.get().strip().upper()
        if not prefix:
            self.next_id_lbl.config(text='—')
            return
        if not PREFIX_PATTERN.match(prefix):
            self.next_id_lbl.config(text='1–4 letters')
            return
        n = self.lib.next_number_for(prefix)
        self.next_id_lbl.config(text=prefix + self.lib.format_number(prefix, n))

    def set_status(self, msg, kind=''):
        color = {'ok': GREEN, 'err': RED}.get(kind, DIM)
        self.status_lbl.config(text=msg, fg=color)
        if kind == 'ok':
            if self._status_job:
                self.root.after_cancel(self._status_job)
            self._status_job = self.root.after(6000, lambda: self.status_lbl.config(text='—', fg=DIM))

    # -- actions -------------------------------------------------------------
    def on_save(self):
        n = self.lib.save()
        self.set_status('💾 Opgeslagen %d liederen → %s' % (n, os.path.basename(self.lib.path)), 'ok')

    def on_add_song(self):
        ok, msg = self.lib.add_song(self.add_title_var.get(), self.add_prefix_var.get())
        if ok:
            self.add_title_var.set('')
            self.add_prefix_var.set('')
            self.render_all()
            self.lib.save()
        self.set_status(msg, 'ok' if ok else 'err')

    def on_assign(self, event=None):
        sel = self.noid_list.curselection()
        if not sel:
            self.set_status('⚠️ Selecteer eerst een lied in de rechterkolom', 'err')
            return
        song = self._noid_songs[sel[0]]
        ok, msg = self.lib.assign_id(song, self.assign_var.get())
        if ok:
            self.assign_var.set('')
            self.render_all()
            self.lib.save()
        self.set_status(msg, 'ok' if ok else 'err')

    def _confirm_delete(self, song):
        label = ' (%s)' % song['id'] if song.get('id') else ' (zonder ID)'
        return messagebox.askyesno('Verwijderen',
                                   'Verwijder "%s"%s?' % (song.get('title'), label))

    def on_delete_tree(self, event=None):
        sel = self.tree.selection()
        if not sel:
            return
        song = next((s for s in self.lib.songs if s.get('uid') == sel[0]), None)
        if not song:
            return
        if not self._confirm_delete(song):
            return
        self.lib.remove_by_uid(song['uid'])
        self.render_all()
        self.lib.save()
        self.set_status('🗑 Verwijderd: %s' % (song.get('title')), 'ok')

    def on_delete_noid(self, event=None):
        sel = self.noid_list.curselection()
        if not sel:
            return
        song = self._noid_songs[sel[0]]
        if not self._confirm_delete(song):
            return
        self.lib.remove_by_uid(song['uid'])
        self.render_all()
        self.lib.save()
        self.set_status('🗑 Verwijderd: %s' % (song.get('title')), 'ok')

    # -- import --------------------------------------------------------------
    def on_import_clipboard(self):
        try:
            text = self.root.clipboard_get()
        except tk.TclError:
            self.set_status('⚠️ Klembord is leeg — kopieer eerst je liederenlijst uit WorshipTools', 'err')
            return
        parsed = [p for p in (parse_line(l) for l in text.splitlines()) if p]
        self._parsed_lines(parsed)

    def on_import_file(self):
        """Open a file picker, read the file, and show the same 4-bucket preview
        as clipboard/paste import — so the operator sees all the numbers
        before committing."""
        filepath = filedialog.askopenfilename(
            title='Kies een bestand met liederen',
            filetypes=[
                ('Tekstbestanden', '*.txt *.csv'),
                ('JSON-bestanden', '*.json'),
                ('Alle bestanden', '*.*'),
            ]
        )
        if not filepath:
            return
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                text = f.read()
        except OSError as err:
            self.set_status('❌ Kan bestand niet lezen: %s' % err, 'err')
            return

        if filepath.lower().endswith('.json'):
            try:
                data = json.loads(text)
                songs_raw = data.get('songs', [])
                parsed = []
                for s in songs_raw:
                    if s.get('number') and s.get('name'):
                        parsed.append(parse_line(s['number'] + ' ' + s['name'], s.get('artist')))
                    elif s.get('id') and s.get('title'):
                        parsed.append({'id': s['id'], 'prefix': s.get('prefix', ''),
                                      'number': s.get('number', ''), 'title': s['title'],
                                      'artist': s.get('artist', '')})
                    elif s.get('title'):
                        parsed.append(parse_line(s['title'], s.get('artist')))
            except (json.JSONDecodeError, KeyError) as err:
                self.set_status('❌ Ongeldig JSON-bestand: %s' % err, 'err')
                return
        else:
            parsed = [p for p in (parse_line(l) for l in text.splitlines()) if p]

        if not parsed:
            self.set_status('⚠️ Bestand bevatte geen herkenbare liederegels', 'err')
            return
        self._parsed_lines(parsed)

    def open_paste_dialog(self):
        dlg = tk.Toplevel(self.root)
        dlg.title('Plak lijst')
        dlg.configure(bg=BG)
        dlg.geometry('640x420')
        dlg.transient(self.root)
        tk.Label(dlg, text='Plak hier je liederenlijst — één lied per regel, bijv.:',
                 bg=BG, fg=DIM, font=('Segoe UI', 9), justify='left').pack(anchor='w', padx=12, pady=(10, 4))
        tk.Label(dlg, text='D044 Great I Am\nH101 Vaste Rots van mijn behoud\nNieuw lied zonder nummer',
                 bg=BG, fg=DIM, font=('Consolas', 9), justify='left').pack(anchor='w', padx=12)
        txt = scrolledtext.ScrolledText(dlg, bg=PANEL, fg=TEXT, insertbackground=TEXT,
                                        font=('Consolas', 10), relief='flat', height=12,
                                        highlightthickness=1, highlightbackground=BORDER)
        txt.pack(fill='both', expand=True, padx=12, pady=8)
        row = tk.Frame(dlg, bg=BG)
        row.pack(fill='x', padx=12, pady=(0, 12))
        parsed_holder = {'parsed': []}

        def do_parse():
            parsed_holder['parsed'] = [p for p in (parse_line(l) for l in txt.get('1.0', 'end').splitlines()) if p]
            if not parsed_holder['parsed']:
                self.set_status('⚠️ Niets te importeren', 'err')
                return
            dlg.destroy()
            self._parsed_lines(parsed_holder['parsed'])

        ttk.Button(row, text='Parse & beoordeel', style='Accent.TButton', command=do_parse).pack(side='right')
        ttk.Button(row, text='Annuleren', command=dlg.destroy).pack(side='right', padx=(0, 8))
        txt.focus_set()

    def _parsed_lines(self, parsed):
        if not parsed:
            self.set_status('⚠️ Niets te importeren', 'err')
            return
        self.show_preview(parsed)

    def show_preview(self, parsed):
        """4-bucket preview — same classifier + ctx as apply_import."""
        self._pending_parsed = parsed
        buckets = {'withId': [], 'noId': [], 'alt': [], 'dupe': []}
        ctx = {'seen_titles': {}, 'seen_ids': {}}
        for p in parsed:
            if not p:
                continue
            cls = self.lib.classify_import(p, ctx)
            if cls['bucket'] == 'withId':
                ctx['seen_ids'][cls['id']] = {'id': cls['id'], 'title': p['title'], 'altTitles': []}
                buckets['withId'].append(p)
            elif cls['bucket'] == 'alt':
                stub = ctx['seen_ids'].get(cls['targetId'])
                if not stub:
                    lib_song = self.lib.find_song_by_id(cls['targetId'])
                    stub = {'id': cls['targetId'],
                            'title': lib_song['title'] if lib_song else p['title'],
                            'altTitles': list(lib_song.get('altTitles') or []) if lib_song else []}
                    ctx['seen_ids'][cls['targetId']] = stub
                self.lib.add_alt_title(stub, p['title'])
                buckets['alt'].append((p, cls['reason']))
            elif cls['bucket'] == 'dupe':
                buckets['dupe'].append((p, cls['reason']))
            else:
                buckets['noId'].append(p)

        dlg = tk.Toplevel(self.root)
        dlg.title('Voorbeeld van import — %d liederen' % len(parsed))
        dlg.configure(bg=BG)
        dlg.geometry('820x540')
        dlg.transient(self.root)
        dlg.grab_set()

        tk.Label(dlg, text='Zo wordt de import verdeeld over je huidige bibliotheek:',
                 bg=BG, fg=DIM, font=('Segoe UI', 9), justify='left').pack(anchor='w', padx=12, pady=(10, 4))
        txt = scrolledtext.ScrolledText(dlg, bg=PANEL, fg=TEXT, insertbackground=TEXT,
                                        font=('Consolas', 10), relief='flat',
                                        highlightthickness=1, highlightbackground=BORDER)
        txt.pack(fill='both', expand=True, padx=12, pady=4)
        for tag, fg, font in (('hdr', ACCENT, BOLD), ('id', ACCENT, BOLD), ('dim', DIM, FONT),
                              ('noid', DIM, ('Consolas', 10, 'italic')),
                              ('red', RED, FONT), ('blue', BLUE, FONT), ('artist', DIM, FONT)):
            txt.tag_configure(tag, foreground=fg, font=font)
        txt.config(state='normal')

        def section(title, count, color):
            txt.insert('end', '\n' + title + '  ', 'hdr')
            txt.insert('end', '(%d)\n' % count, 'hdr')

        def line_id(p):
            if p.get('id'):
                txt.insert('end', p.get('id'), 'id')
            else:
                txt.insert('end', '(geen ID)', 'noid')

        section('🎵 MET ID', len(buckets['withId']), ACCENT)
        for p in buckets['withId']:
            line_id(p)
            txt.insert('end', '  ' + p.get('title'))
            if p.get('artist'):
                txt.insert('end', ' — ' + p.get('artist'), 'artist')
            txt.insert('end', '\n')
        section('❓ ZONDER ID', len(buckets['noId']), DIM)
        for p in buckets['noId']:
            line_id(p)
            txt.insert('end', '  ' + p.get('title'))
            if p.get('artist'):
                txt.insert('end', ' — ' + p.get('artist'), 'artist')
            txt.insert('end', '  (wordt opgeslagen, letter later toekennen)', 'dim')
            txt.insert('end', '\n')
        section('🌐 ALTERNATIEVE TITEL', len(buckets['alt']), BLUE)
        for p, reason in buckets['alt']:
            line_id(p)
            txt.insert('end', '  ' + p.get('title'), 'blue')
            txt.insert('end', '  ' + reason, 'dim')
            txt.insert('end', '\n')
        section('⚠️ DUBBELE (wordt overgeslagen)', len(buckets['dupe']), RED)
        for p, reason in buckets['dupe']:
            line_id(p)
            txt.insert('end', '  ' + p.get('title'))
            txt.insert('end', '  ' + reason, 'red')
            txt.insert('end', '\n')
        txt.config(state='disabled')

        row = tk.Frame(dlg, bg=BG)
        row.pack(fill='x', padx=12, pady=(6, 12))
        ttk.Button(row, text='✅ Voeg toe aan bibliotheek', style='Green.TButton',
                   command=lambda: self._confirm_preview(dlg)).pack(side='right')
        ttk.Button(row, text='Annuleren', command=dlg.destroy).pack(side='right', padx=(0, 8))

    def _confirm_preview(self, dlg):
        result = self.lib.apply_import(self._pending_parsed)
        self._pending_parsed = []
        dlg.destroy()
        self.render_all()
        self.lib.save()
        self.show_result(result)
        noid_note = ' (%d zonder ID)' % result['noId'] if result['noId'] else ''
        merged_note = ' · %d als alternatieve titel' % result['merged'] if result['merged'] else ''
        self.set_status('✅ Import: %d toegevoegd%s%s, %d overgeslagen'
                        % (result['added'], noid_note, merged_note,
                           len(result['skipped_list'])), 'ok')

    def show_result(self, result):
        merged = result['merged_list']
        skipped = result['skipped_list']
        if not merged and not skipped:
            return
        dlg = tk.Toplevel(self.root)
        dlg.title('Import resultaat')
        dlg.configure(bg=BG)
        dlg.geometry('720x480')
        dlg.transient(self.root)
        dlg.grab_set()

        parts = ['✅ %d toegevoegd' % result['added']]
        if result['noId']:
            parts.append('%d zonder ID' % result['noId'])
        if merged:
            parts.append('🌐 %d alternatieve titel' % len(merged))
        if skipped:
            parts.append('⚠️ %d overgeslagen' % len(skipped))
        tk.Label(dlg, text=' · '.join(parts), bg=BG, fg=TEXT, font=BOLD,
                 justify='left', wraplength=680).pack(anchor='w', padx=12, pady=(10, 4))

        txt = scrolledtext.ScrolledText(dlg, bg=PANEL, fg=TEXT, insertbackground=TEXT,
                                        font=('Consolas', 10), relief='flat',
                                        highlightthickness=1, highlightbackground=BORDER)
        txt.pack(fill='both', expand=True, padx=12, pady=4)
        for tag, fg, font in (('hdr', BLUE, BOLD), ('id', ACCENT, BOLD), ('dim', DIM, FONT),
                              ('noid', DIM, ('Consolas', 10, 'italic')), ('red', RED, FONT)):
            txt.tag_configure(tag, foreground=fg, font=font)
        txt.config(state='normal')

        if merged:
            txt.insert('end', '🌐 Toegevoegd als alternatieve titel (zelfde ID):\n', 'hdr')
            for s in merged:
                txt.insert('end', '  ' + str(s.get('id') or '(geen ID)'), 'id')
                txt.insert('end', '  ' + s.get('title'))
                if s.get('artist'):
                    txt.insert('end', ' — ' + s.get('artist'), 'dim')
                txt.insert('end', '\n')
        if skipped:
            txt.insert('end', '\n⚠️ Overgeslagen — zie waarom:\n', 'red')
            for s in skipped:
                txt.insert('end', '  ' + str(s.get('id') or '(geen ID)'), 'id')
                txt.insert('end', '  ' + s.get('title'))
                txt.insert('end', '  ' + (s.get('reason') or 'onbekende reden'), 'red')
                txt.insert('end', '\n')
        txt.config(state='disabled')

        row = tk.Frame(dlg, bg=BG)
        row.pack(fill='x', padx=12, pady=(6, 12))
        ttk.Button(row, text='OK', style='Accent.TButton', command=dlg.destroy).pack(side='right')

    # -- close ---------------------------------------------------------------
    def on_close(self):
        try:
            self.lib.save()
        except Exception:
            pass
        self.root.destroy()


def main():
    root = tk.Tk()
    root.configure(bg=BG)
    App(root)
    root.mainloop()


if __name__ == '__main__':
    main()
