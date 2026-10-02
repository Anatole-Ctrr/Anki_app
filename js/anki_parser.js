/**
 * Parseur Anki côté client (100% navigateur).
 * Décompresse les fichiers .apkg via JSZip et interroge SQLite via sql.js (WebAssembly).
 */

class AnkiParser {
  constructor() {
    this.sqlInstance = null;
    this.db = null;
    this.models = new Map();
    this.decks = new Map();
    this.notes = new Map();
    this.cards = [];
    this.mediaMap = new Map(); // originalName -> Blob URL
    this.rawMediaDict = {}; // "0" -> "image.png"
  }

  /**
   * Initialise le moteur sql.js Wasm si ce n'est pas déjà fait.
   */
  async initSql() {
    if (!this.sqlInstance) {
      if (typeof initSqlJs !== "function") {
        throw new Error("sql.js n'est pas chargé. Vérifiez la connexion Internet ou les scripts CDN.");
      }
      this.sqlInstance = await initSqlJs({
        locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}`,
      });
    }
  }

  /**
   * Nettoie les ressources précédentes (URLs d'objets Blob et base SQLite).
   */
  reset() {
    for (const url of this.mediaMap.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    }
    this.mediaMap.clear();
    this.rawMediaDict = {};
    this.models.clear();
    this.decks.clear();
    this.notes.clear();
    this.cards = [];
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Parse un fichier .apkg (File ou ArrayBuffer).
   * @param {File|ArrayBuffer} fileInput
   * @param {function} [onProgress] Callback de progression (status: string)
   */
  async loadApkg(fileInput, onProgress = () => {}) {
    this.reset();
    await this.initSql();

    onProgress("Décompression de l'archive .apkg...");
    const zip = await JSZip.loadAsync(fileInput);

    // 1. Recherche de la base de données
    const dbFile = zip.file("collection.anki2") || zip.file("collection.anki21");
    if (!dbFile) {
      throw new Error("Base de données collection.anki2 introuvable dans le paquet.");
    }

    onProgress("Chargement des fichiers multimédias...");
    // 2. Extraction du mapping média
    const mediaFile = zip.file("media");
    if (mediaFile) {
      try {
        const mediaJsonStr = await mediaFile.async("text");
        this.rawMediaDict = JSON.parse(mediaJsonStr);

        for (const [keyNum, origFilename] of Object.entries(this.rawMediaDict)) {
          const mFile = zip.file(keyNum);
          if (mFile) {
            const blob = await mFile.async("blob");
            const blobUrl = URL.createObjectURL(blob);
            this.mediaMap.set(origFilename, blobUrl);
          }
        }
      } catch (err) {
        console.warn("Erreur lors du décodage des médias :", err);
      }
    }

    onProgress("Ouverture de la base SQLite...");
    const dbBuffer = await dbFile.async("uint8array");
    this.db = new this.sqlInstance.Database(dbBuffer);

    onProgress("Lecture des modèles et paquets...");
    this._loadCol();

    onProgress("Extraction des notes et cartes...");
    this._loadNotes();
    this._loadCards();

    onProgress("Terminé !");
    return {
      decks: Array.from(this.decks.values()),
      totalNotes: this.notes.size,
      totalCards: this.cards.length,
      totalMedia: this.mediaMap.size,
    };
  }

  _loadCol() {
    const res = this.db.exec("SELECT models, decks FROM col LIMIT 1;");
    if (!res || res.length === 0 || res[0].values.length === 0) return;

    const row = res[0].values[0];
    const modelsJson = JSON.parse(row[0]);
    const decksJson = JSON.parse(row[1]);

    // Modèles
    for (const [mid, mData] of Object.entries(modelsJson)) {
      const flds = (mData.flds || []).sort((a, b) => (a.ord || 0) - (b.ord || 0)).map((f) => f.name);
      const tmpls = (mData.tmpls || []).sort((a, b) => (a.ord || 0) - (b.ord || 0));
      this.models.set(Number(mid), {
        id: Number(mid),
        name: mData.name || "Standard",
        isCloze: mData.type === 1,
        css: mData.css || "",
        fields: flds,
        templates: tmpls,
      });
    }

    // Paquets (Decks)
    for (const [did, dData] of Object.entries(decksJson)) {
      this.decks.set(Number(did), {
        id: Number(did),
        name: dData.name || `Paquet ${did}`,
        cards: [],
      });
    }
  }

  _loadNotes() {
    const res = this.db.exec("SELECT id, guid, mid, tags, flds FROM notes;");
    if (!res || res.length === 0) return;

    for (const row of res[0].values) {
      const [id, guid, mid, tagsStr, fldsStr] = row;
      const rawFields = (fldsStr || "").split("\x1f");
      const tags = (tagsStr || "").trim().split(/\s+/).filter(Boolean);

      const model = this.models.get(Number(mid));
      const fieldDict = {};
      if (model && model.fields) {
        model.fields.forEach((fName, idx) => {
          fieldDict[fName] = rawFields[idx] || "";
        });
      }

      this.notes.set(Number(id), {
        id: Number(id),
        guid,
        modelId: Number(mid),
        rawFields,
        fieldDict,
        tags,
      });
    }
  }

  _loadCards() {
    const res = this.db.exec("SELECT id, nid, did, ord, type, queue, due, reps, lapses FROM cards;");
    if (!res || res.length === 0) return;

    for (const row of res[0].values) {
      const [id, nid, did, ord, type, queue, due, reps, lapses] = row;
      const note = this.notes.get(Number(nid));
      const card = {
        id: Number(id),
        noteId: Number(nid),
        deckId: Number(did),
        ord: Number(ord),
        type: Number(type),
        queue: Number(queue),
        due: Number(due),
        reps: Number(reps),
        lapses: Number(lapses),
        note,
      };

      this.cards.push(card);

      const deck = this.decks.get(Number(did));
      if (deck) {
        deck.cards.push(card);
      }
    }
  }

  /**
   * Rendu complet recto/verso d'une carte.
   */
  renderCard(card) {
    if (!card || !card.note) return { front: "", back: "", css: "" };
    const model = this.models.get(card.note.modelId);
    if (!model) return { front: "", back: "", css: "" };

    let qfmt = "";
    let afmt = "";

    if (model.isCloze) {
      const tmpl = model.templates[0] || { qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}" };
      qfmt = tmpl.qfmt || "{{cloze:Text}}";
      afmt = tmpl.afmt || "{{cloze:Text}}";
    } else if (card.ord < model.templates.length) {
      const tmpl = model.templates[card.ord];
      qfmt = tmpl.qfmt || "";
      afmt = tmpl.afmt || "";
    }

    const front = this._renderTemplate(qfmt, card, model, false);
    const back = this._renderTemplate(afmt, card, model, true, front);

    return {
      front: this._resolveMedia(front),
      back: this._resolveMedia(back),
      css: model.css || "",
    };
  }

  _renderTemplate(templateStr, card, model, isAnswer, frontSide = "") {
    let output = templateStr;
    const fields = card.note.fieldDict || {};

    if (isAnswer) {
      const frontClean = frontSide.replace(/\[sound:[^\]]+\]/g, "");
      output = output.replace(/\{\{FrontSide\}\}/g, frontClean);
    }

    // 1. Conditionnels positifs {{#Field}}...{{/Field}}
    output = output.replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, fieldName, content) => {
      const val = (fields[fieldName.trim()] || "").trim();
      return val ? content : "";
    });

    // 2. Conditionnels négatifs {{^Field}}...{{/Field}}
    output = output.replace(/\{\{\^([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, fieldName, content) => {
      const val = (fields[fieldName.trim()] || "").trim();
      return val ? "" : content;
    });

    // 3. Modificateurs Cloze si modèle Cloze
    if (model.isCloze) {
      const targetClozeIdx = card.ord + 1;
      output = output.replace(/\{\{cloze:([^}]+)\}\}/gi, (match, fName) => {
        const val = fields[fName.trim()] || "";
        return this._formatCloze(val, targetClozeIdx, isAnswer);
      });
    }

    // 4. Variables directes {{FieldName}}
    for (const [fName, fVal] of Object.entries(fields)) {
      const reg = new RegExp(`\\{\\{${this._escapeRegExp(fName)}\\}\\}`, "gi");
      output = output.replace(reg, () => fVal);
    }

    return output;
  }

  _formatCloze(text, targetIdx, isAnswer) {
    return text.replace(/\{\{c(\d+)::(.*?)(?:::([^}]*))?\}\}/g, (match, num, answer, hint) => {
      const cNum = parseInt(num, 10);
      if (cNum === targetIdx) {
        if (isAnswer) {
          return `<span class="cloze font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 rounded">${answer}</span>`;
        } else {
          const placeholder = hint ? `[${hint}]` : "[...]";
          return `<span class="cloze font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-2 py-0.5 rounded border border-blue-300 dark:border-blue-700">${placeholder}</span>`;
        }
      } else {
        return answer;
      }
    });
  }

  _resolveMedia(htmlText) {
    let result = htmlText;

    // Remplacement des balises <img> avec leur Blob URL
    result = result.replace(/<img([^>]+)src=["']([^"']+)["']([^>]*)>/gi, (match, before, src, after) => {
      const cleanSrc = src.trim();
      const blobUrl = this.mediaMap.get(cleanSrc);
      if (blobUrl) {
        return `<img${before}src="${blobUrl}"${after} class="max-w-full h-auto mx-auto rounded-lg shadow-sm my-2">`;
      }
      return match;
    });

    // Remplacement des tags audio [sound:file.mp3]
    result = result.replace(/\[sound:([^\]]+)\]/gi, (match, soundFile) => {
      const cleanSound = soundFile.trim();
      const blobUrl = this.mediaMap.get(cleanSound);
      if (blobUrl) {
        return `
          <div class="my-2 inline-block">
            <audio controls class="h-8 max-w-xs inline-block align-middle">
              <source src="${blobUrl}">
              Votre navigateur ne supporte pas l'élément audio.
            </audio>
          </div>
        `;
      }
      return `<span class="text-xs text-gray-500 italic">[Audio: ${cleanSound}]</span>`;
    });

    return result;
  }

  _escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

// Export global pour le navigateur
window.AnkiParser = AnkiParser;
