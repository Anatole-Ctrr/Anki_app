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
        return JSON.parse(raw);
      } catch (e) {}
    }
    return {
      streak: 0,
      lastActiveDate: null,
      xp: 0,
      ratings: { 1: 0, 2: 0, 3: 0, 4: 0 },
      dailyActivity: {},
      responseTimes: [],
    };
  }

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
  }

  recordReview(rating, timeInSec) {
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

    // 2. Calcul des Points d'Expérience (XP)
    let addedXp = 10;
    if (rating === 4 || (timeInSec > 0 && timeInSec < 5.0)) {
      addedXp += 5; // Bonus réponse rapide ou facile
    }
    this.data.xp += addedXp;

    // 3. Comptage des Évaluations SRS
    this.data.ratings[rating] = (this.data.ratings[rating] || 0) + 1;

    // 4. Activité Quotidienne
    this.data.dailyActivity[today] = (this.data.dailyActivity[today] || 0) + 1;

    // 5. Historique du Temps de Réponse (limité aux 200 dernières révisions)
    if (timeInSec > 0 && timeInSec < 300) {
      this.data.responseTimes.push(parseFloat(timeInSec.toFixed(1)));
      if (this.data.responseTimes.length > 200) this.data.responseTimes.shift();
    }

    this.save();
    return { xpGained: addedXp, totalXp: this.data.xp, streak: this.data.streak };
  }

  getAccuracyRate() {
    const total = (this.data.ratings[1] || 0) + (this.data.ratings[2] || 0) + (this.data.ratings[3] || 0) + (this.data.ratings[4] || 0);
    if (total === 0) return 100;
    const success = (this.data.ratings[3] || 0) + (this.data.ratings[4] || 0);
    return Math.round((success / total) * 100);
  }

  getAverageResponseTime() {
    if (!this.data.responseTimes || this.data.responseTimes.length === 0) return 0;
    const sum = this.data.responseTimes.reduce((a, b) => a + b, 0);
    return (sum / this.data.responseTimes.length).toFixed(1);
  }

  getLevel() {
    return Math.floor(this.data.xp / 100) + 1;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const parser = new AnkiParser();
  const statsTracker = new StatsTracker();
  const libraryStore = new LibraryStore();

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
  const userXpEl = document.getElementById("user-xp");
  const userLevelEl = document.getElementById("user-level");

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
  const cardTimerEl = document.getElementById("card-timer");
  const starCardBtn = document.getElementById("star-card-btn");
  const filterStarredBtn = document.getElementById("filter-starred-btn");
  const starredCountBadge = document.getElementById("starred-count-badge");

  // Dashboard Stats Elements
  const dashStreak = document.getElementById("dash-streak");
  const dashXp = document.getElementById("dash-xp");
  const dashAvgTime = document.getElementById("dash-avg-time");
  const dashAccuracy = document.getElementById("dash-accuracy");

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

  // Chronomètre variables
  let timerStartTime = 0;
  let timerInterval = null;
  let currentCardResponseTime = 0;

  // Chart instances
  let chartRatingsInstance = null;
  let chartActivityInstance = null;

  // --- Marquage Étoile ⭐ (Quizlet Mode) ---
  const STARRED_KEY = "anki_starred_cards_v1";
  let starredCardIds = new Set(JSON.parse(localStorage.getItem(STARRED_KEY) || "[]"));
  let isStarredOnlyMode = false;

  function saveStarredCards() {
    localStorage.setItem(STARRED_KEY, JSON.stringify(Array.from(starredCardIds)));
    updateStarredBadge();
  }

  function toggleStarCard(cardId) {
    if (!cardId) return;
    if (starredCardIds.has(cardId)) {
      starredCardIds.delete(cardId);
      showStatus("Étoile retirée de la carte");
    } else {
      starredCardIds.add(cardId);
      showStatus("Carte marquée d'une étoile ⭐ !");
    }
    saveStarredCards();
    updateStarUI();
    renderExplorerTable();
  }

  function updateStarredBadge() {
    if (starredCountBadge) starredCountBadge.textContent = starredCardIds.size;
  }

  function updateStarUI() {
    if (!starCardBtn) return;
    if (currentCards.length === 0) {
      starCardBtn.classList.remove("star-active");
      return;
    }
    const card = currentCards[currentIndex];
    if (card && starredCardIds.has(card.id)) {
      starCardBtn.classList.add("star-active");
    } else {
      starCardBtn.classList.remove("star-active");
    }
  }

  if (starCardBtn) {
    starCardBtn.addEventListener("click", () => {
      if (currentCards.length > 0) {
        toggleStarCard(currentCards[currentIndex].id);
      }
    });
  }

  if (filterStarredBtn) {
    filterStarredBtn.addEventListener("click", () => {
      isStarredOnlyMode = !isStarredOnlyMode;
      filterStarredBtn.classList.toggle("bg-amber-500", isStarredOnlyMode);
      filterStarredBtn.classList.toggle("text-white", isStarredOnlyMode);

      if (isStarredOnlyMode) {
        showStatus("Mode Quizlet activé : Révision des cartes marquées ⭐ uniquement.");
      } else {
        showStatus("Mode normal rétabli.");
      }

      if (currentDeckNode) {
        selectDeckByNode(currentDeckNode);
      } else if (parser.decks.size > 0) {
        const rootNodes = buildTreeFromDecks(Array.from(parser.decks.values()));
        if (rootNodes.length > 0) selectDeckByNode(rootNodes[0]);
      }
    });
  }

  updateStarredBadge();
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
    userXpEl.textContent = `${statsTracker.data.xp} XP`;
    userLevelEl.textContent = `Niv. ${statsTracker.getLevel()}`;
    if (gamificationHeader) gamificationHeader.classList.remove("hidden");
  }

  // --- Gestion du Chronomètre ---
  function startCardTimer() {
    stopCardTimer();
    timerStartTime = Date.now();
    currentCardResponseTime = 0;
    if (cardTimerEl) cardTimerEl.textContent = "0.0s";

    timerInterval = setInterval(() => {
      const elapsed = (Date.now() - timerStartTime) / 1000;
      if (cardTimerEl) cardTimerEl.textContent = `${elapsed.toFixed(1)}s`;
    }, 100);
  }

  function stopCardTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      if (timerStartTime > 0) {
        currentCardResponseTime = (Date.now() - timerStartTime) / 1000;
      }
    }
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
      showStatus("Analyse et enregistrement du paquet...");
      const arrayBuffer = await file.arrayBuffer();

      // Sauvegarde dans IndexedDB (Session Anatole)
      await libraryStore.savePackage(file.name, file.name, arrayBuffer);
      const savedPackages = await libraryStore.getAllPackages();
      renderSavedPackagesList(savedPackages);

      const result = await parser.loadApkg(arrayBuffer, (msg) => showStatus(msg));

      populateDecksAndTree(result.decks);
      updateGlobalStats(result);
      switchTab("study");

      uploadSection.classList.add("hidden");
      mainAppSection.classList.remove("hidden");
      showStatus(`Paquet '${file.name}' enregistré et chargé ! (${result.totalCards} cartes)`);
    } catch (err) {
      console.error(err);
      showStatus(`Erreur : ${err.message}`, true);
    }
  }

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

  // Chargement du paquet démo direct
  loadDemoBtn.addEventListener("click", async () => {
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

    function createTreeNodeHTML(node) {
      const wrapper = document.createElement("div");
      wrapper.className = "tree-node-wrapper space-y-0.5";

      const subCards = getAllCardsInSubtree(node);
      const totalCardsInSubtree = subCards.length;
      const hasChildren = node.children.length > 0;
      const isSelected = currentDeckNode && currentDeckNode.path === node.path;

      const itemDiv = document.createElement("div");
      itemDiv.className = `tree-item flex items-center justify-between px-2 py-1.5 rounded-lg text-xs cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors ${
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

      if (hasChildren && node.isExpanded) {
        const childrenContainer = document.createElement("div");
        childrenContainer.className = "tree-children pl-3 space-y-0.5 border-l border-slate-200 dark:border-slate-700 ml-2 mt-0.5";
        node.children.forEach((child) => {
          childrenContainer.appendChild(createTreeNodeHTML(child));
        });
        wrapper.appendChild(childrenContainer);
      }

      return wrapper;
    }

    treeNodes.forEach((rootNode) => {
      containerEl.appendChild(createTreeNodeHTML(rootNode));
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

    currentCards = isStarredOnlyMode
      ? subCards.filter((c) => starredCardIds.has(c.id))
      : subCards;

    currentIndex = 0;
    renderCurrentCard();
    renderExplorerTable();
    updateStarUI();

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
      const msg = isStarredOnlyMode ? "Aucune carte marquée ⭐ dans ce paquet." : "Aucune carte dans ce paquet.";
      cardFrontEl.innerHTML = `<p class="text-gray-400 italic py-8">${msg}</p>`;
      cardCounterEl.textContent = "0 / 0";
      cardProgressBar.style.width = "0%";
      cardTagsEl.innerHTML = "";
      stopCardTimer();
      updateStarUI();
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

    startCardTimer();
    cardContainer.scrollTop = 0;
    updateStarUI();
    triggerMathJax();
  }

  function showAnswer() {
    if (isAnswerShown) return;
    isAnswerShown = true;
    stopCardTimer();

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
    const res = statsTracker.recordReview(rating, currentCardResponseTime);
    updateHeaderGamification();

    if (userXpEl) {
      userXpEl.classList.add("xp-pop");
      setTimeout(() => userXpEl.classList.remove("xp-pop"), 400);
    }

    nextCard();
  }

  function nextCard() {
    if (currentIndex < currentCards.length - 1) {
      currentIndex++;
      renderCurrentCard();
    } else {
      stopCardTimer();
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
    } else if (e.key === "*" || e.code === "KeyS") {
      if (currentCards.length > 0) toggleStarCard(currentCards[currentIndex].id);
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
      const isStarred = starredCardIds.has(card.id);

      tr.innerHTML = `
        <td class="py-3 px-3 text-center text-sm star-cell">${isStarred ? "⭐" : "☆"}</td>
        <td class="py-3 px-3 text-xs font-mono text-slate-400">${idx + 1}</td>
        <td class="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200 max-w-xs truncate">${frontClean}</td>
        <td class="py-3 px-4 text-sm text-slate-600 dark:text-slate-400 max-w-xs truncate">${backClean}</td>
        <td class="py-3 px-4 text-xs text-slate-500">${tagsStr}</td>
      `;

      tr.addEventListener("click", (e) => {
        if (e.target.classList.contains("star-cell")) {
          e.stopPropagation();
          toggleStarCard(card.id);
          return;
        }
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
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
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
    if (dashXp) dashXp.textContent = `${statsTracker.data.xp} XP`;
    if (dashAvgTime) dashAvgTime.textContent = `${statsTracker.getAverageResponseTime()}s`;
    if (dashAccuracy) dashAccuracy.textContent = `${statsTracker.getAccuracyRate()}%`;

    renderHeatmap();
    renderCharts();
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
