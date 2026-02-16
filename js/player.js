import { createInitialState, migrateState } from "./battlemap/model.js";
import { draw, screenToWorld, worldToCell } from "./battlemap/render.js";
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
try{
  if(gridToggle){
    const saved = localStorage.getItem(GRID_PREF_KEY);
    if(saved === "0") gridToggle.checked = false;
    if(saved === "1") gridToggle.checked = true;
  }
}catch{}

gridToggle?.addEventListener("change", () => {
  try{ localStorage.setItem(GRID_PREF_KEY, gridToggle.checked ? "1" : "0"); }catch{}
  if(state?.grid) state.grid.show = !!gridToggle.checked;
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
  if(gridToggle && state?.grid) state.grid.show = !!gridToggle.checked;

  const overlay = {
    measure: computeMeasureOverlay(),
    ping: computePingOverlay(),
  };
  draw(canvas, ctx, state, overlay);
  syncZoomUi();
  dirty = false;
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
  if(dirty || pingOverlay || measureDragging) renderNow();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);


// ===== Tools (client-side only): measure + ping =====
let toolMode = "none"; // none | measure | ping
let gHeld = false; // hold-to-ping (press and hold 'g' + left click)
let measureDragging = false;
let measureStartCell = null;
let measureEndCell = null;

// last received ping (cell coords), ephemeral
let lastPing = null; // { cell:{x,y}, ts, from }

function setTool(mode){
  toolMode = mode;
  if(mode !== "measure"){
    measureDragging = false;
    measureStartCell = null;
    measureEndCell = null;
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
  if(rule === "chebyshev"){
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

  const aWorld = { x: a.x * state.grid.cellPx, y: a.y * state.grid.cellPx };
  const bWorld = { x: b.x * state.grid.cellPx, y: b.y * state.grid.cellPx };
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
    world: { x: cell.x * state.grid.cellPx, y: cell.y * state.grid.cellPx },
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
  const pingCell = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };

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
    measureStartCell = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
    measureEndCell = { ...measureStartCell };
    dirty = true;
    return;
  }

  if(toolMode === "ping"){
    // snap to 0.5 cell for readability
    const pingCell = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
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
});

canvas.addEventListener("pointermove", (e) => {
  if(toolMode !== "measure" || !measureDragging) return;
  if(activeToolPointerId !== null && e.pointerId !== activeToolPointerId) return;

  e.preventDefault();
  const { sx, sy } = canvasEventToScreen(e);
  const world = screenToWorld(canvas, state.camera, { x: sx, y: sy });
  const cell = worldToCell(state, world);
  measureEndCell = { x: Math.round(cell.x * 2) / 2, y: Math.round(cell.y * 2) / 2 };
  dirty = true;
});

function endMeasurePointer(e){
  if(activeToolPointerId !== null && e.pointerId !== activeToolPointerId) return;
  if(toolMode !== "measure") return;
  measureDragging = false;
  activeToolPointerId = null;
  dirty = true;
}

canvas.addEventListener("pointerup", endMeasurePointer);
canvas.addEventListener("pointercancel", endMeasurePointer);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

let isPanning = false;
let panPointerId = null;
let lastPanClient = null;

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

  breakFollowCameraIfNeeded();

  e.preventDefault();
  try{ canvas.setPointerCapture(e.pointerId); }catch{}
  isPanning = true;
  panPointerId = e.pointerId;
  lastPanClient = { x: e.clientX, y: e.clientY };
});

canvas.addEventListener("pointermove", (e) => {
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
  getIdentity: () => ({ name: getPingName(), color: getPingColor() }),
  onPing: (payload) => {
    const x = Number(payload?.x);
    const y = Number(payload?.y);
    if(!isFinite(x) || !isFinite(y)) return;
    lastPing = { cell: { x, y }, ts: Number(payload?.ts) || Date.now(), from: payload?.from || "PING", color: payload?.color || null, kind: payload?.kind || "player" };
    dirty = true;
  },
});

// Update presence when pseudo / couleur change
pingNameInput?.addEventListener("change", () => rt.trackIdentity?.());
pingColorInput?.addEventListener("input", () => rt.trackIdentity?.());
