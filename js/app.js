/**
 * Contrôleur de l'application Web Anki.
 * Gère l'interface utilisateur, la navigation, les raccourcis clavier,
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

document.addEventListener("DOMContentLoaded", () => {
  const parser = new AnkiParser();
  const statsTracker = new StatsTracker();

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

  // Sélecteur de paquet
  const deckSelect = document.getElementById("deck-select");
  const currentDeckNameEl = document.getElementById("current-deck-name");

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
  let currentDeck = null;
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

  // Initialisation de la Gamification au lancement
  updateHeaderGamification();

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

  // --- Gestion des notifications Toast ---
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
      showStatus("Analyse du fichier en cours...");
      const result = await parser.loadApkg(file, (msg) => showStatus(msg));

      populateDecks(result.decks);
      updateGlobalStats(result);
      switchTab("study");

      uploadSection.classList.add("hidden");
      mainAppSection.classList.remove("hidden");
      showStatus(`Paquet chargé avec succès ! (${result.totalCards} cartes)`);
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
    const file = e.target.files[0];
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
      await handleFile(blob);
    } catch (err) {
      showStatus(`Impossible de charger le paquet démo : ${err.message}`, true);
    }
  });

  // Nouveau paquet (recharger un autre fichier)
  document.getElementById("btn-new-deck").addEventListener("click", () => {
    fileInput.value = "";
    uploadSection.classList.remove("hidden");
    mainAppSection.classList.add("hidden");
  });

  // --- Gestion des Decks ---
  function populateDecks(decks) {
    deckSelect.innerHTML = "";
    const activeDecks = decks.filter((d) => d.cards.length > 0);
    const decksToUse = activeDecks.length > 0 ? activeDecks : decks;

    decksToUse.forEach((deck) => {
      const opt = document.createElement("option");
      opt.value = deck.id;
      opt.textContent = `${deck.name} (${deck.cards.length} cartes)`;
      deckSelect.appendChild(opt);
    });

    if (decksToUse.length > 0) {
      selectDeck(decksToUse[0].id);
    }
  }

  deckSelect.addEventListener("change", (e) => {
    selectDeck(Number(e.target.value));
  });

  function selectDeck(deckId) {
    currentDeck = parser.decks.get(deckId);
    if (!currentDeck) return;

    currentDeckNameEl.textContent = currentDeck.name;
    currentCards = [...currentDeck.cards];
    currentIndex = 0;
    renderCurrentCard();
    renderExplorerTable();
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
      stopCardTimer();
      return;
    }

    const card = currentCards[currentIndex];
    const rendered = parser.renderCard(card);

    // Injection du CSS spécifique du modèle de carte
    if (!styleElement) {
      styleElement = document.createElement("style");
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = rendered.css;

    // Rendu du recto
    cardFrontEl.innerHTML = rendered.front || "<span class='italic text-gray-400'>[Recto vide]</span>";
    cardBackEl.innerHTML = rendered.back || "<span class='italic text-gray-400'>[Verso vide]</span>";

    // Mise à jour de la pagination
    const currentNumber = currentIndex + 1;
    const total = currentCards.length;
    cardCounterEl.textContent = `${currentNumber} / ${total}`;
    cardProgressBar.style.width = `${(currentNumber / total) * 100}%`;

    // Tags
    cardTagsEl.innerHTML = "";
    if (card.note && card.note.tags.length > 0) {
      card.note.tags.forEach((tag) => {
        const span = document.createElement("span");
        span.className = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300";
        span.textContent = `#${tag}`;
        cardTagsEl.appendChild(span);
      });
    }

    // Démarrage du chronomètre pour cette carte
    startCardTimer();
    cardContainer.scrollTop = 0;

    // Rendu des formules mathématiques MathJax/LaTeX
    triggerMathJax();
  }

  function showAnswer() {
    if (isAnswerShown) return;
    isAnswerShown = true;
    stopCardTimer(); // Arrêt du chrono au dévoilement

    cardAnswerSection.classList.remove("hidden");
    showAnswerBtn.classList.add("hidden");
    ratingButtonsSection.classList.remove("hidden");

    // Rendu des formules mathématiques au verso
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

    // Effet visuel pop sur le badge XP
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

  // Évaluation SRS (Boutons 1 à 4)
  document.querySelector(".rating-1")?.addEventListener("click", () => handleRating(1));
  document.querySelector(".rating-2")?.addEventListener("click", () => handleRating(2));
  document.querySelector(".rating-3")?.addEventListener("click", () => handleRating(3));
  document.querySelector(".rating-4")?.addEventListener("click", () => handleRating(4));

  // --- Raccourcis clavier ergonomiques ---
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (mainAppSection.classList.contains("hidden")) return;
    if (viewStudy.classList.contains("hidden")) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (!isAnswerShown) {
        showAnswer();
      } else {
        nextCard();
      }
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
        <td class="py-3 px-4 text-xs font-mono text-slate-400">${idx + 1}</td>
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
    // 1. Dashboard métriques
    if (dashStreak) dashStreak.textContent = `${statsTracker.data.streak} jour(s)`;
    if (dashXp) dashXp.textContent = `${statsTracker.data.xp} XP`;
    if (dashAvgTime) dashAvgTime.textContent = `${statsTracker.getAverageResponseTime()}s`;
    if (dashAccuracy) dashAccuracy.textContent = `${statsTracker.getAccuracyRate()}%`;

    // 2. Heatmap de rétention
    renderHeatmap();

    // 3. Graphiques Chart.js
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
    // Chart 1: Ratings Doughnut
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

    // Chart 2: Daily Activity Bar
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
