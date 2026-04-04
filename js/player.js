import { createInitialState, migrateState } from "./battlemap/model.js";
import { draw, screenToWorld, worldToCell, cellToWorld, pickTokenAt } from "./battlemap/render.js";
import { initMapRealtimePlayer } from "./realtime/mapSync.js";

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const roomInput = document.getElementById("rtRoom");
const connectBtn = document.getElementById("rtConnectBtn");
const statusEl = document.getElementById("rtStatus");
const followCameraToggle = document.getElementById("followCamera");


const measureBtn = document.getElementById("toolMeasure");
const pingBtn = document.getElementById("toolPing");
const gridToggle = document.getElementById("playerGridToggle");
const zoomRange = document.getElementById("playerZoomRange");
const zoomValue = document.getElementById("playerZoomValue");
const pingNameInput = document.getElementById("pingName");
const pingColorInput = document.getElementById("pingColor");
const turnBarEl = document.getElementById("turnBar");
const playerTokenNameEl = document.getElementById("playerTokenName");
const playerTokenDotEl = document.getElementById("playerTokenDot");
const playerTokenStatusEl = document.getElementById("playerTokenStatus");
const playerHpValueEl = document.getElementById("playerHpValue");
const playerHpBarCurrentEl = document.getElementById("playerHpBarCurrent");
const playerHpBarTempEl = document.getElementById("playerHpBarTemp");
const playerAcValueEl = document.getElementById("playerAcValue");
const playerHpMinusBtn = document.getElementById("playerHpMinusBtn");
const playerHpPlusBtn = document.getElementById("playerHpPlusBtn");
const playerHpDeltaInput = document.getElementById("playerHpDeltaInput");
const playerHpDeltaApplyBtn = document.getElementById("playerHpDeltaApplyBtn");
const playerAcTempInput = document.getElementById("playerAcTempInput");
const playerHpTempInput = document.getElementById("playerHpTempInput");
const playerInitiativeInput = document.getElementById("playerInitiativeInput");
const playerConditionsInput = document.getElementById("playerConditionsInput");
const playerConditionChipsEl = document.getElementById("playerConditionChips");

const CONDITION_OPTIONS = [
  { label: "Aveuglé", full: "Aveuglé (Blinded)", danger: false },
  { label: "Charmé", full: "Charmé (Charmed)", danger: false },
  { label: "Assourdi", full: "Assourdi (Deafened)", danger: false },
  { label: "Effrayé", full: "Effrayé (Frightened)", danger: false },
  { label: "Agrippé", full: "Agrippé (Grappled)", danger: false },
  { label: "Neutralisé", full: "Neutralisé (Incapacitated)", danger: true },
  { label: "Invisible", full: "Invisible (Invisible)", danger: false },
  { label: "Paralysé", full: "Paralysé (Paralyzed)", danger: true },
  { label: "Pétrifié", full: "Pétrifié (Petrified)", danger: true },
  { label: "Empoisonné", full: "Empoisonné (Poisoned)", danger: false },
  { label: "À terre", full: "À terre (Prone)", danger: false },
  { label: "Entravé", full: "Entravé (Restrained)", danger: false },
  { label: "Étourdi", full: "Étourdi (Stunned)", danger: true },
  { label: "Inconscient", full: "Inconscient (Unconscious)", danger: true },
  { label: "Exténué", full: "Exténué (Exhaustion)", danger: false },
  { label: "Conc.", full: "Concentration", danger: false },
];

// ===== Theme =====
const THEME_STORAGE_KEY = "initiativeTrackerTheme";
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
  applyThemePreference(saved);
}

themeMediaQuery.addEventListener("change", () => {
  const preference = localStorage.getItem(THEME_STORAGE_KEY) || "system";
  if (preference === "system") {
    applyThemePreference(preference);
  }
});

initThemePreference();

// ===== Name censor "roulette" (turn bar) =====
const CENSOR_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
function rollingCensorLabel(seed, tokenId, nowMs){
  const tick = Math.floor((nowMs || Date.now()) / 60);
  const base = String(seed || "").toUpperCase();
  let out = "";
  for(let i=0;i<6;i++){
    const ch = base[i] || "";
    let start = CENSOR_ALPHABET.indexOf(ch);
    if(start < 0) start = ((Number(tokenId) || 0) * 7 + i * 11) % CENSOR_ALPHABET.length;
    const idx = (start + tick + i * 3) % CENSOR_ALPHABET.length;
    out += CENSOR_ALPHABET[idx];
  }
  return out;
}

let censoredTurnSpans = [];

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function renderTurnBar(tb){
  if(!turnBarEl) return;
  const order = Array.isArray(tb?.order) ? tb.order : [];
  const active = Number(tb?.activeIndex ?? tb?.active ?? -1);
  if(!order.length){
    turnBarEl.innerHTML = `<span class="muted">—</span>`;
    return;
  }
  turnBarEl.innerHTML = order.map((it, i) => {
    const obj = (it && typeof it === "object") ? it : null;
    const label = String(obj ? (obj.label ?? "") : (it ?? "")).trim() || "?";
    const censored = !!(obj && obj.censored);
    const id = obj && (obj.id != null) ? String(obj.id) : "";
    const seed = censored ? String(obj.seed ?? obj.censorLabel ?? label) : "";
    const cls = (i === active) ? "turnbar-item is-active" : "turnbar-item";
    const attrs = censored ? ` data-censored="1" data-id="${escapeHtml(id)}" data-seed="${escapeHtml(seed)}"` : "";
    return `<span class="${cls}" title="${escapeHtml(label)}"${attrs}>${escapeHtml(label)}</span>`;
  }).join("");

  // cache the censored spans for quick animation updates
  censoredTurnSpans = Array.from(turnBarEl.querySelectorAll("[data-censored='1']"));
}

