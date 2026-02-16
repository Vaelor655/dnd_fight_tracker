import { createBattlemapController } from "./battlemap/controller.js";
import { screenToWorld, worldToCell } from "./battlemap/render.js";
import { initMapRealtimeMJ } from "./realtime/mapSync.js";

// ========= CONSTANTES & ÉTAT =========
    const STORAGE_KEY = "initiativeTrackerState_v15_parchment_with_map";
    const THEME_STORAGE_KEY = "initiativeTrackerTheme";

    const CONDITION_OPTIONS = [
      "Aveuglé (Blinded)",
      "Charmé (Charmed)",
      "Assourdi (Deafened)",
      "Effrayé (Frightened)",
      "Agrippé (Grappled)",
      "Neutralisé (Incapacitated)",
      "Invisible (Invisible)",
      "Paralysé (Paralyzed)",
      "Pétrifié (Petrified)",
      "Empoisonné (Poisoned)",
      "À terre (Prone)",
      "Entravé (Restrained)",
      "Étourdi (Stunned)",
      "Inconscient (Unconscious)",
      "Exténué (Exhaustion)",
    ];

    /**
     * @typedef {Object} Combatant
     * @property {number} id
     * @property {string} name
     * @property {number} initiative
     * @property {number} hpCurrent
     * @property {number} hpMax
     * @property {number} hpTemp
     * @property {number} acBase
     * @property {number} acTemp
     * @property {string} conditions
     * @property {boolean} isConcentrating
     * @property {number|null} mapTokenId
     */

    /** @type {Combatant[]} */
    let combatants = [];

    // Battlemap
    let battlemap = null;
    let realtime = null;
    let lastFocusedCombatantId = null;
    let currentIndex = 0;
    let roundNumber = 1;
    let idCounter = 1;

    /** monstres préfaits (depuis monsters.json) */
    let monsterPresets = [];

