/**
 * Gestionnaire de stockage persistant IndexedDB pour le Mode Apprentissage (Quizlet).
 * Permet de stocker de gros paquets de cartes sans contrainte de quota (évite l'erreur QuotaExceededError du localStorage).
 */

class LearnStore {
  constructor() {
    this.dbName = "anki_learn_db";
    this.version = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("active_deck")) {
          db.createObjectStore("active_deck", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "deckName" });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error("Erreur d'ouverture d'IndexedDB pour LearnStore :", e.target.error);
        reject(e.target.error);
      };
    });
  }

  async setActiveDeck(payload) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("active_deck", "readwrite");
      const store = tx.objectStore("active_deck");
      const record = {
        id: "active",
        ...payload,
        savedAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getActiveDeck() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("active_deck", "readonly");
      const store = tx.objectStore("active_deck");
      const req = store.get("active");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async saveSession(deckName, sessionData) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const record = {
        deckName,
        ...sessionData,
        lastUpdated: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getSession(deckName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("sessions", "readonly");
      const store = tx.objectStore("sessions");
      const req = store.get(deckName);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deleteSession(deckName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("sessions", "readwrite");
      const store = tx.objectStore("sessions");
      const req = store.delete(deckName);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

window.LearnStore = LearnStore;