function animateCensoredTurnBar(){
  if(!censoredTurnSpans || !censoredTurnSpans.length) return;
  const now = Date.now();
  for(const el of censoredTurnSpans){
    const seed = el.getAttribute("data-seed") || "";
    const id = Number(el.getAttribute("data-id") || 0);
    const label = rollingCensorLabel(seed, id, now);
    if(el.textContent !== label) el.textContent = label;
  }
}

function updateCensoredTurnBar(){
  if(!censoredTurnSpans || !censoredTurnSpans.length) return;
  const now = Date.now();
  for(const el of censoredTurnSpans){
    const seed = el.getAttribute("data-seed") || "";
    const id = Number(el.getAttribute("data-id") || 0) || 0;
    el.textContent = rollingCensorLabel(seed, id, now);
  }
}

// Tooltip hints
if(pingBtn && !pingBtn.getAttribute("title")) pingBtn.setAttribute("title", "Ping (maintenir G + clic gauche)");


// Local (player-side) grid toggle preference
const GRID_PREF_KEY = "battlemap_player_grid";
let _gridPref = true;
try{
  const saved = localStorage.getItem(GRID_PREF_KEY);
  if(saved === "0") _gridPref = false;
  if(saved === "1") _gridPref = true;
}catch{}

function syncGridBtn(){
  if(!gridToggle) return;
  gridToggle.classList.toggle("is-active", _gridPref);
  gridToggle.setAttribute("aria-pressed", _gridPref ? "true" : "false");
}
syncGridBtn();

gridToggle?.addEventListener("click", () => {
  _gridPref = !_gridPref;
  try{ localStorage.setItem(GRID_PREF_KEY, _gridPref ? "1" : "0"); }catch{}
  if(state?.grid) state.grid.show = _gridPref;
  syncGridBtn();
  dirty = true;
});


zoomRange?.addEventListener("input", () => {
  const v = Number(zoomRange.value || 1);
  if(!isFinite(v)) return;
  breakFollowCameraIfNeeded();
  applyCameraZoom(v);
});


let state = createInitialState();
state.ui = { view: "player" }; // options locales (non sync)
let dirty = true;
let selectedOwnedTokenId = null;
let playerId = "";

const PING_NAME_KEY = "battlemap_ping_name_v1";
const defaultPingName = (() => {
  const saved = localStorage.getItem(PING_NAME_KEY);
  if(saved && saved.trim()) return saved.trim();
  const rand = Math.random().toString(16).slice(2,6).toUpperCase();
  return `Player-${rand}`;
})();
if(pingNameInput){
  pingNameInput.value = defaultPingName;
  pingNameInput.addEventListener("change", () => {
    localStorage.setItem(PING_NAME_KEY, (pingNameInput.value || "").trim());
  });
}
function getPingName(){
  return (pingNameInput?.value || defaultPingName || "Player").trim() || "Player";
}



const PING_COLOR_KEY = "battlemap_ping_color_v1";
const defaultPingColor = (() => {
  const saved = localStorage.getItem(PING_COLOR_KEY);
  if(saved && saved.trim()) return saved.trim();
  return "#f59e0b"; // même couleur qu'avant (orange)
})();
if(pingColorInput){
  pingColorInput.value = defaultPingColor;
  pingColorInput.addEventListener("input", () => {
    localStorage.setItem(PING_COLOR_KEY, (pingColorInput.value || "").trim());
  });
}
function getPingColor(){
  const v = (pingColorInput?.value || defaultPingColor || "#f59e0b").trim();
  // accepter tout string CSS; mais si vide => fallback
  return v || "#f59e0b";
}

