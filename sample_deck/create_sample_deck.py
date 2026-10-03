"""
Générateur de paquet Anki (.apkg) de démonstration.
Crée un paquet complet avec des cartes basiques, des cartes à trou (Cloze) et une image intégrée.
"""

import json
import os
import sqlite3
import tempfile
import time
import zipfile
from pathlib import Path


def create_sample_deck(output_path: str = "demo_deck.apkg"):
    now = int(time.time())

    # 1. Modèles Anki (Standard + Cloze)
    model_basic_id = 1600000001000
    model_cloze_id = 1600000001001

    models = {
        str(model_basic_id): {
            "id": model_basic_id,
            "name": "Standard (Question / Réponse)",
            "type": 0,
            "mod": now,
            "usn": -1,
            "sortf": 0,
            "did": 1,
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
        str(model_cloze_id): {
            "id": model_cloze_id,
            "name": "Texte à trou (Cloze)",
            "type": 1,
            "mod": now,
            "usn": -1,
            "sortf": 0,
            "did": 1,
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

    # 2. Paquets (Decks)
    deck_id = 1600000002000
    decks = {
        "1": {"id": 1, "name": "Default", "mod": now, "usn": 0, "desc": "", "collapsed": False},
        str(deck_id): {
            "id": deck_id,
            "name": "Développement Web & Python",
            "mod": now,
            "usn": -1,
            "desc": "Paquet de démonstration pour tester l'application Web Anki.",
            "collapsed": False,
        },
    }

    # 3. Échantillon de données (notes et cartes)
    # Données brutes : (model_id, [fields], tags)
    notes_data = [
        (
            model_basic_id,
            [
                "Qu'est-ce qu'un fichier <b>.apkg</b> en réalité ?",
                "C'est une <b>archive ZIP</b> contenant une base SQLite (<code>collection.anki2</code>) et les médias chiffrés numériquement.",
            ],
            "anki python format",
        ),
        (
            model_basic_id,
            [
                "Quel est le séparateur standard des champs dans la table <code>notes</code> d'Anki ?",
                "C'est le caractère Unicode <b>\\x1f</b> (Unit Separator, code ASCII 31).",
            ],
            "sqlite anki base",
        ),
        (
            model_basic_id,
            [
                "Comment Anki fait-il la correspondance des fichiers médias (images/sons) ?",
                "Via un fichier JSON nommé <code>media</code> associant les numéros de fichiers (ex: <code>0</code>) à leurs noms d'origine.<br><br><img src=\"python_logo.png\" width=\"120\">",
            ],
            "media image",
        ),
        (
            model_cloze_id,
            [
                "Pour exécuter du SQLite directement dans le navigateur sans backend, on utilise {{c1::sql.js::moteur WebAssembly}}.",
                "sql.js compile le moteur C de SQLite en WebAssembly (Wasm).",
            ],
            "webassembly frontend",
        ),
        (
            model_cloze_id,
            [
                "La bibliothèque {{c1::JSZip}} permet de décompresser une archive .apkg directement en mémoire dans le navigateur.",
                "Aucun fichier n'a besoin d'être téléversé sur un serveur distant !",
            ],
            "javascript web",
        ),
        (
            model_basic_id,
            [
                "Qu'est-ce que l'algorithme SRS (Spaced Repetition System) ?",
                "Un système de <b>répétition espacée</b> qui optimise les intervalles de révision selon la difficulté ressentie pour ancrer les connaissances dans la mémoire à long terme.",
            ],
            "pedagogie memoire",
        ),
        (
            model_basic_id,
            [
                "Quelle est l'identité d'Euler (Formule MathJax / LaTeX) ?",
                "L'équation d'Euler s'écrit en LaTeX :\n\n\\[ e^{i\\pi} + 1 = 0 \\]\n\nOù \\(e\\) est la base du logarithme naturel, \\(i\\) l'unité imaginaire et \\(\\pi\\) la constante circulaire.",
            ],
            "math latex mathjax",
        ),
        (
            model_basic_id,
            [
                "Comment déclarer une fonction asynchrone en Python (Markdown) ?",
                "Voici l'exemple avec bloc de code Markdown :\n\n```python\nimport asyncio\n\nasync def fetch_data():\n    try:\n        print('Chargement...')\n        await asyncio.sleep(1)\n        return {'status': 'ok'}\n    except Exception as e:\n        print('Erreur:', e)\n```",
            ],
            "markdown python code",
        ),
    ]

    # Image de démonstration (un logo Python minimaliste en PNG 1x1 ou SVG)
    # Créons une petite image PNG valide (logo ou badge)
    sample_png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x30\x00\x00\x00\x30\x08\x06"
        b"\x00\x00\x00W\x02\xf9\x87\x00\x00\x00\x19tEXtSoftware\x00Adobe ImageReadyq"
        b"\xc9e<\x00\x00\x00nIDATx\xdabb\xf8\xcf\xc0\xc0\xc0\x04\xc4\xc0\xc4\xa0\x19"
        b"\x18\x18\x98!3\x1b\x061\x03\x83\x80\xa1@\xa8\x80P\x10\xc6\x18`\x01\x18b\x03"
        b"\x8b\x80\xa1@\xa8\x80P\x10\xc6\x18`\x01\x18b\x03\x8b\x80\xa1@\xa8\x80P\x10"
        b"\xc6\x18`\x01\x18b\x03\x8b\x80\xa1@\xa8\x80P\x10\xc6\x18`\x01\x18b\x03\x8b"
        b"\x80\xa1@\xa8\x00\x00\x00\xff\xff\x03\x00\x1f\x91\r\xdeX\x12\xdb\x19\x00"
        b"\x00\x00\x00IEND\xaeB`\x82"
    )

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        db_path = temp_path / "collection.anki2"

        conn = sqlite3.connect(str(db_path))
        cur = conn.cursor()

        # Création des tables Anki standard
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

        # Insertion dans col
        conf = {"nextPos": 1, "activeDecks": [1, deck_id], "curDeck": deck_id}
        dconf = {"1": {"id": 1, "name": "Default"}}
        cur.execute(
            "INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')",
            (now, now * 1000, now * 1000, json.dumps(conf), json.dumps(models), json.dumps(decks), json.dumps(dconf)),
        )

        # Insertion des notes et cartes
        note_id_start = now * 1000
        card_id_start = (now + 10) * 1000

        for i, (mid, flds_list, tags) in enumerate(notes_data):
            nid = note_id_start + i
            cid = card_id_start + i
            flds_joined = "\x1f".join(flds_list)
            sfld = flds_list[0]
            tags_formatted = f" {tags} "

            cur.execute(
                "INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, 0, 0, '')",
                (nid, f"guid_{i}", mid, now, tags_formatted, flds_joined, sfld),
            )

            # Carte associée
            cur.execute(
                "INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, 0, '')",
                (cid, nid, deck_id, now, i + 1),
            )

        conn.commit()
        conn.close()

        # Écriture du fichier media et de l'image
        media_map = {"0": "python_logo.png"}
        with open(temp_path / "media", "w", encoding="utf-8") as f:
            json.dump(media_map, f)

        with open(temp_path / "0", "wb") as f:
            f.write(sample_png_bytes)

        # Création de l'archive .apkg finale
        out_file = Path(output_path).resolve()
        with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(temp_path / "collection.anki2", "collection.anki2")
            zf.write(temp_path / "media", "media")
            zf.write(temp_path / "0", "0")

    print(f"Paquet Anki créé avec succès : {out_file}")
    return str(out_file)


if __name__ == "__main__":
    create_sample_deck("demo_deck.apkg")
