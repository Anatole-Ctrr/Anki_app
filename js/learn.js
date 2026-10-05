/**
 * Moteur du Mode Apprentissage (Style Quizlet).
 * Découpe les paquets en séries (rounds) de cartes, gère les paliers
 * (Non vues -> En apprentissage -> Maîtrisées), enregistre la progression
 * de session de manière persistante et propose une interface 3D Flashcard.
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- Éléments du DOM ---
  const btnBack = document.getElementById("btn-back");
  const deckTitleEl = document.getElementById("deck-title");
  const roundBadgeEl = document.getElementById("round-badge");
  const cardStepBadgeEl = document.getElementById("card-step-badge");

  const counterUnseenEl = document.getElementById("counter-unseen");
  const counterLearningEl = document.getElementById("counter-learning");
  const counterMasteredEl = document.getElementById("counter-mastered");
  const progressBarFillEl = document.getElementById("progress-bar-fill");

  const resumeBanner = document.getElementById("resume-banner");
  const resumeInfoEl = document.getElementById("resume-info");
  const btnResumeSession = document.getElementById("btn-resume-session");
  const btnRestartSession = document.getElementById("btn-restart-session");

  const viewCard = document.getElementById("view-card");
  const cardScene = document.getElementById("card-scene");
  const cardInner = document.getElementById("card-inner");
  const cardStageIndicator = document.getElementById("card-stage-indicator");
  const cardFrontContent = document.getElementById("card-front-content");
  const cardBackContent = document.getElementById("card-back-content");

  const btnFlipCard = document.getElementById("btn-flip-card");
  const ratingActions = document.getElementById("rating-actions");
  const btnRateFail = document.getElementById("btn-rate-fail");
  const btnRatePass = document.getElementById("btn-rate-pass");

  const viewRoundSummary = document.getElementById("view-round-summary");
  const summaryRoundTitle = document.getElementById("summary-round-title");
  const summaryRoundSubtitle = document.getElementById("summary-round-subtitle");
  const summaryRoundMastered = document.getElementById("summary-round-mastered");
  const summaryRoundRemaining = document.getElementById("summary-round-remaining");
  const btnNextRound = document.getElementById("btn-next-round");

  const viewVictory = document.getElementById("view-victory");
  const victoryDetails = document.getElementById("victory-details");
  const victoryTotalCards = document.getElementById("victory-total-cards");
  const victoryTotalRounds = document.getElementById("victory-total-rounds");
  const btnVictoryRestart = document.getElementById("btn-victory-restart");
  const btnVictoryClose = document.getElementById("btn-victory-close");

  let dynamicStyleEl = null;

  // --- Données et État de la session ---
  const ROUND_BATCH_SIZE = 7; // Taille optimale d'une série d'apprentissage
  let activePayload = null;
  let deckName = "";
  let sessionKey = "";

  // Map de toutes les cartes du paquet : id -> { id, front, back, css, tags, stage: 'unseen'|'learning'|'mastered', streak: 0 }
  const cardsMap = new Map();

  let currentRoundNumber = 1;
  let currentRoundCards = []; // IDs de cartes dans la série en cours
  let currentCardIndex = 0;
  let isCardFlipped = false;
  let roundMasteredCount = 0;
  let roundLearningCount = 0;

  // --- 1. Initialisation ---
  initApp();

  function initApp() {
    // 1. Récupération des données du paquet transmises par l'application principale
    const rawPayload = localStorage.getItem("anki_learn_active_deck");
    if (!rawPayload) {
      deckTitleEl.textContent = "Aucun paquet sélectionné";
      cardFrontContent.innerHTML = `
        <div class="py-12 space-y-4">
          <p class="text-slate-500">Aucune donnée de paquet active trouvée.</p>
          <button onclick="window.close()" class="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold">
            Retourner à l'application principale
          </button>
        </div>
      `;
      btnFlipCard.classList.add("hidden");
      return;
    }

    try {
      activePayload = JSON.parse(rawPayload);
    } catch (e) {
      console.error("Payload invalide :", e);
      return;
    }

    deckName = activePayload.deckName || "Paquet Anki";
    deckTitleEl.textContent = deckName;
    document.title = `${deckName} • Mode Apprentissage`;
    sessionKey = `anki_learn_session_${encodeURIComponent(deckName)}`;

    // Remplissage de cardsMap
    (activePayload.cards || []).forEach((c) => {
      cardsMap.set(c.id, {
        id: c.id,
        front: c.front || "",
        back: c.back || "",
        css: c.css || "",
        tags: c.tags || [],
        stage: "unseen",
        streak: 0,
      });
    });

    if (cardsMap.size === 0) {
      cardFrontContent.innerHTML = `<p class="text-slate-400 py-8">Ce paquet ne contient aucune carte.</p>`;
      btnFlipCard.classList.add("hidden");
      return;
    }

    // 2. Vérification de session précédente enregistrée
    const savedSession = loadSavedSession();
    if (savedSession && hasActiveProgress(savedSession)) {
      showResumeBanner(savedSession);
    } else {
      startNewSession();
    }
  }

  // --- 2. Gestion de la persistance de session ---
  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(sessionKey);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function hasActiveProgress(session) {
    if (!session || !session.cardStages) return false;
    const stages = Object.values(session.cardStages);
    const mastered = stages.filter((s) => s.stage === "mastered").length;
    const learning = stages.filter((s) => s.stage === "learning").length;
    // On propose la reprise s'il y a des cartes déjà commencées ou maîtrisées
    return (mastered > 0 || learning > 0) && mastered < cardsMap.size;
  }

  function saveSession() {
    const cardStages = {};
    cardsMap.forEach((c, id) => {
      cardStages[id] = {
        stage: c.stage,
        streak: c.streak,
      };
    });

    const isComplete = Array.from(cardsMap.values()).every((c) => c.stage === "mastered");

    const sessionData = {
      deckName,
      totalCards: cardsMap.size,
      roundNumber: currentRoundNumber,
      lastUpdated: Date.now(),
      completed: isComplete,
      cardStages,
    };

    try {
      localStorage.setItem(sessionKey, JSON.stringify(sessionData));
    } catch (e) {
      console.warn("Erreur d'écriture localStorage pour la session :", e);
    }
  }

  function showResumeBanner(savedSession) {
    const stages = Object.values(savedSession.cardStages);
    const mastered = stages.filter((s) => s.stage === "mastered").length;
    const pct = Math.round((mastered / cardsMap.size) * 100);

    resumeInfoEl.textContent = `${mastered} sur ${cardsMap.size} cartes déjà maîtrisées (${pct}%) • Round ${savedSession.roundNumber || 1}`;
    resumeBanner.classList.remove("hidden");

    btnResumeSession.onclick = () => {
      resumeBanner.classList.add("hidden");
      // Restaurer les états
      Object.entries(savedSession.cardStages).forEach(([id, st]) => {
        const numId = isNaN(id) ? id : Number(id);
        const card = cardsMap.get(numId) || cardsMap.get(id);
        if (card) {
          card.stage = st.stage || "unseen";
          card.streak = st.streak || 0;
        }
      });
      currentRoundNumber = savedSession.roundNumber || 1;
      updateHeaderCounters();
      startNextRound();
    };

    btnRestartSession.onclick = () => {
      resumeBanner.classList.add("hidden");
      localStorage.removeItem(sessionKey);
      startNewSession();
    };
  }

  function startNewSession() {
    cardsMap.forEach((c) => {
      c.stage = "unseen";
      c.streak = 0;
    });
    currentRoundNumber = 1;
    saveSession();
    updateHeaderCounters();
    startNextRound();
  }

  // --- 3. Construction des Séries (Rounds) ---
  function startNextRound() {
    viewRoundSummary.classList.add("hidden");
    viewVictory.classList.add("hidden");
    viewCard.classList.remove("hidden");

    // Filtrer les cartes restantes
    const allCards = Array.from(cardsMap.values());
    const learningCards = allCards.filter((c) => c.stage === "learning");
    const unseenCards = allCards.filter((c) => c.stage === "unseen");
    const masteredCards = allCards.filter((c) => c.stage === "mastered");

    // Vérifier si 100% est maîtrisé
    if (masteredCards.length === cardsMap.size) {
      showVictoryScreen();
      return;
    }

    // Algorithme de composition du round :
    // Priorité 1 : Cartes en apprentissage (répétition espacée rapide)
    // Priorité 2 : Nouvelles cartes non vues jusqu'à compléter le batch
    const roundList = [];
    learningCards.forEach((c) => roundList.push(c.id));

    const remainingSlots = ROUND_BATCH_SIZE - roundList.length;
    if (remainingSlots > 0) {
      const takeUnseen = unseenCards.slice(0, remainingSlots);
      takeUnseen.forEach((c) => roundList.push(c.id));
    }

    // Si roundList est vide mais qu'il reste des cartes (cas limite)
    if (roundList.length === 0) {
      const remainingCards = allCards.filter((c) => c.stage !== "mastered");
      remainingCards.slice(0, ROUND_BATCH_SIZE).forEach((c) => roundList.push(c.id));
    }

    currentRoundCards = roundList;
    currentCardIndex = 0;
    roundMasteredCount = 0;
    roundLearningCount = 0;

    roundBadgeEl.textContent = `Round ${currentRoundNumber}`;
    renderCardInRound();
  }

  // --- 4. Rendu et Interaction Carte ---
  function renderCardInRound() {
    if (currentCardIndex >= currentRoundCards.length) {
      // Fin de la série en cours !
      endCurrentRound();
      return;
    }

    const cardId = currentRoundCards[currentCardIndex];
    const card = cardsMap.get(cardId);
    if (!card) {
      currentCardIndex++;
      renderCardInRound();
      return;
    }

    // Réinitialiser la carte face Recto
    isCardFlipped = false;
    cardScene.classList.remove("is-flipped");
    ratingActions.classList.add("hidden");
    btnFlipCard.classList.remove("hidden");

    // État de la carte
    cardStepBadgeEl.textContent = `Carte ${currentCardIndex + 1} sur ${currentRoundCards.length}`;

    if (card.stage === "learning") {
      cardStageIndicator.textContent = "En apprentissage";
      cardStageIndicator.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/50";
    } else {
      cardStageIndicator.textContent = "Nouvelle carte";
      cardStageIndicator.className = "px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50";
    }

    // Application du CSS personnalisé du modèle
    if (!dynamicStyleEl) {
      dynamicStyleEl = document.createElement("style");
      document.head.appendChild(dynamicStyleEl);
    }
    dynamicStyleEl.textContent = card.css || "";

    // Injection des contenus Recto et Verso
    cardFrontContent.innerHTML = card.front || "<span class='italic text-slate-400'>[Recto vide]</span>";
    cardBackContent.innerHTML = card.back || "<span class='italic text-slate-400'>[Verso vide]</span>";

    // Re-rendre les formules LaTeX avec MathJax si présentes
    triggerMathJax();
  }

  function flipCard() {
    isCardFlipped = !isCardFlipped;
    if (isCardFlipped) {
      cardScene.classList.add("is-flipped");
      btnFlipCard.classList.add("hidden");
      ratingActions.classList.remove("hidden");
    } else {
      cardScene.classList.remove("is-flipped");
      ratingActions.classList.add("hidden");
      btnFlipCard.classList.remove("hidden");
    }
  }

  // --- 5. Évaluation de la carte (Je sais vs À revoir) ---
  function handleAnswer(isSuccess) {
    if (currentCardIndex >= currentRoundCards.length) return;

    const cardId = currentRoundCards[currentCardIndex];
    const card = cardsMap.get(cardId);
    if (!card) return;

    if (isSuccess) {
      // ✅ Réussite : La carte passe au palier "Maîtrisée"
      card.streak += 1;
      card.stage = "mastered";
      roundMasteredCount += 1;
    } else {
      // ❌ Échec : La carte passe en "Apprentissage" et revient à la fin du round !
      card.stage = "learning";
      card.streak = 0;
      roundLearningCount += 1;
      // On réinsère la carte à la fin de la série active pour la revoir avant de clore le round
      currentRoundCards.push(cardId);
    }

    saveSession();
    updateHeaderCounters();

    // Passage à la carte suivante
    currentCardIndex += 1;
    renderCardInRound();
  }

  function updateHeaderCounters() {
    let unseen = 0;
    let learning = 0;
    let mastered = 0;

    cardsMap.forEach((c) => {
      if (c.stage === "mastered") mastered++;
      else if (c.stage === "learning") learning++;
      else unseen++;
    });

    counterUnseenEl.textContent = unseen;
    counterLearningEl.textContent = learning;
    counterMasteredEl.textContent = mastered;

    const total = cardsMap.size;
    const pct = total > 0 ? (mastered / total) * 100 : 0;
    progressBarFillEl.style.width = `${pct}%`;
  }

  // --- 6. Fin de Round & Victoire Finale ---
  function endCurrentRound() {
    viewCard.classList.add("hidden");

    // Vérifier si toutes les cartes du paquet sont maîtrisées
    const allMastered = Array.from(cardsMap.values()).every((c) => c.stage === "mastered");
    if (allMastered) {
      showVictoryScreen();
      return;
    }

    // Afficher l'écran récapitulatif du round
    summaryRoundTitle.textContent = `Round ${currentRoundNumber} terminé ! 🎉`;
    summaryRoundMastered.textContent = roundMasteredCount;
    summaryRoundRemaining.textContent = roundLearningCount;

    const totalMastered = Array.from(cardsMap.values()).filter((c) => c.stage === "mastered").length;
    const pctTotal = Math.round((totalMastered / cardsMap.size) * 100);
    summaryRoundSubtitle.textContent = `Progression globale : ${totalMastered} / ${cardsMap.size} cartes maîtrisées (${pctTotal}%).`;

    viewRoundSummary.classList.remove("hidden");
  }

  function showVictoryScreen() {
    viewCard.classList.add("hidden");
    viewRoundSummary.classList.add("hidden");
    viewVictory.classList.remove("hidden");

    victoryTotalCards.textContent = cardsMap.size;
    victoryTotalRounds.textContent = currentRoundNumber;
    victoryDetails.textContent = `Toutes les ${cardsMap.size} cartes du paquet "${deckName}" sont désormais assimilées et maîtrisées.`;

    saveSession();
  }

  function triggerMathJax() {
    if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
      window.MathJax.typesetPromise([cardFrontContent, cardBackContent]).catch((err) => {
        console.warn("MathJax notice:", err);
      });
    }
  }

  // --- 7. Écouteurs d'Événements & Raccourcis Clavier ---
  // Clic sur la carte pour retourner
  cardInner.addEventListener("click", () => flipCard());
  btnFlipCard.addEventListener("click", () => flipCard());

  // Boutons d'auto-évaluation
  btnRateFail.addEventListener("click", () => handleAnswer(false));
  btnRatePass.addEventListener("click", () => handleAnswer(true));

  // Continuer vers le prochain round
  btnNextRound.addEventListener("click", () => {
    currentRoundNumber += 1;
    startNextRound();
  });

  // Recommencer ou Fermer après victoire
  btnVictoryRestart.addEventListener("click", () => {
    localStorage.removeItem(sessionKey);
    startNewSession();
  });

  btnVictoryClose.addEventListener("click", () => {
    window.close();
  });

  // Bouton Quitter
  btnBack.addEventListener("click", () => {
    window.close();
  });

  // Raccourcis Clavier
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault();
      // Si on est sur l'écran récapitulatif de round, Espace passe au round suivant
      if (!viewRoundSummary.classList.contains("hidden")) {
        btnNextRound.click();
        return;
      }
      // Si on est sur la carte, Espace retourne la carte
      if (!viewCard.classList.contains("hidden")) {
        flipCard();
      }
    } else if (e.code === "ArrowLeft" || e.code === "Digit1" || e.key === "1") {
      if (!viewCard.classList.contains("hidden") && isCardFlipped) {
        e.preventDefault();
        handleAnswer(false);
      }
    } else if (e.code === "ArrowRight" || e.code === "Digit2" || e.key === "2") {
      if (!viewCard.classList.contains("hidden") && isCardFlipped) {
        e.preventDefault();
        handleAnswer(true);
      }
    } else if (e.code === "Escape") {
      window.close();
    }
  });
});