function resizeCanvas(){
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  dirty = true;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function syncZoomUi(){
  if(!zoomRange || !state?.camera) return;
  if(document.activeElement !== zoomRange){
    zoomRange.value = String(state.camera.zoom);
  }
  if(zoomValue){
    zoomValue.textContent = `${Math.round(state.camera.zoom * 100)}%`;
  }
}

function applyCameraZoom(newZoom, anchorScreen){
  if(!state?.camera) return;
  const nextZoom = Math.max(0.2, Math.min(5, newZoom));
  const anchor = anchorScreen || { x: canvas.width / 2, y: canvas.height / 2 };
  const worldX = (anchor.x - canvas.width / 2) / state.camera.zoom + state.camera.x;
  const worldY = (anchor.y - canvas.height / 2) / state.camera.zoom + state.camera.y;
  state.camera.zoom = nextZoom;
  state.camera.x = worldX - (anchor.x - canvas.width / 2) / state.camera.zoom;
  state.camera.y = worldY - (anchor.y - canvas.height / 2) / state.camera.zoom;
  dirty = true;
  syncZoomUi();
}

function renderNow(){
  // apply local grid preference (does not affect MJ)
  if(state?.grid) state.grid.show = _gridPref;

  const overlay = {
    measure: computeMeasureOverlay(),
    ping: computePingOverlay(),
    previewShape: playerPreviewShape,
  };
  draw(canvas, ctx, state, overlay);
  syncOwnedTokenPanel();
  syncZoomUi();
  dirty = false;
}

function getOwnedTokenById(id){
  if(!id) return null;
  return (state?.tokens || []).find((t) => t.id === id && String(t.controlledByPlayerId || "") === String(playerId || "")) || null;
}

function buildConditionChips(tok){
  if(!playerConditionChipsEl) return;
  const conditions = String(tok?.conditions || "");
  const activeParts = conditions.split(",").map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase());

  playerConditionChipsEl.innerHTML = "";
  const disabled = !tok;

  for(const cond of CONDITION_OPTIONS){
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "player-condition-chip";
    chip.textContent = cond.label;
    chip.title = cond.full;
    chip.disabled = disabled;
    const isActive = activeParts.includes(cond.full.toLowerCase());
    if(isActive) chip.classList.add("is-active");
    if(isActive && cond.danger) chip.classList.add("chip--danger");

    chip.addEventListener("click", () => {
      if(!tok) return;
      let parts = String(tok.conditions || "").split(",").map(s => s.trim()).filter(Boolean);
      const idx = parts.findIndex(p => p.toLowerCase() === cond.full.toLowerCase());
      if(idx === -1){
        parts.push(cond.full);
      } else {
        parts.splice(idx, 1);
      }
      tok.conditions = parts.join(", ");
      if(playerConditionsInput && document.activeElement !== playerConditionsInput){
        playerConditionsInput.value = tok.conditions;
      }
      sendOwnedTokenStats({ conditions: tok.conditions });
      dirty = true;
      buildConditionChips(tok);
    });
    playerConditionChipsEl.appendChild(chip);
  }
}

function syncOwnedTokenPanel(){
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  const hasToken = !!tok;

  // Header
  if(playerTokenDotEl){
    playerTokenDotEl.style.background = hasToken ? (tok.color || "var(--accent)") : "var(--border)";
  }
  if(playerTokenNameEl){
    playerTokenNameEl.textContent = hasToken ? (tok.name || "Token") : "Aucun token assigné";
  }
  if(playerTokenStatusEl){
    playerTokenStatusEl.textContent = hasToken ? "Vous contrôlez" : "";
    playerTokenStatusEl.style.display = hasToken ? "" : "none";
  }

  if(!hasToken){
    // HP bar
    if(playerHpBarCurrentEl) playerHpBarCurrentEl.style.width = "0%";
    if(playerHpBarTempEl) playerHpBarTempEl.style.width = "0%";
    if(playerHpValueEl) playerHpValueEl.textContent = "—";
    if(playerAcValueEl) playerAcValueEl.textContent = "—";
    if(playerAcTempInput) { playerAcTempInput.value = "0"; playerAcTempInput.disabled = true; }
    if(playerHpTempInput) { playerHpTempInput.value = "0"; playerHpTempInput.disabled = true; }
    if(playerInitiativeInput) { playerInitiativeInput.value = "0"; playerInitiativeInput.disabled = true; }
    if(playerConditionsInput) { playerConditionsInput.value = ""; playerConditionsInput.disabled = true; }
    if(playerHpMinusBtn) playerHpMinusBtn.disabled = true;
    if(playerHpPlusBtn) playerHpPlusBtn.disabled = true;
    if(playerHpDeltaInput) { playerHpDeltaInput.disabled = true; playerHpDeltaInput.value = ""; }
    if(playerHpDeltaApplyBtn) playerHpDeltaApplyBtn.disabled = true;
    buildConditionChips(null);
    return;
  }

  // --- Enable controls ---
  if(playerHpMinusBtn) playerHpMinusBtn.disabled = false;
  if(playerHpPlusBtn) playerHpPlusBtn.disabled = false;
  if(playerHpDeltaInput) playerHpDeltaInput.disabled = false;
  if(playerHpDeltaApplyBtn) playerHpDeltaApplyBtn.disabled = false;
  if(playerAcTempInput) playerAcTempInput.disabled = false;
  if(playerHpTempInput) playerHpTempInput.disabled = false;
  if(playerInitiativeInput) playerInitiativeInput.disabled = false;
  if(playerConditionsInput) playerConditionsInput.disabled = false;

  // HP display & bar
  const hp = Number(tok.hp ?? 0);
  const hpMax = Number(tok.hpMax ?? 0);
  const hpTemp = Number(tok.hpTemp ?? 0);
  const maxTotal = Math.max(hpMax + hpTemp, 1);
  const clampedHp = Math.max(Math.min(hp, maxTotal), 0);
  const clampedTemp = Math.max(Math.min(hpTemp, maxTotal - clampedHp), 0);
  const hpPct = (clampedHp / maxTotal) * 100;
  const tempPct = (clampedTemp / maxTotal) * 100;

  if(playerHpValueEl){
    playerHpValueEl.textContent = hpMax > 0
      ? `${hp} / ${hpMax}${hpTemp > 0 ? ` (+${hpTemp})` : ""}`
      : `${hp}${hpTemp > 0 ? ` (+${hpTemp})` : ""}`;
    const ratio = hpMax > 0 ? hp / hpMax : 1;
    playerHpValueEl.style.color = hp <= 0 ? "var(--hp-dead)" : ratio <= 0.5 ? "var(--hp-low)" : "var(--hp-ok)";
  }
  if(playerHpBarCurrentEl){
    playerHpBarCurrentEl.style.width = hpPct + "%";
    playerHpBarCurrentEl.classList.toggle("is-dead", hp <= 0);
    playerHpBarCurrentEl.classList.toggle("is-low", hp > 0 && hpMax > 0 && hp <= hpMax / 2);
  }
  if(playerHpBarTempEl) playerHpBarTempEl.style.width = tempPct + "%";

  // CA
  const acBase = Number.isFinite(Number(tok.acBase)) ? Number(tok.acBase) : 10;
  const acTemp = Number(tok.acTemp ?? 0);
  if(playerAcValueEl){
    playerAcValueEl.textContent = acTemp !== 0
      ? `${acBase + acTemp} (${acBase}${acTemp > 0 ? "+" : ""}${acTemp})`
      : String(acBase + acTemp);
  }
  if(playerAcTempInput && document.activeElement !== playerAcTempInput){
    playerAcTempInput.value = String(acTemp);
  }
  if(playerHpTempInput && document.activeElement !== playerHpTempInput){
    playerHpTempInput.value = String(hpTemp);
  }
  if(playerInitiativeInput && document.activeElement !== playerInitiativeInput){
    playerInitiativeInput.value = String(Number(tok.initiative ?? 0));
  }
  if(playerConditionsInput && document.activeElement !== playerConditionsInput){
    playerConditionsInput.value = String(tok.conditions || "");
  }

  // Condition chips
  buildConditionChips(tok);
}

