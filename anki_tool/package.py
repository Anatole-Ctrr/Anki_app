"""
Gestionnaire et parseur d'archives Anki (.apkg).
"""

import json
import os
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Union

from .models import Card, Deck, Note, NoteModel


class AnkiPackage:
    """
    Classe principale pour ouvrir, inspecter et extraire un paquet Anki (.apkg).
    Utilisable comme gestionnaire de contexte (with AnkiPackage(...) as pkg:).
    """

    def __init__(self, apkg_path: Union[str, Path]):
        self.apkg_path = Path(apkg_path)
        if not self.apkg_path.exists():
            raise FileNotFoundError(f"Le fichier Anki est introuvable : {self.apkg_path}")

        self._temp_dir: Optional[tempfile.TemporaryDirectory] = None
        self.extracted_path: Optional[Path] = None
        self.db_path: Optional[Path] = None

        self.models: Dict[int, NoteModel] = {}
        self.decks: Dict[int, Deck] = {}
        self.notes: Dict[int, Note] = {}
        self.cards: Dict[int, Card] = {}
        self.media_map: Dict[str, str] = {}  # "0" -> "photo.png"
        self.reverse_media_map: Dict[str, str] = {}  # "photo.png" -> "0"

        self._load()

    def __enter__(self) -> "AnkiPackage":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    def close(self) -> None:
        """Nettoie le dossier temporaire d'extraction."""
        if self._temp_dir:
            self._temp_dir.cleanup()
            self._temp_dir = None
            self.extracted_path = None
            self.db_path = None

    def _load(self) -> None:
        """Décompresse l'archive .apkg et charge les données SQLite et médias."""
        self._temp_dir = tempfile.TemporaryDirectory(prefix="anki_pkg_")
        self.extracted_path = Path(self._temp_dir.name)

        # Décompression du zip
        with zipfile.ZipFile(self.apkg_path, "r") as zf:
            zf.extractall(self.extracted_path)

        # Recherche de la base SQLite
        for db_name in ("collection.anki2", "collection.anki21"):
            candidate = self.extracted_path / db_name
            if candidate.exists():
                self.db_path = candidate
                break

        if not self.db_path:
            raise ValueError("Aucune base SQLite (collection.anki2 ou collection.anki21) trouvée dans l'archive.")

        # Chargement de la table des médias
        media_file = self.extracted_path / "media"
        if media_file.exists():
            try:
                with open(media_file, "r", encoding="utf-8") as f:
                    self.media_map = json.load(f)
                    self.reverse_media_map = {v: k for k, v in self.media_map.items()}
            except Exception:
                self.media_map = {}
                self.reverse_media_map = {}

        # Lecture de la base SQLite
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        try:
            self._load_col(cur)
            self._load_notes(cur)
            self._load_cards(cur)
        finally:
            conn.close()

    def _load_col(self, cur: sqlite3.Cursor) -> None:
        """Charge les modèles (Note Types) et les paquets depuis la table col."""
        cur.execute("SELECT models, decks FROM col LIMIT 1;")
        row = cur.fetchone()
        if not row:
            return

        models_data = json.loads(row["models"])
        for mid_str, mdict in models_data.items():
            model = NoteModel.from_dict(mdict)
            self.models[model.id] = model

        decks_data = json.loads(row["decks"])
        for did_str, ddict in decks_data.items():
            did = int(ddict["id"])
            deck_name = ddict.get("name", f"Paquet {did}")
            self.decks[did] = Deck(id=did, name=deck_name)

    def _load_notes(self, cur: sqlite3.Cursor) -> None:
        """Charge les fiches depuis la table notes."""
        cur.execute("SELECT id, guid, mid, tags, flds FROM notes;")
        for row in cur.fetchall():
            raw_fields = row["flds"].split("\x1f")
            tags_str = row["tags"].strip()
            tags = tags_str.split(" ") if tags_str else []
            note = Note(
                id=int(row["id"]),
                guid=row["guid"],
                model_id=int(row["mid"]),
                raw_fields=raw_fields,
                tags=tags,
            )
            # Lier au modèle s'il existe
            model = self.models.get(note.model_id)
            if model:
                note.bind_model(model)

            self.notes[note.id] = note

    def _load_cards(self, cur: sqlite3.Cursor) -> None:
        """Charge les cartes depuis la table cards et les associe aux notes et paquets."""
        cur.execute("SELECT id, nid, did, ord, type, queue, due, reps, lapses FROM cards;")
        for row in cur.fetchall():
            card = Card(
                id=int(row["id"]),
                note_id=int(row["nid"]),
                deck_id=int(row["did"]),
                ord=int(row["ord"]),
                type=int(row["type"]),
                queue=int(row["queue"]),
                due=int(row["due"]),
                reps=int(row["reps"]),
                lapses=int(row["lapses"]),
            )
            note = self.notes.get(card.note_id)
            if note:
                card.note = note

            self.cards[card.id] = card

            # Associer au paquet
            deck = self.decks.get(card.deck_id)
            if deck:
                deck.cards.append(card)

    def get_media_bytes(self, filename: str) -> Optional[bytes]:
        """Récupère les octets d'un média à partir de son nom d'origine ou de son numéro."""
        if not self.extracted_path:
            return None

        # Si le nom donné est le nom d'origine, trouver le numéro correspondant
        num_key = self.reverse_media_map.get(filename, filename)
        file_path = self.extracted_path / num_key
        if file_path.exists():
            return file_path.read_bytes()
        return None

    def extract_media(self, destination_dir: Union[str, Path]) -> Dict[str, str]:
        """
        Extrait tous les médias vers un dossier de destination avec leurs vrais noms de fichier.
        Retourne un dictionnaire {nom_fichier: chemin_absolu}.
        """
        dest = Path(destination_dir)
        dest.mkdir(parents=True, exist_ok=True)
        extracted = {}

        if not self.extracted_path:
            return extracted

        for num_key, original_name in self.media_map.items():
            src_file = self.extracted_path / num_key
            if src_file.exists():
                out_path = dest / original_name
                shutil.copy2(src_file, out_path)
                extracted[original_name] = str(out_path)

        return extracted

    def get_deck_summary(self) -> List[Dict]:
        """Génère un résumé statistique des paquets trouvés."""
        summary = []
        for deck in self.decks.values():
            if deck.total_cards > 0 or deck.name != "Default":
                summary.append({
                    "id": deck.id,
                    "name": deck.name,
                    "cards_count": deck.total_cards,
                })
        return summary
