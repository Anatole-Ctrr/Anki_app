"""
Interface en ligne de commande (CLI) pour inspecter et manipuler des fichiers Anki (.apkg).
"""

import argparse
import sys
from pathlib import Path

from .package import AnkiPackage


def cmd_info(args):
    with AnkiPackage(args.apkg_path) as pkg:
        print(f"==================================================")
        print(f"Paquet Anki : {Path(args.apkg_path).name}")
        print(f"==================================================")
        print(f"Total Notes    : {len(pkg.notes)}")
        print(f"Total Cartes   : {len(pkg.cards)}")
        print(f"Total Médias   : {len(pkg.media_map)}")
        print(f"Modèles de note: {len(pkg.models)}")

        print("\n--- Paquets (Decks) ---")
        for deck in pkg.decks.values():
            print(f"  [{deck.id}] {deck.name} : {deck.total_cards} cartes")

        print("\n--- Modèles (Note Types) ---")
        for model in pkg.models.values():
            cloze_badge = " (Cloze)" if model.is_cloze else ""
            print(f"  [{model.id}] {model.name}{cloze_badge}")
            print(f"       Champs : {', '.join(model.fields_names)}")


def cmd_cards(args):
    with AnkiPackage(args.apkg_path) as pkg:
        cards = list(pkg.cards.values())
        if args.deck:
            cards = [c for c in cards if c.deck_id == args.deck]

        limit = args.limit or 10
        print(f"Affichage de {min(len(cards), limit)} cartes sur {len(cards)} :\n")

        for idx, card in enumerate(cards[:limit], 1):
            deck = pkg.decks.get(card.deck_id)
            deck_name = deck.name if deck else "Inconnu"
            note = card.note
            model = pkg.models.get(note.model_id) if note else None

            print(f"--------------------------------------------------")
            print(f"Carte #{idx} (ID: {card.id}) | Paquet: {deck_name} | Modèle: {model.name if model else 'N/A'}")
            if note and model:
                front = card.render_question(model)
                back = card.render_answer(model)
                print(f"RECTO :\n{front.strip()}")
                print(f"VERSO :\n{back.strip()}")
            if note and note.tags:
                print(f"Tags : {', '.join(note.tags)}")


def cmd_extract_media(args):
    out_dir = Path(args.out)
    with AnkiPackage(args.apkg_path) as pkg:
        extracted = pkg.extract_media(out_dir)
        print(f"Extraction terminée : {len(extracted)} fichiers multimédias extraits dans '{out_dir.resolve()}'.")


def main():
    parser = argparse.ArgumentParser(description="Outil d'inspection et manipulation Anki (.apkg)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Commande info
    p_info = subparsers.add_parser("info", help="Afficher les statistiques et la structure du paquet")
    p_info.add_argument("apkg_path", help="Chemin vers le fichier .apkg")
    p_info.set_defaults(func=cmd_info)

    # Commande cards
    p_cards = subparsers.add_parser("cards", help="Afficher un échantillon de cartes rendues")
    p_cards.add_argument("apkg_path", help="Chemin vers le fichier .apkg")
    p_cards.add_argument("--deck", type=int, help="Filtrer par ID de paquet", default=None)
    p_cards.add_argument("--limit", type=int, help="Nombre max de cartes à afficher (défaut 10)", default=10)
    p_cards.set_defaults(func=cmd_cards)

    # Commande media
    p_media = subparsers.add_parser("media", help="Extraire tous les médias du paquet")
    p_media.add_argument("apkg_path", help="Chemin vers le fichier .apkg")
    p_media.add_argument("--out", "-o", required=True, help="Dossier de destination")
    p_media.set_defaults(func=cmd_extract_media)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