function setStateFromData(raw, { followCamera }){
  const migrated = migrateState(raw);
  if(!migrated) return;

  // preserve local camera if not following
  if(!followCamera && state?.camera){
    migrated.camera = state.camera;
  }

  // camera smoothing (followCamera): animate towards the remote camera instead of snapping
  if(followCamera && state?.camera && migrated?.camera){
    migrated._targetCamera = migrated.camera;
    migrated.camera = { ...state.camera };
  }

  migrated.ui = { view: "player" };
  state = migrated;
  if(!getOwnedTokenById(selectedOwnedTokenId)){
    selectedOwnedTokenId = null;
    // Auto-sélectionner le premier token contrôlé par ce joueur
    const ownedTok = (state.tokens || []).find(t =>
      String(t.controlledByPlayerId || "") === String(playerId || "")
    );
    if(ownedTok) selectedOwnedTokenId = ownedTok.id;
  }
  renderTurnBar(state.turnBar);
  dirty = true;
}


function animateCamera(){
  const t = state?._targetCamera;
  const c = state?.camera;
  if(!t || !c) return;

  const lerp = (a,b,k) => a + (b-a)*k;
  const k = 0.22; // smoothing factor (higher = snappier)

  c.x = lerp(c.x, t.x, k);
  c.y = lerp(c.y, t.y, k);
  c.zoom = lerp(c.zoom, t.zoom, k);

  // snap when close enough
  if(Math.abs(c.x - t.x) < 0.01 && Math.abs(c.y - t.y) < 0.01 && Math.abs(c.zoom - t.zoom) < 0.001){
    state.camera = t;
    delete state._targetCamera;
  }

  dirty = true;
}

function loop(){
  animateCamera();
  const pingOverlay = computePingOverlay();
  // If some names are censored (global or individual), we need periodic redraw
  // because the label is "roulette"-animated on a canvas.
  const needCensorAnim = !!(state?.playerView?.hideTokenNames) || ((state?.tokens || []).some((t) => !t.hiddenForPlayers && t.hideNameForPlayers));
  const now = performance.now();
  if(needCensorAnim){
    if(!loop._lastCensorTick || (now - loop._lastCensorTick) > 80){
      loop._lastCensorTick = now;
      dirty = true;
      animateCensoredTurnBar();
    }
  }
  // Keep animating while animated spell shapes or a spell preview is visible
  if(state?.shapes?.some(s => s.anim) || playerPreviewShape?.anim) dirty = true;
  // Prune locally expired one-shot shapes (MJ will also prune and re-sync)
  if(state?.shapes?.some(s => s.anim && s.animStart && (Date.now() - s.animStart) >= (s.anim === "arcane" ? 2500 : s.type === "circle" ? 2000 : s.type === "cone" ? 1800 : 1500))){
    state.shapes = state.shapes.filter(s => !(s.anim && s.animStart && (Date.now() - s.animStart) >= (s.anim === "arcane" ? 2500 : s.type === "circle" ? 2000 : s.type === "cone" ? 1800 : 1500)));
    dirty = true;
  }
  if(dirty || pingOverlay || measureDragging || spellDragging) renderNow();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);


