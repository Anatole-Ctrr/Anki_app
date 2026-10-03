/**
 * Gestionnaire de stockage persistant IndexedDB pour la bibliothèque de paquets Anki (.apkg).
 * Permet de conserver les fichiers .apkg enregistrés dans la session utilisateur.
 */

class LibraryStore {
  constructor() {
    this.dbName = "anki_web_library_db";
    this.storeName = "packages";
    this.version = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.error("Erreur d'ouverture d'IndexedDB :", e.target.error);
        reject(e.target.error);
      };
    });
  }

  async savePackage(id, name, arrayBuffer) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const item = {
        id,
        name,
        timestamp: Date.now(),
        buffer: arrayBuffer,
      };

      const req = store.put(item);
      req.onsuccess = () => resolve(item);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async getAllPackages() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async deletePackage(id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.delete(id);

      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async clearAll() {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }
}

// Export global pour le navigateur
window.LibraryStore = LibraryStore;