// Convert monster size label to token size (in grid cells)
function monsterSizeToCells(sizeRaw){
  const s = String(sizeRaw || "").toUpperCase().trim();
  // Known labels in your monsters.json: TP, P, M, G, TG, Gig (sometimes combined: "TG ou Gig", "M ou P", "TG ou inferieur")
  // We pick the largest size mentioned.
  let cells = 1;
  if (s.includes("GIG")) cells = Math.max(cells, 4);
  if (s.includes("TG"))  cells = Math.max(cells, 3);
  // Large ("G") – avoid matching inside "TG"/"GIG" by checking word-ish boundaries
  if (/(^|\s|\b)G(\b|\s|$)/.test(s) || s.includes(" OU G") || s.includes("G OU")) {
    cells = Math.max(cells, 2);
  }
  if (s.includes("TP")) cells = Math.min(cells, 0.5);
  if (s === "TP") cells = 0.5;
  return cells;
}


    // Timer de combat
    let combatStartTimestamp = null; // ms depuis epoch
    let timerIntervalId = null;

    // ========= SÉLECTEURS DOM =========
    const presetMonsterSelect = document.getElementById("presetMonsterSelect");
    const themeSelect = document.getElementById("themeSelect");

    const nameInput = document.getElementById("nameInput");
    const initiativeInput = document.getElementById("initiativeInput");
    const acBaseInput = document.getElementById("acBaseInput");
    const acTempInput = document.getElementById("acTempInput");
    const hpInput = document.getElementById("hpInput");
    const hpTempInput = document.getElementById("hpTempInput");
    const quantityInput = document.getElementById("quantityInput");
    const tokenSizeSelect = document.getElementById("tokenSizeSelect");
    const conditionsInput = document.getElementById("conditionsInput");
    const conditionSelect = document.getElementById("conditionSelect");

    const addBtn = document.getElementById("addBtn");
    const nextBtn = document.getElementById("nextBtn");
    const resetBtn = document.getElementById("resetBtn");
    const exportCombatBtn = document.getElementById("exportCombatBtn");
    const importCombatBtn = document.getElementById("importCombatBtn");
    const importCombatFile = document.getElementById("importCombatFile");
    const trackerBody = document.getElementById("trackerBody");
    const roundDisplay = document.getElementById("roundDisplay");
    const countDisplay = document.getElementById("countDisplay");
    const timerDisplay = document.getElementById("timerDisplay");

    // Dice
    const diceButtons = document.querySelectorAll(".dice-btn");
    const diceResultValue = document.getElementById("diceResultValue");
    const diceHistory = document.getElementById("diceHistory");

    // ========= THEME =========
    const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function resolveThemePreference(preference) {
      if (preference === "system") {
        return themeMediaQuery.matches ? "dark" : "light";
      }
      return preference === "dark" ? "dark" : "light";
    }

    function applyThemePreference(preference) {
      const resolved = resolveThemePreference(preference);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themePreference = preference;
    }

    function initThemePreference() {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) || "system";
      if (themeSelect) {
        themeSelect.value = saved;
        themeSelect.addEventListener("change", (event) => {
          const value = event.target.value || "system";
          localStorage.setItem(THEME_STORAGE_KEY, value);
          applyThemePreference(value);
        });
      }
      applyThemePreference(saved);
    }

    themeMediaQuery.addEventListener("change", () => {
      const preference = localStorage.getItem(THEME_STORAGE_KEY) || "system";
      if (preference === "system") {
        applyThemePreference(preference);
      }
    });

    initThemePreference();

    // ========= HELPERS STATUT =========

    const UNCONSCIOUS_LABEL = "Inconscient (Unconscious)";


    // ========= TOKENS : Visibilité + Masquer nom (players) =========
    const ICON_EYE = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
    const ICON_EYE_OFF = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M2 12s3.5-7 10-7c2.4 0 4.4.7 6 1.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.3 6.3C4 7.9 2 12 2 12s3.5 7 10 7c2.5 0 4.6-.7 6.3-1.7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;

    const ICON_NAME = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 20h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    const ICON_NAME_OFF = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 20h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

    function defaultTokenColorFromId(id){
      const hue = (Number(id) * 47) % 360;
      return `hsl(${hue} 70% 45%)`;
    }

    function hslToHex(h, s, l) {
      const sat = s / 100;
      const light = l / 100;
      const c = (1 - Math.abs(2 * light - 1)) * sat;
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
      const m = light - c / 2;
      let r = 0;
      let g = 0;
      let b = 0;

      if (h >= 0 && h < 60) {
        r = c;
        g = x;
        b = 0;
      } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
        b = 0;
      } else if (h >= 120 && h < 180) {
        r = 0;
        g = c;
        b = x;
      } else if (h >= 180 && h < 240) {
        r = 0;
        g = x;
        b = c;
      } else if (h >= 240 && h < 300) {
        r = x;
        g = 0;
        b = c;
      } else {
        r = c;
        g = 0;
        b = x;
      }

      const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, "0");
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    function normalizeTokenColor(color, fallbackId) {
      if (typeof color === "string" && color.trim().length > 0) {
        const trimmed = color.trim();
        if (trimmed.startsWith("#")) return trimmed;
        const hslMatch = trimmed.match(/hsl\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)%[,\s]+(\d+(?:\.\d+)?)%/i);
        if (hslMatch) {
          const h = Number(hslMatch[1]);
          const s = Number(hslMatch[2]);
          const l = Number(hslMatch[3]);
          if (!Number.isNaN(h) && !Number.isNaN(s) && !Number.isNaN(l)) {
            return hslToHex(h, s, l);
          }
        }
      }
      const fallback = defaultTokenColorFromId(fallbackId);
      const fallbackMatch = fallback.match(/hsl\((\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)%[,\s]+(\d+(?:\.\d+)?)%/i);
      if (fallbackMatch) {
        return hslToHex(Number(fallbackMatch[1]), Number(fallbackMatch[2]), Number(fallbackMatch[3]));
      }
      return "#22c55e";
    }

    const CENSOR_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    function generateCensorLabel(){
      let out = "";
      for(let i=0;i<6;i++) out += CENSOR_ALPHABET[Math.floor(Math.random() * CENSOR_ALPHABET.length)];
      return out;
    }

    function ensureCombatantExtras(c){
      if(!c) return;
      if(typeof c.hiddenFromPlayers !== "boolean") c.hiddenFromPlayers = !!(c.hiddenFromPlayers ?? false);
      if(typeof c.hideNameForPlayers !== "boolean") c.hideNameForPlayers = !!(c.hideNameForPlayers ?? false);
      if(c.hideNameForPlayers && (typeof c.censorLabel !== "string" || c.censorLabel.trim().length !== 6)){
        c.censorLabel = generateCensorLabel();
      }
      // keep tokenColor for backward compatibility (existing saved states)
      if(typeof c.tokenColor !== "string" || !c.tokenColor.trim()) c.tokenColor = defaultTokenColorFromId(c.id);
    }

    function getMapState(){
      return battlemap?._getState?.() || null;
    }

    function getTokenForCombatant(c){
      const st = getMapState();
      if(!st || !c || typeof c.mapTokenId !== "number") return null;
      return (st.tokens || []).find((t) => t.id === c.mapTokenId) || null;
    }

    // (Token color editing removed from the turn table UI)

    function toggleCombatantHiddenForPlayers(c){
      ensureCombatantExtras(c);
      c.hiddenFromPlayers = !c.hiddenFromPlayers;
      if(battlemap){
        battlemap.upsertTokenForCombatant(c);
        const t = getTokenForCombatant(c);
        if(t) t.hiddenForPlayers = !!c.hiddenFromPlayers;
        // keep name hide flags in sync
        if(t){
          t.hideNameForPlayers = !!c.hideNameForPlayers;
          if(c.hideNameForPlayers) t.censorLabel = (c.censorLabel || generateCensorLabel());
        }
        battlemap.invalidate();
        window.__mapDirtyTs = Date.now();
        realtime?.markDirty?.();
      }
      saveState();
    }

    function toggleCombatantHideNameForPlayers(c){
      ensureCombatantExtras(c);
      c.hideNameForPlayers = !c.hideNameForPlayers;
      if(c.hideNameForPlayers && (!c.censorLabel || String(c.censorLabel).trim().length !== 6)){
        c.censorLabel = generateCensorLabel();
      }
      if(battlemap){
        battlemap.upsertTokenForCombatant(c);
        const t = getTokenForCombatant(c);
        if(t){
          t.hideNameForPlayers = !!c.hideNameForPlayers;
          t.censorLabel = c.hideNameForPlayers ? (c.censorLabel || generateCensorLabel()) : (t.censorLabel || null);
        }
        battlemap.invalidate();
        window.__mapDirtyTs = Date.now();
        realtime?.markDirty?.();
      }
      saveState();
    }

    function updateUnconsciousCondition(c) {
      let cond = (c.conditions || "").trim();
      const parts = cond
        ? cond.split(",").map((p) => p.trim()).filter(Boolean)
        : [];

      const idx = parts.findIndex(
        (p) => p.toLowerCase() === UNCONSCIOUS_LABEL.toLowerCase()
      );

      if (c.hpCurrent <= 0) {
        if (idx === -1) {
          parts.push(UNCONSCIOUS_LABEL);
        }
      } else {
        if (idx !== -1) {
          parts.splice(idx, 1);
        }
      }

      c.conditions = parts.join(", ");
    }

    // ========= TIMER =========

    function pad(n) {
      return n.toString().padStart(2, "0");
    }

    function updateTimerDisplay() {
      if (!combatStartTimestamp) {
        timerDisplay.textContent = "00:00";
        return;
      }
      const elapsedMs = Date.now() - combatStartTimestamp;
      const totalSeconds = Math.floor(elapsedMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        timerDisplay.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      } else {
        timerDisplay.textContent = `${pad(minutes)}:${pad(seconds)}`;
      }
    }

    function startTimerIfNeeded() {
      if (!combatStartTimestamp) {
        combatStartTimestamp = Date.now();
      }
      if (timerIntervalId === null) {
        timerIntervalId = setInterval(updateTimerDisplay, 1000);
        updateTimerDisplay();
      }
    }

    function stopTimer() {
      if (timerIntervalId !== null) {
        clearInterval(timerIntervalId);
        timerIntervalId = null;
      }
    }

    // ========= SAUVEGARDE =========

    function buildStateSnapshot() {
      return {
        combatants,
        currentIndex,
        roundNumber,
        idCounter,
        combatStartTimestamp,
        battlemapState: battlemap ? battlemap.getSerializableState() : null,
      };
    }

    function normalizeCombatant(c) {
      const obj = {
        id: c.id,
        name: c.name,
        initiative: c.initiative,
        hpCurrent:
          typeof c.hpCurrent === "number"
            ? c.hpCurrent
            : typeof c.hp === "number"
            ? c.hp
            : 0,
        hpMax:
          typeof c.hpMax === "number"
            ? c.hpMax
            : typeof c.hp === "number"
            ? c.hp
            : 0,
        hpTemp: typeof c.hpTemp === "number" ? c.hpTemp : 0,
        acBase: typeof c.acBase === "number" ? c.acBase : 10,
        acTemp: typeof c.acTemp === "number" ? c.acTemp : 0,
        conditions: typeof c.conditions === "string" ? c.conditions : "",
        isConcentrating: !!c.isConcentrating,
        mapTokenId: (typeof c.mapTokenId === "number") ? c.mapTokenId : null,
        tokenColor: (typeof c.tokenColor === "string" && c.tokenColor.trim()) ? c.tokenColor.trim() : null,
        hiddenFromPlayers: !!(c.hiddenFromPlayers ?? c.hiddenForPlayers ?? c.hidden ?? false),
        hideNameForPlayers: !!(c.hideNameForPlayers ?? false),
        censorLabel: (typeof c.censorLabel === "string") ? c.censorLabel.trim() : null,
      };
      updateUnconsciousCondition(obj);
      return obj;
    }

    function applyStateFromData(data, { resetTimer = false } = {}) {
      if (!data || typeof data !== "object") {
        updateTimerDisplay();
        return;
      }

      if (Array.isArray(data.combatants)) {
        combatants = data.combatants.map(normalizeCombatant);
      } else {
        combatants = [];
      }

      currentIndex = typeof data.currentIndex === "number" ? data.currentIndex : 0;
      if (currentIndex < 0 || currentIndex >= combatants.length) {
        currentIndex = 0;
      }
      roundNumber = typeof data.roundNumber === "number" ? data.roundNumber : 1;

      if (typeof data.idCounter === "number") {
        idCounter = data.idCounter;
      } else {
        const maxId = combatants.reduce((max, c) => Math.max(max, c.id || 0), 0);
        idCounter = maxId + 1;
      }

      combatStartTimestamp =
        resetTimer
          ? null
          : typeof data.combatStartTimestamp === "number"
          ? data.combatStartTimestamp
          : null;

      if (battlemap && data.battlemapState) {
        battlemap.setStateFromData(data.battlemapState);
        try{ syncMapUiFromState(); }catch{}
      }

      if (combatStartTimestamp) {
        startTimerIfNeeded();
      } else {
        stopTimer();
        updateTimerDisplay();
      }
    }

    function exportCombatState() {
      const data = buildStateSnapshot();
      const payload = JSON.stringify(data, null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dateLabel = now.toISOString().slice(0, 10);
      a.href = url;
      a.download = `combat-${dateLabel}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function importCombatStateFromFile(file) {
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        applyStateFromData(data, { resetTimer: true });
        render();
        saveState();
      } catch (e) {
        console.error("Erreur d'import JSON :", e);
        alert("Import impossible : fichier JSON invalide.");
      }
    }

    function saveState() {
      const data = buildStateSnapshot();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error("Erreur de sauvegarde de l'état :", e);
      }
    }

    function loadState() {
      const dataStr = localStorage.getItem(STORAGE_KEY);
      if (!dataStr) {
        updateTimerDisplay();
        return;
      }
      try {
        const data = JSON.parse(dataStr);
        applyStateFromData(data);
      } catch (e) {
        console.error("Erreur de chargement de l'état :", e);
        updateTimerDisplay();
      }
    }

    // ========= LOGIQUE =========

    function sortCombatants() {
      combatants.sort((a, b) => {
        if (b.initiative !== a.initiative) {
          return b.initiative - a.initiative;
        }
        return a.name.localeCompare(b.name);
      });
    }

    function appendConditionToText(inputEl, textToAdd) {
      const current = inputEl.value.trim();
      if (!current) {
        inputEl.value = textToAdd;
        return;
      }
      const lower = current.toLowerCase();
      if (!lower.includes(textToAdd.toLowerCase())) {
        inputEl.value = current + ", " + textToAdd;
      }
    }

    // Dégâts / soins avec HP bonus d'abord
    function applyHpDelta(combatant, delta) {
      if (delta < 0) {
        // dégâts
        let damage = -delta;

        if (combatant.hpTemp > 0) {
          const fromTemp = Math.min(damage, combatant.hpTemp);
          combatant.hpTemp -= fromTemp;
          damage -= fromTemp;
        }

        if (damage > 0) {
          combatant.hpCurrent -= damage;
        }
      } else if (delta > 0) {
        // soins
        combatant.hpCurrent += delta;
        if (combatant.hpMax > 0 && combatant.hpCurrent > combatant.hpMax) {
          combatant.hpCurrent = combatant.hpMax;
        }
      }

      updateUnconsciousCondition(combatant);
    }

    function render() {
      roundDisplay.textContent = roundNumber.toString();
      countDisplay.textContent = combatants.length.toString();
      nextBtn.disabled = combatants.length === 0;

      trackerBody.innerHTML = "";

      if (combatants.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td colspan="8" class="empty">Aucune créature pour l\'instant.</td>';
        trackerBody.appendChild(tr);
        updateTimerDisplay();
        syncTurnBarToMap();
        return;
      }

      combatants.forEach((c, index) => {
        const tr = document.createElement("tr");
        if (index === currentIndex) {
          tr.classList.add("active");
        }

        // # ordre + indicateur de tour
        const orderTd = document.createElement("td");
        if (index === currentIndex) {
          orderTd.innerHTML = `
            <span class="turn-indicator">▶</span>
            ${index + 1}
          `;
        } else {
          orderTd.textContent = (index + 1).toString();
        }
        tr.appendChild(orderTd);

        // Visibilité (players) + Masquer nom (players)
        ensureCombatantExtras(c);

        const hideTd = document.createElement("td");
        const toolsWrap = document.createElement("div");
        toolsWrap.className = "turn-hide-tools";
        const hideBtn = document.createElement("button");
        hideBtn.type = "button";
        hideBtn.classList.add("table-icon-btn");
        hideBtn.innerHTML = c.hiddenFromPlayers ? ICON_EYE_OFF : ICON_EYE;
        hideBtn.title = c.hiddenFromPlayers ? "Afficher aux players" : "Cacher aux players";
        hideBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleCombatantHiddenForPlayers(c);
          render();
        });

        const hideNameBtn = document.createElement("button");
        hideNameBtn.type = "button";
        hideNameBtn.classList.add("table-icon-btn");
        hideNameBtn.innerHTML = c.hideNameForPlayers ? ICON_NAME_OFF : ICON_NAME;
        hideNameBtn.title = c.hideNameForPlayers ? "Afficher le nom aux players" : "Masquer le nom (censuré) aux players";
        hideNameBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          toggleCombatantHideNameForPlayers(c);
          render();
        });

        toolsWrap.appendChild(hideBtn);
        toolsWrap.appendChild(hideNameBtn);
        hideTd.appendChild(toolsWrap);
        tr.appendChild(hideTd);

        // Nom + badge concentration + couleur token
        const nameTd = document.createElement("td");
        const nameMain = document.createElement("div");
        nameMain.textContent = c.name;
        nameTd.appendChild(nameMain);

        const colorRow = document.createElement("div");
        colorRow.className = "token-color-row";
        const colorInput = document.createElement("input");
        colorInput.type = "color";
        colorInput.classList.add("token-color-input");
        colorInput.title = "Couleur du token";
        colorInput.value = normalizeTokenColor(c.tokenColor, c.id);
        colorInput.addEventListener("change", () => {
          c.tokenColor = colorInput.value;
          saveState();
          if (battlemap && typeof c.mapTokenId === "number") {
            battlemap.upsertTokenForCombatant(c);
            battlemap.invalidate();
            window.__mapDirtyTs = Date.now();
            realtime?.markDirty?.();
          }
          render();
        });
        colorRow.appendChild(colorInput);
        nameTd.appendChild(colorRow);

        if (c.isConcentrating) {
          const concBadge = document.createElement("div");
          concBadge.classList.add("concentration-badge");
          concBadge.textContent = "Concentration";
          nameTd.appendChild(concBadge);
        }

        tr.appendChild(nameTd);

        // Initiative
        const initTd = document.createElement("td");
        const initInput = document.createElement("input");
        initInput.type = "number";
        initInput.value = c.initiative.toString();
        initInput.classList.add("stat-input");
        initInput.title = "Initiative";
        initInput.addEventListener("change", () => {
          const activeId = combatants[currentIndex]?.id ?? null;
          const v = Number(initInput.value);
          c.initiative = Number.isFinite(v) ? v : 0;
          sortCombatants();
          if (activeId !== null) {
            const newIndex = combatants.findIndex((item) => item.id === activeId);
            currentIndex = newIndex >= 0 ? newIndex : 0;
          }
          saveState();
          render();
        });
        initTd.appendChild(initInput);
        tr.appendChild(initTd);

        // CA : base + bonus (temp)
        const caTd = document.createElement("td");
        const acBase = Number.isFinite(c.acBase) ? c.acBase : 10;
        const acTemp = Number.isFinite(c.acTemp) ? c.acTemp : 0;
        const acTotal = acBase + acTemp;

        const baseInput = document.createElement("input");
        baseInput.type = "number";
        baseInput.value = acBase;
        baseInput.classList.add("stat-input");
        baseInput.title = "CA de base";

        baseInput.addEventListener("change", () => {
          const v = Number(baseInput.value);
          c.acBase = isNaN(v) ? 10 : v;
          saveState();
          render();
        });

        const tempInput = document.createElement("input");
        tempInput.type = "number";
        tempInput.value = acTemp;
        tempInput.classList.add("stat-input");
        tempInput.title = "Bonus de CA (temporaire)";

        tempInput.addEventListener("change", () => {
          const v = Number(tempInput.value);
          c.acTemp = isNaN(v) ? 0 : v;
          saveState();
          render();
        });

        const totalSpan = document.createElement("span");
        totalSpan.textContent =
          acTemp !== 0
            ? `${acTotal} (${acBase}${acTemp > 0 ? "+" : ""}${acTemp})`
            : `${acBase}`;
        totalSpan.style.display = "block";
        totalSpan.style.fontSize = "0.8rem";
        totalSpan.style.color = "#7b5a3c";

        const inputsWrapper = document.createElement("div");
        inputsWrapper.appendChild(baseInput);
        inputsWrapper.appendChild(tempInput);

        caTd.appendChild(inputsWrapper);
        caTd.appendChild(totalSpan);
        tr.appendChild(caTd);

        // PV + bonus + barre + boutons + saisie avancée
        const hpTd = document.createElement("td");

        const hpSpan = document.createElement("span");
        hpSpan.classList.add("hp-value");
        const showMax = c.hpMax > 0;
        const bonusPart = c.hpTemp > 0 ? ` (+${c.hpTemp})` : "";
        hpSpan.textContent = showMax
          ? `${c.hpCurrent} / ${c.hpMax}${bonusPart}`
          : `${c.hpCurrent}${bonusPart}`;

        if (c.hpCurrent <= 0) {
          hpSpan.classList.add("hp-dead");
        } else if (c.hpMax > 0 && c.hpCurrent <= c.hpMax / 2) {
          hpSpan.classList.add("hp-low");
        } else {
          hpSpan.classList.add("hp-ok");
        }

        const hpControlsSpan = document.createElement("span");
        hpControlsSpan.classList.add("hp-controls");
        hpControlsSpan.innerHTML = `
          <button class="small secondary" data-action="hpPlus" data-id="${c.id}">+1</button>
          <button class="small secondary" data-action="hpMinus" data-id="${c.id}">-1</button>
        `;

        hpTd.appendChild(hpSpan);
        hpTd.appendChild(hpControlsSpan);

        const tempWrapper = document.createElement("div");
        tempWrapper.classList.add("hp-temp-wrapper");
        const tempLabel = document.createElement("span");
        tempLabel.textContent = "PV bonus :";
        const tempHpInput = document.createElement("input");
        tempHpInput.type = "number";
        tempHpInput.value = c.hpTemp ?? 0;
        tempHpInput.classList.add("stat-input");
        tempHpInput.style.width = "60px";

        tempHpInput.addEventListener("change", () => {
          const v = Number(tempHpInput.value);
          c.hpTemp = isNaN(v) ? 0 : v;
          saveState();
          render();
        });

        tempWrapper.appendChild(tempLabel);
        tempWrapper.appendChild(tempHpInput);
        hpTd.appendChild(tempWrapper);

        const bar = document.createElement("div");
        bar.classList.add("hp-bar");
        const barCurrent = document.createElement("div");
        barCurrent.classList.add("hp-bar-current");
        const barTemp = document.createElement("div");
        barTemp.classList.add("hp-bar-temp");

        const maxTotal = Math.max(c.hpMax + c.hpTemp, 1);
        const clampedCurrent = Math.max(Math.min(c.hpCurrent, maxTotal), 0);
        const clampedTemp = Math.max(
          Math.min(c.hpTemp, maxTotal - clampedCurrent),
          0
        );

        const currentPct = (clampedCurrent / maxTotal) * 100;
        const tempPct = (clampedTemp / maxTotal) * 100;

        barCurrent.style.width = currentPct + "%";
        barTemp.style.width = tempPct + "%";

        bar.appendChild(barCurrent);
        bar.appendChild(barTemp);
        hpTd.appendChild(bar);

        // Saisie avancée dégâts/soins
        const advDiv = document.createElement("div");
        advDiv.classList.add("hp-advanced");
        advDiv.innerHTML = `
          <span>Δ PV :</span>
          <input type="number" class="stat-input hp-delta-input" data-id="${c.id}" style="width:70px;" placeholder="-5 ou 8" />
          <button class="small secondary" data-action="hpApply" data-id="${c.id}">OK</button>
        `;
        hpTd.appendChild(advDiv);

        tr.appendChild(hpTd);

        // Conditions / notes + concentration
        const condTd = document.createElement("td");
        const condInput = document.createElement("input");
        condInput.type = "text";
        condInput.value = c.conditions || "";
        condInput.classList.add("conditions-input");
        condInput.placeholder = "Empoisonné, à terre, concentré...";

        condInput.addEventListener("change", () => {
          c.conditions = condInput.value;
          updateUnconsciousCondition(c);
          saveState();
          render();
        });

        const condSelect = document.createElement("select");
        condSelect.classList.add("condition-select");
        const defaultOpt = document.createElement("option");
        defaultOpt.value = "";
        defaultOpt.textContent = "+ Ajouter une condition D&D";
        condSelect.appendChild(defaultOpt);

        CONDITION_OPTIONS.forEach((optText) => {
          const opt = document.createElement("option");
          opt.value = optText;
          opt.textContent = optText;
          condSelect.appendChild(opt);
        });

        condSelect.addEventListener("change", () => {
          const value = condSelect.value;
          if (!value) return;
          appendConditionToText(condInput, value);
          c.conditions = condInput.value;
          updateUnconsciousCondition(c);
          saveState();
          condSelect.value = "";
          render();
        });

        condTd.appendChild(condInput);
        condTd.appendChild(condSelect);

        // Toggle concentration
        const concToggle = document.createElement("label");
        concToggle.classList.add("concentration-toggle");
        const concCheckbox = document.createElement("input");
        concCheckbox.type = "checkbox";
        concCheckbox.checked = !!c.isConcentrating;
        concCheckbox.addEventListener("change", () => {
          c.isConcentrating = concCheckbox.checked;
          saveState();
          render();
        });
        concToggle.appendChild(concCheckbox);
        concToggle.appendChild(document.createTextNode("Concentration"));
        condTd.appendChild(concToggle);

        tr.appendChild(condTd);

        // Actions
        const actionsTd = document.createElement("td");
        actionsTd.innerHTML = `
          <button class="small secondary" data-action="map" data-id="${c.id}">Map</button>
          <button class="small danger" data-action="delete" data-id="${c.id}">Suppr</button>
        `;
        tr.appendChild(actionsTd);

        trackerBody.appendChild(tr);
      });

      updateTimerDisplay();
      focusCurrentTurnOnMap();
      syncTurnBarToMap();
    }

    function addCombatant() {
      const name = nameInput.value.trim();
      const initiative = Number(initiativeInput.value);
      const acBase = Number(acBaseInput.value);
      const acTemp = Number(acTempInput.value);
      const hpMax = Number(hpInput.value);
      const hpTemp = Number(hpTempInput.value);
      const quantityRaw = Number((quantityInput && quantityInput.value) ? quantityInput.value : 1);
      const conditions = conditionsInput.value.trim();

      // If a monster preset is selected, use its size for the map token.
      // Otherwise, use the chosen size from the selector.
      let tokenSizeCells = 1;
      const presetVal = presetMonsterSelect ? presetMonsterSelect.value : "";
      if (presetVal !== "") {
        const idx = Number(presetVal);
        const preset = (!isNaN(idx) && monsterPresets[idx]) ? monsterPresets[idx] : null;
        if (preset) tokenSizeCells = monsterSizeToCells(preset.size);
      } else if (tokenSizeSelect) {
        const tokenSizeValue = Number(tokenSizeSelect.value);
        if (!isNaN(tokenSizeValue) && tokenSizeValue > 0) {
          tokenSizeCells = tokenSizeValue;
        }
      }
      if (!name || isNaN(initiative)) {
        alert("Nom et initiative sont obligatoires.");
        return;
      }

      const quantity =
        isNaN(quantityRaw) || quantityRaw < 1 ? 1 : Math.floor(quantityRaw);

      if (combatants.length === 0 && !combatStartTimestamp) {
        startTimerIfNeeded();
      }

      for (let i = 1; i <= quantity; i++) {
        const displayName = quantity > 1 ? `${name} #${i}` : name;

        const newCombatant = {
          id: idCounter++,
          name: displayName,
          initiative,
          hpCurrent: isNaN(hpMax) ? 0 : hpMax,
          hpMax: isNaN(hpMax) ? 0 : hpMax,
          hpTemp: isNaN(hpTemp) ? 0 : hpTemp,
          acBase: isNaN(acBase) ? 10 : acBase,
          acTemp: isNaN(acTemp) ? 0 : acTemp,
          conditions,
          isConcentrating: false,
          mapTokenId: null,
          tokenColor: null,
          tokenSize: tokenSizeCells,
          hiddenFromPlayers: false,
        };

        updateUnconsciousCondition(newCombatant);
        combatants.push(newCombatant);

        const createToken = document.getElementById("createTokenOnAdd");
        if (battlemap && createToken && createToken.checked) {
          battlemap.upsertTokenForCombatant(newCombatant);
        }
      }

      sortCombatants();
      currentIndex = 0;

      nameInput.value = "";
      initiativeInput.value = "";
      acBaseInput.value = "";
      acTempInput.value = "";
      hpInput.value = "";
      hpTempInput.value = "";
      conditionsInput.value = "";
      conditionSelect.value = "";
      quantityInput.value = "1";
      presetMonsterSelect.value = "";
      if (tokenSizeSelect) tokenSizeSelect.value = "1";

      saveState();
      render();
      nameInput.focus();
    }

    function nextTurn() {
      if (combatants.length === 0) return;
      currentIndex++;
      if (currentIndex >= combatants.length) {
        currentIndex = 0;
        roundNumber++;
      }
      saveState();
      render();
    }

    function resetTracker() {
      if (!confirm("Réinitialiser le combat et effacer la sauvegarde ?")) return;
      combatants = [];
      currentIndex = 0;
      roundNumber = 1;
      idCounter = 1;
      combatStartTimestamp = null;
      stopTimer();
      updateTimerDisplay();
      localStorage.removeItem(STORAGE_KEY);
      if (battlemap) battlemap.reset();
      lastFocusedCombatantId = null;
      render();
    }

    function updateHp(id, delta) {
      const c = combatants.find((x) => x.id === id);
      if (!c) return;
      applyHpDelta(c, delta);
      saveState();
      render();
    }

    function deleteCombatant(id) {
      const index = combatants.findIndex((x) => x.id === id);
      if (index === -1) return;
      const removed = combatants[index];
      if (battlemap && removed && typeof removed.mapTokenId === "number") {
        battlemap.removeToken(removed.mapTokenId);
      }
      combatants.splice(index, 1);

      if (combatants.length === 0) {
        currentIndex = 0;
        roundNumber = 1;
      } else if (currentIndex >= combatants.length) {
        currentIndex = combatants.length - 1;
      }

      saveState();
      render();
    }

    // ========= MONSTRES PRÉFAITS =========

    function loadMonsterPresets() {
      fetch("monsters.json")
        .then((res) => res.json())
        .then((data) => {
          if (!Array.isArray(data)) return;
          monsterPresets = data;

          monsterPresets.forEach((m, index) => {
            const opt = document.createElement("option");
            const crLabel = m.cr ? ` (FP ${m.cr})` : "";
            opt.value = String(index);
            opt.textContent = (m.name || "Monstre") + crLabel;
            presetMonsterSelect.appendChild(opt);
          });
        })
        .catch((err) => {
          console.error("Erreur chargement monsters.json :", err);
        });
    }

    presetMonsterSelect.addEventListener("change", () => {
      const value = presetMonsterSelect.value;
      if (value === "") return;

      const index = Number(value);
      const m = monsterPresets[index];
      if (!m) return;

      nameInput.value = m.name || "";
      acBaseInput.value = m.ac ?? "";
      hpInput.value = m.hp ?? "";
      hpTempInput.value = "";
      if (!conditionsInput.value.trim()) {
        const parts = [];
        if (m.type) parts.push(m.type);
        if (m.size) parts.push(m.size);
        if (m.cr) parts.push(`FP ${m.cr}`);
        conditionsInput.value = parts.join(" | ");
      }
    });

    // ========= DICE ROLLER =========

    function addDiceHistoryEntry(sides, roll) {
      const entry = document.createElement("div");
      entry.classList.add("dice-history-entry");
      const left = document.createElement("span");
      left.textContent = `d${sides}`;
      const right = document.createElement("span");
      right.textContent = roll;
      entry.appendChild(left);
      entry.appendChild(right);

      diceHistory.prepend(entry);
      while (diceHistory.children.length > 15) {
        diceHistory.removeChild(diceHistory.lastChild);
      }
    }

    function rollDie(sides) {
      const roll = Math.floor(Math.random() * sides) + 1;

      diceResultValue.classList.remove("dice-rolling");
      void diceResultValue.offsetWidth;
      diceResultValue.textContent = roll;
      diceResultValue.classList.add("dice-rolling");

      addDiceHistoryEntry(sides, roll);
    }

    diceButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const sides = Number(btn.getAttribute("data-sides"));
        if (!sides) return;
        rollDie(sides);
      });
    });

    // ========= ÉVÉNEMENTS =========

    addBtn.addEventListener("click", addCombatant);

    conditionSelect.addEventListener("change", () => {
      const value = conditionSelect.value;
      if (!value) return;
      appendConditionToText(conditionsInput, value);
      conditionSelect.value = "";
    });

    [
      nameInput,
      initiativeInput,
      acBaseInput,
      acTempInput,
      hpInput,
      hpTempInput,
      quantityInput,
      conditionsInput,
    ].forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          addCombatant();
        }
      });
    });

    nextBtn.addEventListener("click", nextTurn);
    resetBtn.addEventListener("click", resetTracker);
    exportCombatBtn.addEventListener("click", exportCombatState);
    importCombatBtn.addEventListener("click", () => importCombatFile.click());
    importCombatFile.addEventListener("change", async (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      await importCombatStateFromFile(file);
      input.value = "";
    });

    trackerBody.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const action = target.getAttribute("data-action");
      const idStr = target.getAttribute("data-id");
      if (!action || !idStr) return;

      const id = Number(idStr);

      if (action === "hpPlus") {
        updateHp(id, +1);
      } else if (action === "hpMinus") {
        updateHp(id, -1);
      } else if (action === "hpApply") {
        const td = target.closest("td");
        if (!td) return;
        const input = td.querySelector(
          `.hp-delta-input[data-id="${id}"]`
        );
        if (!input) return;
        const v = Number(input.value);
        if (!v || isNaN(v)) return;
        updateHp(id, v);
        input.value = "";
      } else if (action === "map") {
        focusCombatantOnMap(id);
      } else if (action === "delete") {
        deleteCombatant(id);
      }
    });

    
    // ========= BATTLEMAP INTEGRATION =========
    function focusCombatantOnMap(id){
      if (!battlemap) return;
      const c = combatants.find((x) => x.id === id);
      if (!c) return;
      battlemap.upsertTokenForCombatant(c);
      if (typeof c.mapTokenId === "number") {
        battlemap.selectToken(c.mapTokenId);
        battlemap.focusToken(c.mapTokenId);
        lastFocusedCombatantId = c.id;
      }
      saveState();
      render();
    }

    function focusCurrentTurnOnMap(){
      if (!battlemap) return;
      if (!combatants.length) return;
      const c = combatants[currentIndex];
      if (!c) return;
      battlemap.upsertTokenForCombatant(c);
      if (typeof c.mapTokenId === "number") {
        battlemap.selectToken(c.mapTokenId);
        if (lastFocusedCombatantId !== c.id) {
          battlemap.focusToken(c.mapTokenId);
          lastFocusedCombatantId = c.id;
        }
      }
    }

    // ========== TURN BAR (pour player.html) ==========
    function syncTurnBarToMap(){
      if(!battlemap) return;
      const st = battlemap._getState();
      if(!st) return;
      const hideAllNames = !!st?.playerView?.hideTokenNames;
      const visible = combatants.filter((c) => !c.hiddenFromPlayers);
      const order = visible.map((c) => {
        ensureCombatantExtras(c);
        const censored = hideAllNames || !!c.hideNameForPlayers;
        if(censored){
          const seed = (typeof c.censorLabel === "string" && c.censorLabel.trim().length === 6)
            ? c.censorLabel.trim().toUpperCase()
            : generateCensorLabel();
          if(!c.censorLabel || String(c.censorLabel).trim().length !== 6) c.censorLabel = seed;
          return { id: c.id, label: seed, censored: true, seed };
        }
        return { id: c.id, label: String(c?.name || "?").trim() || "?", censored: false };
      });

      const cur = combatants[currentIndex];
      const activeIndex = (order.length && cur && !cur.hiddenFromPlayers) ? visible.indexOf(cur) : -1;

      const prev = st.turnBar || {};
      const prevOrder = Array.isArray(prev.order) ? prev.order : [];
      const prevActive = Number(prev.activeIndex ?? prev.active ?? 0) || 0;

      // Normalize for cheap equality checks
      const norm = (arr) => arr.map((it) => {
        if(typeof it === "string") return { label: String(it) };
        if(!it || typeof it !== "object") return { label: "" };
        return {
          id: it.id,
          label: String(it.label ?? ""),
          censored: !!it.censored,
          seed: String(it.seed ?? it.censorLabel ?? ""),
        };
      });

      const a = norm(prevOrder);
      const b = norm(order);
      const sameOrder = (a.length === b.length) && a.every((v, i) => (
        v.id === b[i].id && v.label === b[i].label && v.censored === b[i].censored && v.seed === b[i].seed
      ));
      if(sameOrder && prevActive === activeIndex) return;

      st.turnBar = { order, activeIndex };
      battlemap.invalidate();
      // déclenche sync (MJ)
      window.__mapDirtyTs = Date.now();
      realtime?.markDirty?.();
    }