// ===== Tools (client-side only): measure + ping + spell shapes =====
let toolMode = "none"; // none | measure | ping | spell-cone | spell-sphere | spell-line | spell-cube
let gHeld = false; // hold-to-ping (press and hold 'g' + left click)
let measureDragging = false;
let measureStartCell = null;
let measureEndCell = null;

// Spell drawing state
let spellDragging = false;
let spellStart = null;
let playerPreviewShape = null;

const spellToolBtns = document.querySelectorAll("[data-spell-tool]");
const spellColorInput = document.getElementById("spellColor");
const undoSpellBtn = document.getElementById("undoSpellBtn");
const clearSpellBtn = document.getElementById("clearSpellBtn");

function spellSnap(world){
  const cellPx = state?.grid?.cellPx || 60;
  const snap = cellPx / 2;
  return {
    x: Math.round(world.x / snap) * snap,
    y: Math.round(world.y / snap) * snap,
  };
}

function buildSpellPreviewShape(tool, start){
  const color = spellColorInput?.value || "#f59e0b";
  const cellPx = state?.grid?.cellPx || 60;
  if(tool === "spell-cone"){
    return { type: "cone", anim: "fire", cx: start.x, cy: start.y, length: 0, angle: 0,
      stroke: color, strokeWidth: 2, fill: color, fillAlpha: 0.22 };
  } else if(tool === "spell-sphere"){
    return { type: "circle", anim: "fire", cx: start.x, cy: start.y, r: 0,
      stroke: color, strokeWidth: 2, fill: color, fillAlpha: 0.22 };
  } else if(tool === "spell-line"){
    return { type: "line-template", anim: "fire", x1: start.x, y1: start.y, x2: start.x, y2: start.y,
      width: 1.5 * cellPx, stroke: color, strokeWidth: 2, fill: color, fillAlpha: 0.22 };
  } else if(tool === "spell-cube"){
    return { type: "rect", anim: "arcane", x: start.x, y: start.y, w: 0, h: 0,
      stroke: color, strokeWidth: 2, fill: color, fillAlpha: 0.22 };
  }
  return null;
}

function updateSpellPreviewShape(s, start, current){
  if(s.type === "cone"){
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    s.length = Math.sqrt(dx*dx + dy*dy);
    s.angle = Math.atan2(dy, dx);
  } else if(s.type === "circle"){
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    s.r = Math.sqrt(dx*dx + dy*dy);
  } else if(s.type === "line-template"){
    s.x2 = current.x;
    s.y2 = current.y;
  } else if(s.type === "rect"){
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    s.w = Math.sign(dx || 1) * side;
    s.h = Math.sign(dy || 1) * side;
  }
}

function spellShapeHasSize(s){
  if(s.type === "cone") return (s.length || 0) > 4;
  if(s.type === "circle") return (s.r || 0) > 4;
  if(s.type === "line-template"){
    const dx = (s.x2 - s.x1), dy = (s.y2 - s.y1);
    return Math.sqrt(dx*dx + dy*dy) > 4;
  }
  if(s.type === "rect") return Math.abs(s.w || 0) > 4 && Math.abs(s.h || 0) > 4;
  return false;
}

spellToolBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const tool = btn.getAttribute("data-spell-tool") || "";
    setTool(toolMode === tool ? "none" : tool);
  });
});

// last received ping (cell coords), ephemeral
let lastPing = null; // { cell:{x,y}, ts, from }

function setTool(mode){
  toolMode = mode;
  if(mode !== "measure"){
    measureDragging = false;
    measureStartCell = null;
    measureEndCell = null;
  }
  if(!mode.startsWith("spell-")){
    spellDragging = false;
    spellStart = null;
    playerPreviewShape = null;
  }
  updateToolButtons();
  dirty = true;
}

function updateToolButtons(){
  if(measureBtn){
    measureBtn.classList.toggle("is-active", toolMode === "measure");
    measureBtn.setAttribute("aria-pressed", toolMode === "measure" ? "true" : "false");
  }
  if(pingBtn){
    pingBtn.classList.toggle("is-active", toolMode === "ping");
    pingBtn.setAttribute("aria-pressed", toolMode === "ping" ? "true" : "false");
  }
  spellToolBtns.forEach(btn => {
    const t = btn.getAttribute("data-spell-tool") || "";
    btn.classList.toggle("is-active", toolMode === t);
    btn.setAttribute("aria-pressed", toolMode === t ? "true" : "false");
  });
  if(measureBtn) measureBtn.classList.toggle("primary", toolMode === "measure");
  if(pingBtn) pingBtn.classList.toggle("primary", toolMode === "ping");
}

