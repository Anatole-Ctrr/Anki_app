/**
 * Contrôleur de l'application Web Anki.
 * Gère l'interface utilisateur, la navigation, les raccourcis clavier,
 * la bibliothèque IndexedDB, l'arborescence (+/-), le marquage ⭐ (Quizlet Mode),
 * le chronomètre, les statistiques avancées et la ludification (gamification).
 */

class StatsTracker {
  constructor() {
    this.STORAGE_KEY = "anki_web_stats_v1";
    this.data = this.load();
  }

  load() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.cardRatings) parsed.cardRatings = {};
        return parsed;
      } catch (e) {}
    }
    return {
      streak: 0,
      lastActiveDate: null,
      ratings: { 1: 0, 2: 0, 3: 0, 4: 0 },
      cardRatings: {},
      dailyActivity: {},
    };
  }

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
  }

  recordReview(rating, cardId = null) {
    const today = new Date().toISOString().split("T")[0];

    // 1. Gestion de la Série Quotidienne (Streak)
    if (!this.data.lastActiveDate) {
      this.data.streak = 1;
    } else if (this.data.lastActiveDate !== today) {
      const yesterdayDate = new Date(Date.now() - 86400000);
      const yesterday = yesterdayDate.toISOString().split("T")[0];
      if (this.data.lastActiveDate === yesterday) {
        this.data.streak += 1;
      } else {
        this.data.streak = 1;
      }
    }
    this.data.lastActiveDate = today;

    // 2. Comptage global des évaluations SRS
    if (!this.data.ratings) this.data.ratings = { 1: 0, 2: 0, 3: 0, 4: 0 };
    this.data.ratings[rating] = (this.data.ratings[rating] || 0) + 1;

    // 3. Suivi individuel de la carte (ID)
    if (cardId !== null && cardId !== undefined) {
      if (!this.data.cardRatings) this.data.cardRatings = {};
      this.data.cardRatings[cardId] = rating;
    }

    // 4. Activité Quotidienne
    if (!this.data.dailyActivity) this.data.dailyActivity = {};
    this.data.dailyActivity[today] = (this.data.dailyActivity[today] || 0) + 1;

    this.save();
    return { streak: this.data.streak };
  }

  getAccuracyRate() {
    const total = (this.data.ratings[1] || 0) + (this.data.ratings[2] || 0) + (this.data.ratings[3] || 0) + (this.data.ratings[4] || 0);
    if (total === 0) return 100;
    const success = (this.data.ratings[3] || 0) + (this.data.ratings[4] || 0);
    return Math.round((success / total) * 100);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const parser = new AnkiParser();
  const statsTracker = new StatsTracker();
  const libraryStore = new LibraryStore();
  const learnStore = new LearnStore();

  // Pré-chargement silencieux en arrière-plan du moteur SQLite WebAssembly (accélère le premier import)
  parser.initSql().catch((err) => {
    console.warn("Pré-chargement SQLite Wasm :", err);
  });

  // Éléments DOM principaux
  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const loadDemoBtn = document.getElementById("load-demo-btn");
  const uploadSection = document.getElementById("upload-section");
  const mainAppSection = document.getElementById("main-app-section");
  const statusToast = document.getElementById("status-toast");

  // Header Gamification Elements
  const gamificationHeader = document.getElementById("gamification-header");
  const userStreakEl = document.getElementById("user-streak");

  // Sélecteurs d'onglets
  const tabStudy = document.getElementById("tab-study");
  const tabExplorer = document.getElementById("tab-explorer");
  const tabStats = document.getElementById("tab-stats");
  const viewStudy = document.getElementById("view-study");
  const viewExplorer = document.getElementById("view-explorer");
  const viewStats = document.getElementById("view-stats");

  // Paquets & Arborescence
  const currentDeckNameEl = document.getElementById("current-deck-name");
  const deckTreeContainer = document.getElementById("deck-tree-container");
  const treeTotalCardsEl = document.getElementById("tree-total-cards");
  const clearLibraryBtn = document.getElementById("clear-library-btn");

  // Mode Révision & Chronomètre
  const cardContainer = document.getElementById("card-container");
  const cardFrontEl = document.getElementById("card-front");
  const cardBackEl = document.getElementById("card-back");
  const cardAnswerSection = document.getElementById("card-answer-section");
  const showAnswerBtn = document.getElementById("show-answer-btn");
  const ratingButtonsSection = document.getElementById("rating-buttons-section");
  const cardCounterEl = document.getElementById("card-counter");
  const cardProgressBar = document.getElementById("card-progress-bar");
  const prevCardBtn = document.getElementById("prev-card-btn");
  const nextCardBtn = document.getElementById("next-card-btn");
  const shuffleBtn = document.getElementById("shuffle-btn");
  const cardTagsEl = document.getElementById("card-tags");
  const openLearnBtn = document.getElementById("open-learn-btn");

  // Dashboard Stats Elements
  const dashStreak = document.getElementById("dash-streak");
  const dashAccuracy = document.getElementById("dash-accuracy");
  const dashTotalCards = document.getElementById("dash-total-cards");

  // Explorateur
  const searchInput = document.getElementById("search-input");
  const cardsTableBody = document.getElementById("cards-table-body");
  const explorerCardCount = document.getElementById("explorer-card-count");

  // Metrics Paquet
  const statDeckCount = document.getElementById("stat-deck-count");
  const statCardCount = document.getElementById("stat-card-count");
  const statNoteCount = document.getElementById("stat-note-count");
  const statMediaCount = document.getElementById("stat-media-count");
  const statTagsContainer = document.getElementById("stat-tags-container");

  // État de l'application
  let currentDeckNode = null;
  let currentCards = [];
  let currentIndex = 0;
  let isAnswerShown = false;
  let styleElement = null;

  // Chart instances
  let chartRatingsInstance = null;
  let chartActivityInstance = null;

  updateHeaderGamification();

  // --- Chargement de la bibliothèque IndexedDB au démarrage ---
  await loadLibraryFromStorage();

  async function loadLibraryFromStorage() {
    try {
      const savedPackages = await libraryStore.getAllPackages();
      renderSavedPackagesList(savedPackages);
      if (savedPackages.length > 0) {
        const latest = savedPackages.sort((a, b) => b.timestamp - a.timestamp)[0];
        showStatus(`Chargement de '${latest.name}' depuis votre bibliothèque...`);
        await parser.loadApkg(latest.buffer);
        populateDecksAndTree(Array.from(parser.decks.values()));
        updateGlobalStats({
          decks: Array.from(parser.decks.values()),
          totalNotes: parser.notes.size,
          totalCards: parser.cards.length,
          totalMedia: parser.mediaMap.size,
        });
        uploadSection.classList.add("hidden");
        mainAppSection.classList.remove("hidden");
      }
    } catch (e) {
      console.warn("Impossible de charger la bibliothèque IndexedDB :", e);
    }
  }

  function renderSavedPackagesList(packages) {
    const container = document.getElementById("saved-packages-list");
    const countBadge = document.getElementById("library-count-badge");
    if (countBadge) countBadge.textContent = packages.length;
    if (!container) return;

    container.innerHTML = "";
    if (packages.length === 0) {
      container.innerHTML = "<span class='text-slate-400 italic'>Aucun paquet sauvegardé</span>";
      return;
    }

    packages.forEach((pkg) => {
      const div = document.createElement("div");
      div.className = "flex items-center justify-between py-1 px-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 group cursor-pointer transition-colors";
      div.innerHTML = `
        <span class="truncate max-w-[130px] text-slate-700 dark:text-slate-300 font-medium" title="${pkg.name}">${pkg.name}</span>
        <button class="delete-pkg-btn text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5" title="Supprimer de la bibliothèque">🗑️</button>
      `;

      div.addEventListener("click", async (e) => {
        if (e.target.classList.contains("delete-pkg-btn")) {
          e.stopPropagation();
          await libraryStore.deletePackage(pkg.id);
          const updated = await libraryStore.getAllPackages();
          renderSavedPackagesList(updated);
          showStatus(`Paquet '${pkg.name}' supprimé.`);
          return;
        }
        await parser.loadApkg(pkg.buffer);
        populateDecksAndTree(Array.from(parser.decks.values()));
      });

      container.appendChild(div);
    });
  }

  if (clearLibraryBtn) {
    clearLibraryBtn.addEventListener("click", async () => {
      if (confirm("Voulez-vous vider tous les paquets enregistrés dans votre bibliothèque ?")) {
        await libraryStore.clearAll();
        renderSavedPackagesList([]);
        showStatus("Bibliothèque vidée.");
      }
    });
  }

  function updateHeaderGamification() {
    if (!userStreakEl) return;
    userStreakEl.textContent = `${statsTracker.data.streak}j`;
    if (gamificationHeader) gamificationHeader.classList.remove("hidden");
  }


  // --- Notifications Toast ---
  function showStatus(message, isError = false) {
    statusToast.textContent = message;
    statusToast.className = `fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 transition-all duration-300 transform translate-y-0 ${
      isError ? "bg-red-600 text-white" : "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900"
    }`;
    statusToast.classList.remove("hidden", "opacity-0", "translate-y-4");

    setTimeout(() => {
      statusToast.classList.add("opacity-0", "translate-y-4");
      setTimeout(() => statusToast.classList.add("hidden"), 300);
    }, 3500);
  }

  // --- Chargement de fichier .apkg ---
  async function handleFile(file) {
    if (!file) return;
    try {
      showStatus("Lecture et décompression du paquet...");
      const arrayBuffer = await file.arrayBuffer();

      // 1. Décodage et chargement immédiat des cartes (prioritaire)
      const result = await parser.loadApkg(arrayBuffer, (msg) => showStatus(msg));

      populateDecksAndTree(result.decks);
      updateGlobalStats(result);
      switchTab("study");

      uploadSection.classList.add("hidden");
      mainAppSection.classList.remove("hidden");
      showStatus(`Paquet '${file.name}' chargé avec succès ! (${result.totalCards} cartes)`);

      // 2. Sauvegarde facultative dans IndexedDB (Session Anatole) en arrière-plan
      try {
        await libraryStore.savePackage(file.name, file.name, arrayBuffer);
        const savedPackages = await libraryStore.getAllPackages();
        renderSavedPackagesList(savedPackages);
      } catch (storageErr) {
        console.warn("Sauvegarde IndexedDB ignorée :", storageErr);
      }
    } catch (err) {
      console.error("Erreur chargement paquet :", err);
      showStatus(`Erreur : ${err.message}`, true);
      alert(`Impossible d'ouvrir le fichier '${file.name}' :\n\n${err.message}\n\nSi le problème persiste, vérifiez votre connexion Internet pour le téléchargement du moteur SQLite WebAssembly ou rafraîchissez la page sans cache (Ctrl + F5).`);
    }
  }

  // Clic direct n'importe où dans la zone de drag & drop
  dropZone.addEventListener("click", (e) => {
    if (e.target !== fileInput && !e.target.closest("label")) {
      fileInput.value = "";
      fileInput.click();
    }
  });

  // Réinitialiser la valeur du sélecteur à chaque clic
  fileInput.addEventListener("click", () => {
    fileInput.value = "";
  });

  // Drag & drop
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add("border-blue-500", "bg-blue-50/50", "dark:bg-blue-900/20");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove("border-blue-500", "bg-blue-50/50", "dark:bg-blue-900/20");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // Chargement du paquet démo direct (si présent)
  loadDemoBtn?.addEventListener("click", async () => {
    try {
      showStatus("Téléchargement du paquet de démonstration...");
      const response = await fetch("demo_deck.apkg");
      if (!response.ok) throw new Error("Fichier demo_deck.apkg introuvable sur le serveur.");
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();

      await libraryStore.savePackage("demo_deck.apkg", "Démo - Web & Python", arrayBuffer);
      const savedPackages = await libraryStore.getAllPackages();
      renderSavedPackagesList(savedPackages);

      const result = await parser.loadApkg(arrayBuffer);
      populateDecksAndTree(result.decks);
      updateGlobalStats(result);
      switchTab("study");

      uploadSection.classList.add("hidden");
      mainAppSection.classList.remove("hidden");
      showStatus("Paquet démo chargé et enregistré dans votre bibliothèque !");
    } catch (err) {
      showStatus(`Impossible de charger le paquet démo : ${err.message}`, true);
    }
  });

  document.getElementById("btn-new-deck").addEventListener("click", () => {
    fileInput.value = "";
    uploadSection.classList.remove("hidden");
    mainAppSection.classList.add("hidden");
  });

  // --- Gestion des Decks & Arborescence (+/-) ---
  function populateDecksAndTree(decks) {
    const rootNodes = buildTreeFromDecks(decks);
    renderDeckTree(rootNodes, deckTreeContainer);

    if (treeTotalCardsEl) {
      treeTotalCardsEl.textContent = `${parser.cards.length} cartes au total`;
    }

    if (rootNodes.length > 0) {
      selectDeckByNode(rootNodes[0]);
    }
  }

  function buildTreeFromDecks(decks) {
    const rootNodes = [];
    const nodeMap = new Map();

    const activeDecks = decks.filter((d) => d.cards.length > 0 || d.name !== "Default");
    const listToProcess = activeDecks.length > 0 ? activeDecks : decks;

    listToProcess.forEach((deck) => {
      const parts = deck.name.split("::");
      let currentPath = "";

      parts.forEach((part, idx) => {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}::${part}` : part;

        if (!nodeMap.has(currentPath)) {
          const newNode = {
            path: currentPath,
            name: part,
            deckId: idx === parts.length - 1 ? deck.id : null,
            cards: [],
            children: [],
            isExpanded: true,
          };
          nodeMap.set(currentPath, newNode);

          if (parentPath && nodeMap.has(parentPath)) {
            nodeMap.get(parentPath).children.push(newNode);
          } else {
            rootNodes.push(newNode);
          }
        }

        if (idx === parts.length - 1) {
          nodeMap.get(currentPath).cards = deck.cards;
          nodeMap.get(currentPath).deckId = deck.id;
        }
      });
    });

    return rootNodes;
  }

  function renderDeckTree(treeNodes, containerEl) {
    if (!containerEl) return;
    containerEl.innerHTML = "";
    if (treeNodes.length === 0) {
      containerEl.innerHTML = "<span class='text-slate-400 text-xs italic'>Aucun paquet trouvé</span>";
      return;
    }

    function createTreeNodeHTML(node, isRootLevel = false) {
      const wrapper = document.createElement("div");
      wrapper.className = "tree-node-wrapper space-y-0.5";

      const subCards = getAllCardsInSubtree(node);
      const totalCardsInSubtree = subCards.length;
      const hasChildren = node.children.length > 0;
      const isSelected = currentDeckNode && currentDeckNode.path === node.path;

      const itemDiv = document.createElement("div");
      itemDiv.className = `tree-item flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
        isSelected ? "tree-node-selected" : ""
      }`;

      itemDiv.innerHTML = `
        <div class="flex items-center space-x-1.5 truncate">
          ${
            hasChildren
              ? `<span class="tree-toggle-btn">${node.isExpanded ? "−" : "+"}</span>`
              : `<span class="text-slate-400 font-mono text-[10px]">•</span>`
          }
          <span class="font-medium text-slate-800 dark:text-slate-200 truncate">${node.name}</span>
        </div>
        <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">${totalCardsInSubtree}</span>
      `;

      itemDiv.addEventListener("click", (e) => {
        if (e.target.classList.contains("tree-toggle-btn")) {
          e.stopPropagation();
          node.isExpanded = !node.isExpanded;
          renderDeckTree(treeNodes, containerEl);
          return;
        }
        selectDeckByNode(node);
      });

      wrapper.appendChild(itemDiv);

      // Affichage des statistiques de début de branche (uniquement au niveau racine, pas sous-dossiers)
      if (isRootLevel && totalCardsInSubtree > 0) {
        let knownCount = 0;
        subCards.forEach((c) => {
          const r = statsTracker.data.cardRatings ? statsTracker.data.cardRatings[c.id] : 0;
          if (r === 3 || r === 4) knownCount++;
        });
        const remainingCount = totalCardsInSubtree - knownCount;

        const rootStatsDiv = document.createElement("div");
        rootStatsDiv.className = "flex items-center space-x-2 text-[10px] text-slate-500 dark:text-slate-400 pl-4 py-0.5 border-b border-slate-100 dark:border-slate-800 mb-1";
        rootStatsDiv.innerHTML = `
          <span class="text-emerald-600 dark:text-emerald-400 font-semibold">🟢 ${knownCount} connues</span>
          <span>·</span>
          <span class="text-amber-600 dark:text-amber-400 font-semibold">🔄 ${remainingCount} à réviser</span>
        `;
        wrapper.appendChild(rootStatsDiv);
      }

      if (hasChildren && node.isExpanded) {
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "tree-children pl-3 space-y-0.5 border-l border-slate-200 dark:border-slate-700 ml-2 mt-0.5";
        node.children.forEach((child) => {
          childrenContainer.appendChild(createTreeNodeHTML(child, false));
        });
        wrapper.appendChild(childrenContainer);
      }

      return wrapper;
    }

    treeNodes.forEach((rootNode) => {
      containerEl.appendChild(createTreeNodeHTML(rootNode, true));
    });
  }

  function getAllCardsInSubtree(node) {
    let cards = [...node.cards];
    node.children.forEach((child) => {
      cards = cards.concat(getAllCardsInSubtree(child));
    });
    return cards;
  }

  function selectDeckByNode(node) {
    currentDeckNode = node;
    const subCards = getAllCardsInSubtree(node);
    currentDeckNameEl.textContent = node.path;
    currentCards = subCards;
    currentIndex = 0;
    renderCurrentCard();
    renderExplorerTable();

    const rootNodes = buildTreeFromDecks(Array.from(parser.decks.values()));
    renderDeckTree(rootNodes, deckTreeContainer);
  }

  // Mélanger les cartes
  shuffleBtn.addEventListener("click", () => {
    for (let i = currentCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [currentCards[i], currentCards[j]] = [currentCards[j], currentCards[i]];
    }
    currentIndex = 0;
    renderCurrentCard();
    showStatus("Cartes mélangées !");
  });

  // --- Mode Révision (Flashcards) ---
  function renderCurrentCard() {
    isAnswerShown = false;
    cardAnswerSection.classList.add("hidden");
    ratingButtonsSection.classList.add("hidden");
    showAnswerBtn.classList.remove("hidden");

    if (currentCards.length === 0) {
      cardFrontEl.innerHTML = `<p class="text-gray-400 italic py-8">Aucune carte dans ce paquet.</p>`;
      cardCounterEl.textContent = "0 / 0";
      cardProgressBar.style.width = "0%";
      cardTagsEl.innerHTML = "";
      return;
    }

    const card = currentCards[currentIndex];
    const rendered = parser.renderCard(card);

    if (!styleElement) {
      styleElement = document.createElement("style");
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = rendered.css;

    cardFrontEl.innerHTML = rendered.front || "<span class='italic text-gray-400'>[Recto vide]</span>";
    cardBackEl.innerHTML = rendered.back || "<span class='italic text-gray-400'>[Verso vide]</span>";

    const currentNumber = currentIndex + 1;
    const total = currentCards.length;
    cardCounterEl.textContent = `${currentNumber} / ${total}`;
    cardProgressBar.style.width = `${(currentNumber / total) * 100}%`;

    cardTagsEl.innerHTML = "";
    if (card.note && card.note.tags.length > 0) {
      card.note.tags.forEach((tag) => {
        const span = document.createElement("span");
        span.className = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";
        span.textContent = `#${tag}`;
        cardTagsEl.appendChild(span);
      });
    }

    cardContainer.scrollTop = 0;
    triggerMathJax();
  }

  function showAnswer() {
    if (isAnswerShown) return;
    isAnswerShown = true;

    cardAnswerSection.classList.remove("hidden");
    showAnswerBtn.classList.add("hidden");
    ratingButtonsSection.classList.remove("hidden");
    triggerMathJax();
  }

  function triggerMathJax() {
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      const container = document.getElementById("card-container");
      if (container) {
        window.MathJax.typesetPromise([container]).catch((err) => console.warn("MathJax error:", err));
      }
    }
  }

  function handleRating(rating) {
    const currentCard = currentCards[currentIndex];
    const cardId = currentCard ? currentCard.id : null;
    statsTracker.recordReview(rating, cardId);

    updateHeaderGamification();
    nextCard();
    renderAnalyticsDashboard();

    const rootNodes = buildTreeFromDecks(Array.from(parser.decks.values()));
    renderDeckTree(rootNodes, deckTreeContainer);
  }

  function nextCard() {
    if (currentIndex < currentCards.length - 1) {
      currentIndex++;
      renderCurrentCard();
    } else {
      showStatus("Vous avez parcouru toutes les cartes de ce paquet ! 🎉");
    }
  }

  function prevCard() {
    if (currentIndex > 0) {
      currentIndex--;
      renderCurrentCard();
    }
  }

  showAnswerBtn.addEventListener("click", showAnswer);
  prevCardBtn.addEventListener("click", prevCard);
  nextCardBtn.addEventListener("click", nextCard);

  if (openLearnBtn) {
    openLearnBtn.addEventListener("click", async () => {
      if (!currentCards || currentCards.length === 0) {
        showStatus("Aucune carte à apprendre dans ce paquet !", true);
        return;
      }
      const deckName = (currentDeckNode && currentDeckNode.path) || "Paquet Anki";

      showStatus("Préparation du Mode Apprentissage...");

      // Préparation des cartes avec rendu HTML, images et mathématiques
      const learnCards = currentCards.map((card) => {
        const rendered = parser.renderCard(card);
        return {
          id: card.id,
          deckName: (card.deck && card.deck.name) || deckName,
          front: rendered.front || "",
          back: rendered.back || "",
          css: rendered.css || "",
          tags: (card.note && card.note.tags) || [],
        };
      });

      const sessionPayload = {
        deckName: deckName,
        totalCards: learnCards.length,
        timestamp: Date.now(),
        cards: learnCards,
      };

      try {
        // Enregistrement dans IndexedDB (capacité illimitée, sans blocage de quota)
        await learnStore.setActiveDeck(sessionPayload);
        try { localStorage.removeItem("anki_learn_active_deck"); } catch (e) {}
        window.open("learn.html", "_blank");
      } catch (err) {
        console.error("Erreur préparation session apprentissage :", err);
        showStatus("Impossible d'ouvrir le Mode Apprentissage : " + err.message, true);
      }
    });
  }

  document.querySelector(".rating-1")?.addEventListener("click", () => handleRating(1));
  document.querySelector(".rating-2")?.addEventListener("click", () => handleRating(2));
  document.querySelector(".rating-3")?.addEventListener("click", () => handleRating(3));
  document.querySelector(".rating-4")?.addEventListener("click", () => handleRating(4));

  // --- Raccourcis Clavier Ergonomiques ---
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (mainAppSection.classList.contains("hidden")) return;
    if (viewStudy.classList.contains("hidden")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (!isAnswerShown) showAnswer();
      else nextCard();
    } else if (e.code === "ArrowRight") {
      nextCard();
    } else if (e.code === "ArrowLeft") {
      prevCard();
    } else if (isAnswerShown) {
      if (e.code === "Digit1") handleRating(1);
      else if (e.code === "Digit2") handleRating(2);
      else if (e.code === "Digit3") handleRating(3);
      else if (e.code === "Digit4") handleRating(4);
    }
  });

  // --- Explorateur de cartes (Table) ---
  function renderExplorerTable() {
    cardsTableBody.innerHTML = "";
    const filter = (searchInput.value || "").toLowerCase().trim();

    const filteredCards = currentCards.filter((card) => {
      if (!filter) return true;
      const flds = (card.note?.rawFields || []).join(" ").toLowerCase();
      const tags = (card.note?.tags || []).join(" ").toLowerCase();
      return flds.includes(filter) || tags.includes(filter);
    });

    explorerCardCount.textContent = `${filteredCards.length} carte(s) affichée(s)`;

    filteredCards.slice(0, 100).forEach((card, idx) => {
      const rendered = parser.renderCard(card);
      const tr = document.createElement("tr");
      tr.className = "hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer border-b border-slate-200 dark:border-slate-800 transition-colors";

      const frontClean = stripHtml(rendered.front);
      const backClean = stripHtml(rendered.back);
      const tagsStr = (card.note?.tags || []).join(", ") || "-";

      tr.innerHTML = `
        <td class="py-3 px-3 text-xs font-mono text-slate-400">${idx + 1}</td>
        <td class="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200 max-w-xs truncate">${frontClean}</td>
        <td class="py-3 px-4 text-sm text-slate-600 dark:text-slate-400 max-w-xs truncate">${backClean}</td>
        <td class="py-3 px-4 text-xs text-slate-500">${tagsStr}</td>
      `;

      tr.addEventListener("click", () => {
        const foundIdx = currentCards.findIndex((c) => c.id === card.id);
        if (foundIdx !== -1) {
          currentIndex = foundIdx;
          switchTab("study");
          renderCurrentCard();
        }
      });

      cardsTableBody.appendChild(tr);
    });
  }

  searchInput.addEventListener("input", renderExplorerTable);

  function stripHtml(html) {
    if (!html) return "";
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    const tmp = document.createElement("div");
    tmp.innerHTML = cleanHtml;
    return tmp.textContent || tmp.innerText || "";
  }

  // --- Statistiques globales & Analytics ---
  function updateGlobalStats(result) {
    statDeckCount.textContent = result.decks.length;
    statCardCount.textContent = result.totalCards;
    statNoteCount.textContent = result.totalNotes;
    statMediaCount.textContent = result.totalMedia;

    const allTags = new Set();
    for (const note of parser.notes.values()) {
      note.tags.forEach((t) => allTags.add(t));
    }

    statTagsContainer.innerHTML = "";
    if (allTags.size === 0) {
      statTagsContainer.innerHTML = "<span class='text-sm text-gray-400'>Aucun tag trouvé.</span>";
    } else {
      allTags.forEach((tag) => {
        const badge = document.createElement("span");
        badge.className = "px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300";
        badge.textContent = `#${tag}`;
        statTagsContainer.appendChild(badge);
      });
    }

    renderAnalyticsDashboard();
  }

  function renderAnalyticsDashboard() {
    if (dashStreak) dashStreak.textContent = `${statsTracker.data.streak} jour(s)`;
    if (dashAccuracy) dashAccuracy.textContent = `${statsTracker.getAccuracyRate()}%`;
    
    const dashTotalCards = document.getElementById("dash-total-cards");
    if (dashTotalCards) dashTotalCards.textContent = parser.cards ? parser.cards.length : 0;

    renderRootDecksStats();
    renderHeatmap();
    renderCharts();
  }

  function renderRootDecksStats() {
    const container = document.getElementById("root-decks-stats-container");
    const countEl = document.getElementById("root-decks-count");
    if (!container) return;

    container.innerHTML = "";
    if (!parser || !parser.decks || parser.decks.size === 0) {
      container.innerHTML = "<span class='text-xs text-slate-400 italic'>Aucun paquet chargé.</span>";
      if (countEl) countEl.textContent = "0 paquet(s) racine";
      return;
    }

    const decks = Array.from(parser.decks.values());
    const rootNodes = buildTreeFromDecks(decks);

    if (countEl) countEl.textContent = `${rootNodes.length} paquet(s) racine`;

    rootNodes.forEach((rootNode) => {
      const rootCards = getAllCardsInSubtree(rootNode);
      const totalCards = rootCards.length;

      let aRevoir = 0;   // 1
      let difficile = 0; // 2
      let correct = 0;   // 3
      let facile = 0;    // 4
      let nonRevise = 0; // 0

      rootCards.forEach((c) => {
        const r = statsTracker.data.cardRatings ? statsTracker.data.cardRatings[c.id] : 0;
        if (r === 1) aRevoir++;
        else if (r === 2) difficile++;
        else if (r === 3) correct++;
        else if (r === 4) facile++;
        else nonRevise++;
      });

      const knownCount = correct + facile;
      const remainingCount = totalCards - knownCount;
      const knownPct = totalCards > 0 ? Math.round((knownCount / totalCards) * 100) : 0;

      // Segments de la barre visuelle
      const pctRevoir = totalCards > 0 ? (aRevoir / totalCards) * 100 : 0;
      const pctDiff = totalCards > 0 ? (difficile / totalCards) * 100 : 0;
      const pctCorr = totalCards > 0 ? (correct / totalCards) * 100 : 0;
      const pctFacile = totalCards > 0 ? (facile / totalCards) * 100 : 0;
      const pctNonRev = totalCards > 0 ? (nonRevise / totalCards) * 100 : 0;

      const cardDiv = document.createElement("div");
      cardDiv.className = "p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 space-y-3";

      cardDiv.innerHTML = `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center space-x-2">
            <span class="text-base">📁</span>
            <span class="font-bold text-slate-900 dark:text-white text-sm">${rootNode.name}</span>
            <span class="text-xs text-slate-500 font-mono">(${totalCards} carte${totalCards > 1 ? "s" : ""})</span>
          </div>
          <div class="flex items-center space-x-2 text-xs font-semibold">
            <span class="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
              🟢 ${knownCount} connues (${knownPct}%)
            </span>
            <span class="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50">
              🔄 ${remainingCount} à réviser
            </span>
          </div>
        </div>

        <!-- Barre de répartition multi-segment -->
        <div class="w-full h-3 rounded-full bg-slate-200 dark:bg-slate-700 flex overflow-hidden shadow-inner" title="Répartition des cartes">
          ${pctRevoir > 0 ? `<div style="width: ${pctRevoir}%" class="bg-red-500" title="À revoir : ${aRevoir}"></div>` : ""}
          ${pctDiff > 0 ? `<div style="width: ${pctDiff}%" class="bg-amber-500" title="Difficile : ${difficile}"></div>` : ""}
          ${pctCorr > 0 ? `<div style="width: ${pctCorr}%" class="bg-blue-500" title="Correct : ${correct}"></div>` : ""}
          ${pctFacile > 0 ? `<div style="width: ${pctFacile}%" class="bg-emerald-500" title="Facile : ${facile}"></div>` : ""}
          ${pctNonRev > 0 ? `<div style="width: ${pctNonRev}%" class="bg-slate-300 dark:bg-slate-600" title="Non révisées : ${nonRevise}"></div>` : ""}
        </div>

        <!-- Détail chiffré de la répartition -->
        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div class="flex items-center space-x-1.5 p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span class="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
            <span class="text-slate-600 dark:text-slate-400">À revoir:</span>
            <span class="font-bold text-slate-900 dark:text-white ml-auto">${aRevoir}</span>
          </div>
          <div class="flex items-center space-x-1.5 p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
            <span class="text-slate-600 dark:text-slate-400">Difficile:</span>
            <span class="font-bold text-slate-900 dark:text-white ml-auto">${difficile}</span>
          </div>
          <div class="flex items-center space-x-1.5 p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span class="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
            <span class="text-slate-600 dark:text-slate-400">Correct:</span>
            <span class="font-bold text-slate-900 dark:text-white ml-auto">${correct}</span>
          </div>
          <div class="flex items-center space-x-1.5 p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
            <span class="text-slate-600 dark:text-slate-400">Facile:</span>
            <span class="font-bold text-slate-900 dark:text-white ml-auto">${facile}</span>
          </div>
          <div class="flex items-center space-x-1.5 p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span class="w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-600 inline-block"></span>
            <span class="text-slate-600 dark:text-slate-400">Non révisées:</span>
            <span class="font-bold text-slate-900 dark:text-white ml-auto">${nonRevise}</span>
          </div>
        </div>
      `;

      container.appendChild(cardDiv);
    });
  }

  function renderHeatmap() {
    const container = document.getElementById("retention-heatmap");
    const totalLabel = document.getElementById("heatmap-total-reviews");
    if (!container) return;

    container.innerHTML = "";
    const days = 60;
    let totalCount = 0;

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const dateStr = d.toISOString().split("T")[0];
      const count = statsTracker.data.dailyActivity[dateStr] || 0;
      totalCount += count;

      let levelClass = "heatmap-level-0";
      if (count >= 20) levelClass = "heatmap-level-4";
      else if (count >= 10) levelClass = "heatmap-level-3";
      else if (count >= 5) levelClass = "heatmap-level-2";
      else if (count >= 1) levelClass = "heatmap-level-1";

      const cell = document.createElement("div");
      cell.className = `heatmap-cell ${levelClass}`;
      cell.title = `${d.toLocaleDateString("fr-FR")} : ${count} révision(s)`;
      container.appendChild(cell);
    }

    if (totalLabel) {
      totalLabel.textContent = `${totalCount} révision(s) sur les 60 derniers jours`;
    }
  }

  function renderCharts() {
    const ctxRatings = document.getElementById("chart-ratings");
    if (ctxRatings && typeof Chart !== "undefined") {
      if (chartRatingsInstance) chartRatingsInstance.destroy();

      const r = statsTracker.data.ratings;
      chartRatingsInstance = new Chart(ctxRatings, {
        type: 'doughnut',
        data: {
          labels: ['À revoir', 'Difficile', 'Correct', 'Facile'],
          datasets: [{
            data: [r[1] || 0, r[2] || 0, r[3] || 0, r[4] || 0],
            backgroundColor: ['#ef4444', '#f59e0b', '#3b82f6', '#10b981'],
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } }
          }
        }
      });
    }

    const ctxActivity = document.getElementById("chart-activity");
    if (ctxActivity && typeof Chart !== "undefined") {
      if (chartActivityInstance) chartActivityInstance.destroy();

      const last7Days = [];
      const counts = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dStr = d.toISOString().split("T")[0];
        const dayLabel = d.toLocaleDateString("fr-FR", { weekday: 'short', day: 'numeric' });
        last7Days.push(dayLabel);
        counts.push(statsTracker.data.dailyActivity[dStr] || 0);
      }

      chartActivityInstance = new Chart(ctxActivity, {
        type: 'bar',
        data: {
          labels: last7Days,
          datasets: [{
            label: 'Cartes révisées',
            data: counts,
            backgroundColor: '#3b82f6',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true, ticks: { stepSize: 1 } }
          },
          plugins: {
            legend: { display: false }
          }
        }
      });
    }
  }

  // --- Gestion des Onglets ---
  function switchTab(tabName) {
    [tabStudy, tabExplorer, tabStats].forEach((tab) => {
      tab.classList.remove("text-blue-600", "dark:text-blue-400", "border-b-2", "border-blue-600", "dark:border-blue-400", "font-semibold");
      tab.classList.add("text-slate-600", "dark:text-slate-400");
    });
    [viewStudy, viewExplorer, viewStats].forEach((v) => v.classList.add("hidden"));

    if (tabName === "study") {
      tabStudy.classList.add("text-blue-600", "dark:text-blue-400", "border-b-2", "border-blue-600", "dark:border-blue-400", "font-semibold");
      tabStudy.classList.remove("text-slate-600", "dark:text-slate-400");
      viewStudy.classList.remove("hidden");
    } else if (tabName === "explorer") {
      tabExplorer.classList.add("text-blue-600", "dark:text-blue-400", "border-b-2", "border-blue-600", "dark:border-blue-400", "font-semibold");
      tabExplorer.classList.remove("text-slate-600", "dark:text-slate-400");
      viewExplorer.classList.remove("hidden");
      renderExplorerTable();
    } else if (tabName === "stats") {
      tabStats.classList.add("text-blue-600", "dark:text-blue-400", "border-b-2", "border-blue-600", "dark:border-blue-400", "font-semibold");
      tabStats.classList.remove("text-slate-600", "dark:text-slate-400");
      viewStats.classList.remove("hidden");
      renderAnalyticsDashboard();
    }
  }

  tabStudy.addEventListener("click", () => switchTab("study"));
  tabExplorer.addEventListener("click", () => switchTab("explorer"));
  tabStats.addEventListener("click", () => switchTab("stats"));
});
