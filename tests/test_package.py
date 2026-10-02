"""
Tests unitaires pour la bibliothèque anki_tool.
"""

import tempfile
import unittest
from pathlib import Path

from anki_tool import AnkiPackage, Card, Deck, Note, NoteModel
from sample_deck.create_sample_deck import create_sample_deck


class TestAnkiTool(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.apkg_path = Path(cls.temp_dir.name) / "test.apkg"
        create_sample_deck(str(cls.apkg_path))

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_package_loading(self):
        with AnkiPackage(self.apkg_path) as pkg:
            self.assertEqual(len(pkg.notes), 6)
            self.assertEqual(len(pkg.cards), 6)
            self.assertIn("0", pkg.media_map)
            self.assertEqual(pkg.media_map["0"], "python_logo.png")

    def test_card_rendering_standard(self):
        with AnkiPackage(self.apkg_path) as pkg:
            card = list(pkg.cards.values())[0]
            model = pkg.models[card.note.model_id]
            front = card.render_question(model)
            back = card.render_answer(model)

            self.assertIn("Qu'est-ce qu'un fichier", front)
            self.assertIn("<hr id=answer>", back)
            self.assertIn("archive ZIP", back)

    def test_card_rendering_cloze(self):
        with AnkiPackage(self.apkg_path) as pkg:
            cloze_card = list(pkg.cards.values())[3]
            model = pkg.models[cloze_card.note.model_id]
            self.assertTrue(model.is_cloze)

            front = cloze_card.render_question(model)
            back = cloze_card.render_answer(model)

            self.assertIn("[moteur WebAssembly]", front)
            self.assertIn('class="cloze">sql.js</span>', back)

    def test_media_extraction(self):
        with AnkiPackage(self.apkg_path) as pkg:
            media_bytes = pkg.get_media_bytes("python_logo.png")
            self.assertIsNotNone(media_bytes)
            self.assertTrue(len(media_bytes) > 0)


if __name__ == "__main__":
    unittest.main()