// Hold-to-ping hotkey: keep 'g' pressed, then left click on the map
document.addEventListener("keydown", (e) => {
  const key = (e.key || "").toLowerCase();
  if(key !== "g") return;
  if(e.repeat) return;
  const t = e.target;
  const tag = (t && t.tagName) ? t.tagName.toLowerCase() : "";
  if(tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
  gHeld = true;
});
document.addEventListener("keyup", (e) => {
  const key = (e.key || "").toLowerCase();
  if(key !== "g") return;
  gHeld = false;
});

// safety: release hotkey if the window loses focus
window.addEventListener("blur", () => { gHeld = false; });
document.addEventListener("visibilitychange", () => { if(document.hidden) gHeld = false; });

measureBtn?.addEventListener("click", () => {
  setTool(toolMode === "measure" ? "none" : "measure");
});
pingBtn?.addEventListener("click", () => {
  setTool(toolMode === "ping" ? "none" : "ping");
});

function fmtMeters(m){
  if(!isFinite(m)) return "–";
  if(m >= 10) return `${m.toFixed(0)} m`;
  if(m >= 1) return `${m.toFixed(2)} m`;
  return `${m.toFixed(3)} m`;
}

function computeMeasureOverlay(){
  if(toolMode !== "measure") return null;
  if(!measureStartCell || !measureEndCell) return null;

  const a = measureStartCell;
  const b = measureEndCell;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const mpc = state.grid.metersPerCell || 1;

  let distCells = 0;
  let label = "";

  const rule = state.grid.distanceRule || "chebyshev";
  if(state.grid?.layout === "hex"){
    const dq = a.x - b.x;
    const dr = a.y - b.y;
    const ds = -dq - dr;
    distCells = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
    label = fmtMeters(distCells * mpc);
  }else if(rule === "chebyshev"){
    distCells = Math.max(dx, dy);
    label = fmtMeters(distCells * mpc);
  }else if(rule === "euclid"){
    distCells = Math.sqrt(dx*dx + dy*dy);
    label = fmtMeters(distCells * mpc);
  }else{
    const diag = Math.min(dx, dy);
    const straight = Math.max(dx, dy) - diag;
    const pairs = Math.floor(diag / 2);
    const leftover = diag % 2;
    distCells = straight + (pairs * 3) + leftover * 1;
    label = fmtMeters(distCells * mpc) + " (alt)";
  }

  const aWorld = cellToWorld(state, a);
  const bWorld = cellToWorld(state, b);
  return { aWorld, bWorld, label };
}

function computePingOverlay(){
  if(!lastPing) return null;
  const now = Date.now();
  const age = now - (lastPing.ts || now);
  if(age > 4000) return null;

  const cell = lastPing.cell;
  if(!cell || !isFinite(cell.x) || !isFinite(cell.y)) return null;

  return {
    world: cellToWorld(state, cell),
    ts: lastPing.ts || now,
    label: lastPing.from ? String(lastPing.from) : "PING",
    color: lastPing.color || null,
    kind: lastPing.kind || "player",
  };
}


// ===== Local camera controls (player) =====
// Drag-to-pan + wheel-to-zoom.
// If the player starts moving the camera while "Suivre caméra MJ" is ON,
// we automatically disable follow mode so they can explore freely.

// Pointer-based interactions for tools (works on desktop + mobile)
function canvasEventToScreen(e){
  const rect = canvas.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
  return { sx, sy };
}

let activeToolPointerId = null;

// Quick ping: hold 'g' + left click (works even when no tool is selected).
// We use capture so it runs before pan/other tool handlers.
canvas.addEventListener("pointerdown", async (e) => {
  if(!gHeld) return;
  if(e.pointerType === "mouse" && e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const { sx, sy } = canvasEventToScreen(e);
  const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
  const cell = worldToCell(state, world);
  const pingCell = state.grid?.layout === "hex"
    ? { x: Math.round(cell.x), y: Math.round(cell.y) }
    : { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };

  const payload = { x: pingCell.x, y: pingCell.y, ts: Date.now(), from: getPingName(), color: getPingColor(), kind: "player" };

  // show locally immediately
  lastPing = { cell: pingCell, ts: payload.ts, from: payload.from, color: payload.color, kind: payload.kind };
  dirty = true;

  try{
    await rt?.sendPing?.(payload);
  }catch{}
}, { capture: true });

canvas.addEventListener("pointerdown", async (e) => {
  if(toolMode === "none") return;

  // Only primary action for tools (mouse left, touch, pen)
  if(e.pointerType === "mouse" && e.button !== 0) return;

  e.preventDefault();
  try{ canvas.setPointerCapture(e.pointerId); }catch{}
  activeToolPointerId = e.pointerId;

  const { sx, sy } = canvasEventToScreen(e);
  const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
  const cell = worldToCell(state, world);

  if(toolMode === "measure"){
    measureDragging = true;
    measureStartCell = state.grid?.layout === "hex"
      ? { x: Math.round(cell.x), y: Math.round(cell.y) }
      : { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
    measureEndCell = { ...measureStartCell };
    dirty = true;
    return;
  }

  if(toolMode === "ping"){
    // snap to 0.5 cell for readability
    const pingCell = state.grid?.layout === "hex"
      ? { x: Math.round(cell.x), y: Math.round(cell.y) }
      : { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
    const payload = { x: pingCell.x, y: pingCell.y, ts: Date.now(), from: getPingName(), color: getPingColor(), kind: "player" };

    // show locally immediately
    lastPing = { cell: pingCell, ts: payload.ts, from: payload.from, color: payload.color, kind: payload.kind };
    dirty = true;

    // broadcast to others via channel (best effort)
    try{
      if(rt?.sendPing){
        await rt.sendPing(payload);
      }
    }catch{}
    return;
  }

  if(toolMode.startsWith("spell-")){
    const worldSnap = spellSnap(world);
    spellDragging = true;
    spellStart = worldSnap;
    playerPreviewShape = buildSpellPreviewShape(toolMode, worldSnap);
    dirty = true;
    return;
  }
});

canvas.addEventListener("pointermove", (e) => {
  if(activeToolPointerId !== null && e.pointerId !== activeToolPointerId) return;

  if(toolMode === "measure" && measureDragging){
    e.preventDefault();
    const { sx, sy } = canvasEventToScreen(e);
    const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
    const cell = worldToCell(state, world);
    measureEndCell = state.grid?.layout === "hex"
      ? { x: Math.round(cell.x), y: Math.round(cell.y) }
      : { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
    dirty = true;
    return;
  }

  if(toolMode.startsWith("spell-") && spellDragging && playerPreviewShape){
    e.preventDefault();
    const { sx, sy } = canvasEventToScreen(e);
    const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
    updateSpellPreviewShape(playerPreviewShape, spellStart, spellSnap(world));
    dirty = true;
  }
});

function endToolPointer(e){
  if(activeToolPointerId !== null && e.pointerId !== activeToolPointerId) return;

  if(toolMode === "measure"){
    measureDragging = false;
    activeToolPointerId = null;
    dirty = true;
    return;
  }

  if(toolMode.startsWith("spell-") && spellDragging){
    spellDragging = false;
    activeToolPointerId = null;
    const finalShape = playerPreviewShape ? { ...playerPreviewShape } : null;
    playerPreviewShape = null;
    if(finalShape && spellShapeHasSize(finalShape)){
      finalShape.creatorId = playerId;
      finalShape.animStart = Date.now();
      if(!state.shapes) state.shapes = [];
      state.shapes.push({ id: -(Date.now()), ...finalShape });
      try{ rt?.sendShapeAdd?.({ ...finalShape }); }catch{}
    }
    dirty = true;
  }
}

canvas.addEventListener("pointerup", endToolPointer);
canvas.addEventListener("pointercancel", endToolPointer);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let isPanning = false;
let panPointerId = null;
let lastPanClient = null;
let draggingOwnedTokenId = null;

function clientDeltaToCanvasDelta(dxClient, dyClient){
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  return { dx: dxClient * sx, dy: dyClient * sy };
}

function breakFollowCameraIfNeeded(){
  if(!followCameraToggle) return;
  if(!followCameraToggle.checked) return;
  followCameraToggle.checked = false;
  // notify listeners (mapSync reads this)
  followCameraToggle.dispatchEvent(new Event("change"));
}

canvas.addEventListener("pointerdown", (e) => {
  if(toolMode !== "none") return;
  if(!state?.camera) return;

  // mouse: left or right button. touch/pen: always.
  if(e.pointerType === "mouse" && !(e.button === 0 || e.button === 2)) return;

  const { sx, sy } = canvasEventToScreen(e);
  const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
  const cell = worldToCell(state, world);
  const hitId = pickTokenAt(state, cell);
  const hitTok = (hitId != null) ? getOwnedTokenById(hitId) : null;
  if(hitTok && e.button === 0){
    e.preventDefault();
    try{ canvas.setPointerCapture(e.pointerId); }catch{}
    draggingOwnedTokenId = hitTok.id;
    selectedOwnedTokenId = hitTok.id;
    panPointerId = e.pointerId;
    isPanning = false;
    dirty = true;
    return;
  }

  breakFollowCameraIfNeeded();

  e.preventDefault();
  try{ canvas.setPointerCapture(e.pointerId); }catch{}
  isPanning = true;
  panPointerId = e.pointerId;
  lastPanClient = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointermove", (e) => {
  if(draggingOwnedTokenId != null){
    if(panPointerId !== null && e.pointerId !== panPointerId) return;
    e.preventDefault();
    const { sx, sy } = canvasEventToScreen(e);
    const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
    const cell = worldToCell(state, world);
    const snapped = state.grid?.layout === "hex"
      ? { x: Math.round(cell.x), y: Math.round(cell.y) }
      : { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
    const tok = getOwnedTokenById(draggingOwnedTokenId);
    if(tok){
      tok.x = snapped.x;
      tok.y = snapped.y;
      dirty = true;
    }
    return;
  }

  if(!isPanning || panPointerId === null) return;
  if(e.pointerId !== panPointerId) return;
  if(!lastPanClient) return;

  e.preventDefault();
  const dxClient = e.clientX - lastPanClient.x;
  const dyClient = e.clientY - lastPanClient.y;
  lastPanClient = { x: e.clientX, y: e.clientY };

  const { dx, dy } = clientDeltaToCanvasDelta(dxClient, dyClient);
  state.camera.x -= dx / state.camera.zoom;
  state.camera.y -= dy / state.camera.zoom;
  dirty = true;
}, { passive: false });

function endPan(e){
  if(panPointerId !== null && e.pointerId !== panPointerId) return;
  if(draggingOwnedTokenId != null){
    const tok = getOwnedTokenById(draggingOwnedTokenId);
    if(tok){
      rt.sendTokenUpdate?.({ tokenId: tok.id, playerId, position: { x: tok.x, y: tok.y } });
    }
    draggingOwnedTokenId = null;
  }
  isPanning = false;
  panPointerId = null;
  lastPanClient = null;
}
canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);

canvas.addEventListener("wheel", (e) => {
  // zooming implies local control, so break follow mode if needed
  breakFollowCameraIfNeeded();
  e.preventDefault();
  const zoomFactor = Math.exp(-e.deltaY * 0.0015);
  const newZoom = state.camera.zoom * zoomFactor;

  const rect = canvas.getBoundingClientRect();
  const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

  applyCameraZoom(newZoom, { x: cx, y: cy });
}, { passive: false });

// Start realtime
const rt = initMapRealtimePlayer({
  canvas,
  renderFn: () => { dirty = true; },
  setStateFromData,
  roomInput,
  connectBtn,
  statusEl,
  followCameraToggle,
  onlineEl: document.getElementById("onlinePlayers"),
  getIdentity: () => ({ playerId, name: getPingName(), color: getPingColor() }),
  onPing: (payload) => {
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if(!isFinite(x) || !isFinite(y)) return;
    lastPing = { cell: { x, y }, ts: Number(payload?.ts) || Date.now(), from: payload?.from || "PING", color: payload?.color || null, kind: payload?.kind || "player" };
    dirty = true;
  },
});
playerId = rt.getPlayerId?.() || "";

// Update presence when pseudo / couleur change
pingNameInput?.addEventListener("change", () => rt.trackIdentity?.());
pingColorInput?.addEventListener("input", () => rt.trackIdentity?.());

// Spell undo / clear
undoSpellBtn?.addEventListener("click", async () => {
  if(state?.shapes){
    for(let i = state.shapes.length - 1; i >= 0; i--){
      if(state.shapes[i].creatorId === playerId){
        state.shapes.splice(i, 1);
        dirty = true;
        break;
      }
    }
  }
  try{ await rt.sendShapeUndo?.(playerId); }catch{}
});

clearSpellBtn?.addEventListener("click", async () => {
  if(state?.shapes){
    state.shapes = state.shapes.filter(s => s.creatorId !== playerId);
    dirty = true;
  }
  try{ await rt.sendShapeClearCreator?.(playerId); }catch{}
});

function sendOwnedTokenStats(patch){
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  rt.sendTokenUpdate?.({ tokenId: tok.id, playerId, stats: patch });
}

function applyHpDeltaToToken(tok, delta){
  if(!tok || !Number.isFinite(delta) || delta === 0) return;
  const hpTemp = Number(tok.hpTemp ?? 0);
  if(delta < 0){
    let dmg = -delta;
    if(hpTemp > 0){
      const fromTemp = Math.min(dmg, hpTemp);
      tok.hpTemp = hpTemp - fromTemp;
      dmg -= fromTemp;
    }
    tok.hp = Number(tok.hp ?? 0) - dmg;
  } else {
    const hpMax = Number(tok.hpMax ?? 0);
    tok.hp = Number(tok.hp ?? 0) + delta;
    if(hpMax > 0 && tok.hp > hpMax) tok.hp = hpMax;
  }
  dirty = true;
  sendOwnedTokenStats({ hp: Number(tok.hp || 0), hpTemp: Number(tok.hpTemp ?? 0) });
}

playerHpMinusBtn?.addEventListener("click", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  applyHpDeltaToToken(tok, -1);
});

playerHpPlusBtn?.addEventListener("click", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  applyHpDeltaToToken(tok, 1);
});

function applyHpDeltaBtn(){
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok || !playerHpDeltaInput) return;
  const v = Number(playerHpDeltaInput.value);
  if(!Number.isFinite(v) || v === 0) return;
  applyHpDeltaToToken(tok, v);
  playerHpDeltaInput.value = "";
}
playerHpDeltaApplyBtn?.addEventListener("click", applyHpDeltaBtn);
playerHpDeltaInput?.addEventListener("keydown", (e) => {
  if(e.key === "Enter") applyHpDeltaBtn();
});

playerConditionsInput?.addEventListener("change", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  tok.conditions = String(playerConditionsInput.value || "");
  dirty = true;
  buildConditionChips(tok);
  sendOwnedTokenStats({ conditions: tok.conditions });
});

playerAcTempInput?.addEventListener("change", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  const v = Number(playerAcTempInput.value || 0);
  tok.acTemp = Number.isFinite(v) ? v : 0;
  const base = Number.isFinite(Number(tok.acBase)) ? Number(tok.acBase) : 10;
  tok.ac = base + tok.acTemp;
  dirty = true;
  sendOwnedTokenStats({ acTemp: tok.acTemp });
});

playerHpTempInput?.addEventListener("change", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  const v = Number(playerHpTempInput.value || 0);
  tok.hpTemp = Number.isFinite(v) ? v : 0;
  dirty = true;
  sendOwnedTokenStats({ hpTemp: tok.hpTemp });
});

playerInitiativeInput?.addEventListener("change", () => {
  const tok = getOwnedTokenById(selectedOwnedTokenId);
  if(!tok) return;
  const v = Number(playerInitiativeInput.value || 0);
  tok.initiative = Number.isFinite(v) ? v : 0;
  dirty = true;
  sendOwnedTokenStats({ initiative: tok.initiative });
});
