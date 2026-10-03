"""
Générateur / Constructeur de fichiers .apkg Anki.
Permet de créer facilement des paquets Anki avec cartes simples, cartes Cloze et médias.
"""

import json
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Union


class AnkiPackageBuilder:
    """
    Constructeur orienté objet pour générer des fichiers .apkg Anki valides.
    """

    def __init__(self, deck_name: str = "Mon Paquet Anki", deck_id: Optional[int] = None):
        self.deck_name = deck_name
        self.now = int(time.time())
        self.deck_id = deck_id or (self.now * 1000 + 2000)

        self.model_basic_id = self.now * 1000 + 1000
        self.model_cloze_id = self.now * 1000 + 1001

        self.notes: List[Dict] = []
        self.media_files: Dict[str, bytes] = {}  # "photo.png" -> bytes

    def add_card(self, front: str, back: str, tags: Optional[List[str]] = None) -> None:
        """Ajoute une carte standard (Question / Réponse)."""
        self.notes.append({
            "model_id": self.model_basic_id,
            "fields": [front, back],
            "tags": tags or [],
        })

    def add_cloze_card(self, text: str, extra: str = "", tags: Optional[List[str]] = None) -> None:
        """
        Ajoute une carte à trou (Cloze deletion).
        Exemple : text = "La capitale de la France est {{c1::Paris}}."
        """
        self.notes.append({
            "model_id": self.model_cloze_id,
            "fields": [text, extra],
            "tags": tags or [],
        })

    def add_media(self, filename: str, content: bytes) -> None:
        """Ajoute un fichier multimédia (image, audio) au paquet."""
        self.media_files[filename] = content

    def write_apkg(self, output_path: Union[str, Path]) -> str:
        """Génère le fichier .apkg final à l'emplacement spécifié."""
        out_path = Path(output_path).resolve()
        out_path.parent.mkdir(parents=True, exist_ok=True)

        models = {
            str(self.model_basic_id): {
                "id": self.model_basic_id,
                "name": "Standard (Question / Réponse)",
                "type": 0,
                "mod": self.now,
                "usn": -1,
                "sortf": 0,
                "did": self.deck_id,
                "tmpls": [
                    {
                        "name": "Carte standard",
                        "ord": 0,
                        "qfmt": "{{Front}}",
                        "afmt": "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}",
                        "bqfmt": "",
                        "bafmt": "",
                        "did": None,
                    }
                ],
                "flds": [
                    {"name": "Front", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
                    {"name": "Back", "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
                ],
                "css": ".card { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 20px; text-align: center; color: #1e293b; background-color: #ffffff; padding: 20px; line-height: 1.6; }\n.cloze { font-weight: bold; color: #2563eb; }",
            },
            str(self.model_cloze_id): {
                "id": self.model_cloze_id,
                "name": "Texte à trou (Cloze)",
                "type": 1,
                "mod": self.now,
                "usn": -1,
                "sortf": 0,
                "did": self.deck_id,
                "tmpls": [
                    {
                        "name": "Cloze",
                        "ord": 0,
                        "qfmt": "{{cloze:Text}}",
                        "afmt": "{{cloze:Text}}\n\n<hr id=answer>\n\n{{Extra}}",
                        "bqfmt": "",
                        "bafmt": "",
                        "did": None,
                    }
                ],
                "flds": [
                    {"name": "Text", "ord": 0, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
                    {"name": "Extra", "ord": 1, "sticky": False, "rtl": False, "font": "Arial", "size": 20},
                ],
                "css": ".card { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 20px; text-align: center; color: #1e293b; background-color: #ffffff; padding: 20px; line-height: 1.6; }\n.cloze { font-weight: bold; color: #2563eb; }",
            },
        }

        decks = {
            "1": {"id": 1, "name": "Default", "mod": self.now, "usn": 0, "desc": "", "collapsed": False},
            str(self.deck_id): {
                "id": self.deck_id,
                "name": self.deck_name,
                "mod": self.now,
                "usn": -1,
                "desc": f"Paquet créé le {time.strftime('%Y-%m-%d %H:%M')}",
                "collapsed": False,
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            db_path = temp_path / "collection.anki2"

            conn = sqlite3.connect(str(db_path))
            cur = conn.cursor()

            cur.executescript("""
            CREATE TABLE col (
                id integer primary key, crt integer, mod integer, scm integer, ver integer,
                dty integer, usn integer, ls integer, conf text, models text, decks text,
                dconf text, tags text
            );
            CREATE TABLE notes (
                id integer primary key, guid text, mid integer, mod integer, usn integer,
                tags text, flds text, sfld text, csum integer, flags integer, data text
            );
            CREATE TABLE cards (
                id integer primary key, nid integer, did integer, ord integer, mod integer,
                usn integer, type integer, queue integer, due integer, ivl integer, factor integer,
                reps integer, lapses integer, left integer, odue integer, odid integer,
                flags integer, data text
            );
            CREATE TABLE graves (usn integer, oid integer, type integer);
            CREATE TABLE revlog (id integer primary key, cid integer, usn integer, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer);
            """)

            conf = {"nextPos": 1, "activeDecks": [1, self.deck_id], "curDeck": self.deck_id}
            dconf = {"1": {"id": 1, "name": "Default"}}
            cur.execute(
                "INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')",
                (self.now, self.now * 1000, self.now * 1000, json.dumps(conf), json.dumps(models), json.dumps(decks), json.dumps(dconf)),
            )

            note_id_start = self.now * 1000
            card_id_start = (self.now + 10) * 1000

            for i, n_info in enumerate(self.notes):
                nid = note_id_start + i
                cid = card_id_start + i
                mid = n_info["model_id"]
                flds_list = n_info["fields"]
                flds_joined = "\x1f".join(flds_list)
                sfld = flds_list[0] if flds_list else ""
                tags_str = f" {' '.join(n_info['tags'])} " if n_info["tags"] else ""

                cur.execute(
                    "INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')",
                    (nid, f"guid_{i}_{self.now}", mid, self.now, tags_str, flds_joined, sfld),
                )

                cur.execute(
                    "INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')",
                    (cid, nid, self.deck_id, self.now, i + 1),
                )

            conn.commit()
            conn.close()

            # Mapping des médias
            media_map = {}
            for num_idx, (orig_filename, content_bytes) in enumerate(self.media_files.items()):
                num_str = str(num_idx)
                media_map[num_str] = orig_filename
                with open(temp_path / num_str, "wb") as f:
                    f.write(content_bytes)

            with open(temp_path / "media", "w", encoding="utf-8") as f:
                json.dump(media_map, f)

            # Écriture du .apkg ZIP
            with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
                zf.write(temp_path / "collection.anki2", "collection.anki2")
                zf.write(temp_path / "media", "media")
                for num_str in media_map.keys():
                    zf.write(temp_path / num_str, num_str)

        return str(out_path)
