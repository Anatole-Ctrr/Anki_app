# 🗂️ Anki Web Player & Python Tool

Une suite complète pour lire, inspecter et réviser des paquets de cartes Anki (`.apkg`) :
1. **Application Web 100% Client-Side** : Conçue pour être hébergée gratuitement sur **GitHub Pages** (fonctionne entièrement dans le navigateur grâce à WebAssembly `sql.js` et `JSZip`, sans aucun serveur distant).
2. **Module Python Orienté Objet (`anki_tool`)** : Une architecture propre et modulaire (`AnkiPackage`, `Deck`, `Note`, `Card`, `NoteModel`) avec CLI intégrée pour inspecter et extraire des paquets Anki en local.

---

## 🌟 Fonctionnalités

### 🌐 Application Web (GitHub Pages)
- **100% Privée & Sécurisée** : Les fichiers `.apkg` ne sont jamais téléversés sur un serveur distant, tout est traité dans la mémoire du navigateur via WebAssembly.
- **Glisser-Déposer (Drag & Drop)** : Chargez n'importe quel fichier `.apkg` instantanément.
- **Bouton Démo en un clic** : Testez l'application immédiatement avec le paquet de démonstration inclus (`demo_deck.apkg`).
- **Support des types de cartes** : Cartes basiques (recto/verso), texte à trou (*Cloze deletion* `{{c1::...}}`), images embarquées et balises audio `[sound:...]`.
- **Raccourcis clavier ergonomiques** :
  - <kbd>Espace</kbd> : Afficher la réponse / Passer à la carte suivante
  - <kbd>Flèches Gauche / Droite</kbd> : Carte précédente / suivante
  - <kbd>1</kbd>, <kbd>2</kbd>, <kbd>3</kbd>, <kbd>4</kbd> : Évaluations de révision (À revoir, Difficile, Correct, Facile)
- **Explorateur de cartes** : Recherche instantanée dans toutes les fiches et filtrage par tags.
- **Statistiques & Métriques** : Nombre de paquets, cartes, notes, médias et nuage de tags.

---

### 🐍 Module Python (`anki_tool`)
- Structure orientée objet complète :
  - `AnkiPackage` : Décompresse le zip, se connecte à SQLite (`collection.anki2`), charge les tables et médias. Utilisable avec gestionnaire de contexte (`with AnkiPackage(...) as pkg:`).
  - `Deck` : Paquet de cartes.
  - `Note` : Données brutes de la note avec découpage des champs délimités par `\x1f`.
  - `Card` : Instance de carte avec rendu HTML du recto et du verso (support des conditionnels et des Cloze).
  - `NoteModel` : Définition des templates HTML/CSS et champs.

---

## 🚀 Démarrage Rapide

### 1. Tester l'application Web en local

Lancez un simple serveur HTTP local avec Python :

```bash
# Dans le dossier Carte_Anki
python -m http.server 8000
```

Ouvrez ensuite votre navigateur sur [http://localhost:8000](http://localhost:8000). Vous pouvez cliquer directement sur **"✨ Tester immédiatement avec le paquet de démonstration"** ou glisser votre propre fichier `.apkg`.

---

### 2. Utiliser le module Python en ligne de commande (CLI)

```bash
# Afficher les informations générales du paquet
python -m anki_tool info demo_deck.apkg

# Afficher les 5 premières cartes rendues
python -m anki_tool cards demo_deck.apkg --limit 5

# Extraire tous les fichiers multimédias dans un dossier
python -m anki_tool media demo_deck.apkg --out mes_medias/
```

---

### 3. Utiliser le module Python dans votre propre code

```python
from anki_tool import AnkiPackage

with AnkiPackage("demo_deck.apkg") as pkg:
    print(f"Paquets disponibles :")
    for deck in pkg.decks.values():
        print(f" - {deck.name} ({deck.total_cards} cartes)")

    # Parcourir et afficher les cartes rendues
    for card in pkg.cards.values():
        model = pkg.models[card.note.model_id]
        print("Question :", card.render_question(model))
        print("Réponse  :", card.render_answer(model))
        break
```

---

### 4. Lancer les tests unitaires

```bash
python -m unittest tests/test_package.py
```

---

## 🌍 Déploiement sur GitHub Pages

Le projet inclut déjà le fichier de workflow automatique [deploy.yml](file:///.github/workflows/deploy.yml).

Pour activer votre site en ligne :
1. Poussez vos fichiers vers GitHub :
   ```bash
   git push -u origin main
   ```
2. Sur GitHub, allez dans **Settings** > **Pages** de votre dépôt ([https://github.com/Anatole-Ctrr/Anki_app/settings/pages](https://github.com/Anatole-Ctrr/Anki_app/settings/pages)).
3. Sous **Build and deployment > Source**, choisissez **GitHub Actions** (ou **Deploy from a branch** > `main` > `/ (root)`).
4. Votre application sera disponible en ligne à l'adresse :  
   `https://anatole-ctrr.github.io/Anki_app/`