// ========= INIT =========
    // Init battlemap (DOM)
    battlemap = createBattlemapController({
      canvas: document.getElementById("map"),
      statusPill: document.getElementById("mapStatusPill"),
      coordsPill: document.getElementById("mapCoordsPill"),
      zoomPill: document.getElementById("mapZoomPill"),

      bgFile: document.getElementById("bgFile"),
      bgOpacity: document.getElementById("bgOpacity"),
      bgFitBtn: document.getElementById("bgFitBtn"),
      bgClearBtn: document.getElementById("bgClearBtn"),

      toolSelect: document.getElementById("toolSelect"),
      toolButtons: document.getElementById("toolButtons"),
      drawColor: document.getElementById("drawColor"),
      drawWidth: document.getElementById("drawWidth"),
      drawWidthValue: document.getElementById("drawWidthValue"),
      fillMode: document.getElementById("fillMode"),
      snapMode: document.getElementById("snapMode"),
      undoDrawBtn: document.getElementById("undoDrawBtn"),
      clearDrawBtn: document.getElementById("clearDrawBtn"),

      cellPx: document.getElementById("cellPx"),
      cellPxValue: document.getElementById("cellPxValue"),
      zoomRange: document.getElementById("mapZoomRange"),
      zoomValue: document.getElementById("mapZoomValue"),
      metersPerCell: document.getElementById("metersPerCell"),
      distanceRule: document.getElementById("distanceRule"),
      measureBtn: document.getElementById("measureBtn"),
      toggleGridBtn: document.getElementById("toggleGridBtn"),

      onDirty: () => {
        // debounce légère via timer (évite spam localStorage pendant drag)
        window.__mapDirtyTs = Date.now();
        realtime?.markDirty?.();
      },
    });



    // ========= OPTIONS PLAYER (MJ) =========
    const hideTokenNamesPlayer = document.getElementById("hideTokenNamesPlayer");

    hideTokenNamesPlayer?.addEventListener("change", () => {
      const st = battlemap._getState();
      st.playerView = st.playerView || {};
      st.playerView.hideTokenNames = !!hideTokenNamesPlayer.checked;
      battlemap.invalidate();
      window.__mapDirtyTs = Date.now();
      realtime?.markDirty?.();
      saveState();
    });

    function syncMapUiFromState(){
      if(!battlemap) return;
      const st = battlemap._getState();
      if(hideTokenNamesPlayer) hideTokenNamesPlayer.checked = !!st?.playerView?.hideTokenNames;
    }


    // ========= PINGS (MJ) =========
    const mjPingBtn = document.getElementById("mjPingBtn");
    let mjPingMode = false;
    let gHeld = false; // hold-to-ping: press and hold 'g'
    let lastPing = null;

    function updateMjPingUI(){
      const active = !!mjPingMode || !!gHeld;
      if(mjPingBtn){
        mjPingBtn.classList.toggle("is-active", active);
        // aria-pressed reflects the *locked* mode (button), not temporary hotkey hold
        mjPingBtn.setAttribute("aria-pressed", mjPingMode ? "true" : "false");
        if(!mjPingBtn.getAttribute("title")){
          mjPingBtn.setAttribute("title", "Ping (maintenir G + clic gauche)");
        }
      }
    }

    function setMjPingMode(on){
      mjPingMode = !!on;
      updateMjPingUI();
    }
    mjPingBtn?.addEventListener("click", () => setMjPingMode(!mjPingMode));

    // Hold-to-ping: keep 'g' pressed, then left click
    document.addEventListener("keydown", (e) => {
      const key = (e.key || "").toLowerCase();
      if(key !== "g") return;
      if(e.repeat) return;
      const t = e.target;
      const tag = (t && t.tagName) ? t.tagName.toLowerCase() : "";
      if(tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
      gHeld = true;
      updateMjPingUI();
    });
    document.addEventListener("keyup", (e) => {
      const key = (e.key || "").toLowerCase();
      if(key !== "g") return;
      gHeld = false;
      updateMjPingUI();
    });

    // safety: release hotkey if the window loses focus
    window.addEventListener("blur", () => {
      if(!gHeld) return;
      gHeld = false;
      updateMjPingUI();
    });
    document.addEventListener("visibilitychange", () => {
      if(!document.hidden) return;
      if(!gHeld) return;
      gHeld = false;
      updateMjPingUI();
    });

    function computePingOverlay(st){
      if(!lastPing) return null;
      const now = Date.now();
      const age = now - (lastPing.ts || now);
      if(age > 4000) return null;

      const cell = lastPing.cell;
      if(!cell || !isFinite(cell.x) || !isFinite(cell.y)) return null;

      return {
        world: { x: cell.x * st.grid.cellPx, y: cell.y * st.grid.cellPx },
        ts: lastPing.ts || now,
        label: lastPing.from ? String(lastPing.from) : "PING",
        color: lastPing.color || null,
        kind: lastPing.kind || "player",
      };
    }

    // inject ping overlay into the map renderer
    battlemap.setOverlayProvider((st) => ({ ping: computePingOverlay(st) }));

    // click-to-ping when enabled (capture to bypass other tools)
    const mapCanvasEl = document.getElementById("map");
    function canvasEventToScreen(e){
      const rect = mapCanvasEl.getBoundingClientRect();
      const dpr = mapCanvasEl.width / rect.width;
      return { sx: (e.clientX - rect.left) * dpr, sy: (e.clientY - rect.top) * dpr };
    }

    mapCanvasEl?.addEventListener("pointerdown", async (e) => {
      if(!(mjPingMode || gHeld)) return;
      if(e.pointerType === "mouse" && e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      const st = battlemap._getState();
      const { sx, sy } = canvasEventToScreen(e);
      const world = screenToWorld(mapCanvasEl, st.camera, { x: sx, y: sy });
      const cell = worldToCell(st, world);
      const pingCell = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };

      const payload = { x: pingCell.x, y: pingCell.y, ts: Date.now(), from: "MJ", color: "#ef4444", kind: "gm" };

      // show locally immediately
      lastPing = { cell: pingCell, ts: payload.ts, from: payload.from, color: payload.color, kind: payload.kind };
      battlemap.invalidate();

      // broadcast (best effort)
      try{
        await realtime?.sendPing?.(payload);
      }catch{}
    }, { capture: true });
    // Supabase realtime (MJ) — sync uniquement la battlemap
    realtime = initMapRealtimeMJ({
      battlemap,
      roomInput: document.getElementById("rtRoom"),
      statusEl: document.getElementById("rtStatus"),
      connectBtn: document.getElementById("rtConnectBtn"),
      playerLinkInput: document.getElementById("rtPlayerLink"),
      copyBtn: document.getElementById("rtCopyBtn"),
      bgUrlInput: document.getElementById("bgUrl"),
      bgUrlBtn: document.getElementById("bgUrlBtn"),
      
      onPing: (payload) => {
        const x = Number(payload?.x);
        const y = Number(payload?.y);
        if(!isFinite(x) || !isFinite(y)) return;
        lastPing = { cell: { x, y }, ts: Number(payload?.ts) || Date.now(), from: payload?.from || "PING", color: payload?.color || null, kind: payload?.kind || "player" };
        battlemap.invalidate();
      },
      onlineEl: document.getElementById("onlinePlayers"),
    });

    // quand la map bouge, on sauvegarde après un petit délai
    setInterval(() => {
      const ts = window.__mapDirtyTs;
      if (!ts) return;
      if (Date.now() - ts < 350) return;
      window.__mapDirtyTs = 0;
      saveState();
    }, 400);

    loadState();
    sortCombatants();
    render();
    loadMonsterPresets();
