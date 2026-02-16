import { createInitialState, migrateState, addToken, undoShape, clearShapes } from "./model.js";
import { draw, screenToWorld } from "./render.js";
import { createInputController } from "./input.js";
import { clamp } from "./utils.js";

function colorFromId(id){
  // deterministic hue
  const hue = (Number(id) * 47) % 360;
  return `hsl(${hue} 70% 45%)`;
}

export function createBattlemapController(dom){
  const canvas = dom.canvas;
  const ctx = canvas.getContext("2d");

  let state = createInitialState();
  state.ui = {
    view: "mj",
    measureMode: false,
    spaceDown: false,
    mouseCell: null,
    measureStartCell: null,
    measureEndCell: null,
    tool: "tokens",
    drawColor: "#22c55e",
    drawWidth: 3,
    fillMode: "none",
    snapMode: "on",
    previewShape: null,
    onTokenSelected: null,
    onTokenMoved: null,
  };

  let dirty = true;
  const PING_DURATION_MS = 4000; // keep in sync with render.js
  let pingAnimating = false;
  let detachInput = null;
  let overlayProvider = null;

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    dirty = true;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  function setStatus(t){ if(dom.statusPill) dom.statusPill.textContent = t; }
  function updatePills(){
    if(dom.coordsPill){
      if(state.ui.mouseCell){
        dom.coordsPill.textContent = `x: ${state.ui.mouseCell.x.toFixed(2)} | y: ${state.ui.mouseCell.y.toFixed(2)}`;
      }else dom.coordsPill.textContent = "x: – | y: –";
    }
    if(dom.zoomPill) dom.zoomPill.textContent = `zoom: ${Math.round(state.camera.zoom * 100)}%`;
  }

  function syncZoomUi(){
    if(!dom.zoomRange) return;
    if(document.activeElement !== dom.zoomRange){
      dom.zoomRange.value = String(state.camera.zoom);
    }
    if(dom.zoomValue){
      dom.zoomValue.textContent = `${Math.round(state.camera.zoom * 100)}%`;
    }
  }

  function applyZoom(z){
    const next = clamp(z, 0.25, 3.5);
    const center = { x: canvas.width / 2, y: canvas.height / 2 };
    const before = screenToWorld(canvas, state.camera, center);
    state.camera.zoom = next;
    const after = screenToWorld(canvas, state.camera, center);
    state.camera.x += (before.x - after.x);
    state.camera.y += (before.y - after.y);
    dirty = true;
    syncZoomUi();
  }

  function fmtMeters(m){
    if(!isFinite(m)) return "–";
    if(m >= 10) return `${m.toFixed(0)} m`;
    if(m >= 1) return `${m.toFixed(2)} m`;
    return `${m.toFixed(3)} m`;
  }

  function computeMeasureOverlay(){
    if(!state.ui.measureMode) return null;
    if(!state.ui.measureStartCell || !state.ui.measureEndCell) return null;

    const a = state.ui.measureStartCell;
    const b = state.ui.measureEndCell;
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const mpc = state.grid.metersPerCell;

    let distCells = 0;
    let label = "";

    if(state.grid.distanceRule === "chebyshev"){
      distCells = Math.max(dx, dy);
      label = fmtMeters(distCells * mpc);
    }else if(state.grid.distanceRule === "euclid"){
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

  function render(){
    let overlay = null;
    let forceDraw = false;

    // We redraw while a ping animation is active, even if the map isn't "dirty".
    if(dirty || pingAnimating){
      overlay = {};

      // external overlays (ex: pings)
      try{
        const ext = (typeof overlayProvider === "function") ? (overlayProvider(state) || null) : null;
        if(ext && typeof ext === "object") Object.assign(overlay, ext);
      }catch{}

      const m = computeMeasureOverlay();
      if(m) overlay.measure = m;
      if(state.ui.previewShape) overlay.previewShape = state.ui.previewShape;

      // Ping animation needs continuous redraw for pulse/fade (canvas isn't DOM-animated)
      const ping = overlay?.ping;
      const ts = Number(ping?.ts);
      if(ping && isFinite(ts)){
        const age = Date.now() - ts;

        if(age < PING_DURATION_MS){
          forceDraw = true;
          pingAnimating = true;
        }else if(pingAnimating){
          // just expired: draw one last frame (without ping) to clear it
          forceDraw = true;
          pingAnimating = false;
        }
      }else if(pingAnimating){
        // ping was removed: clear once
        forceDraw = true;
        pingAnimating = false;
      }

      if(dirty || forceDraw){
        draw(canvas, ctx, state, overlay);
        dirty = false;
      }
    }

    updatePills();
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);


function markDirty(full=true){
  if(full) dirty = true;

  dom.undoDrawBtn && (dom.undoDrawBtn.disabled = !(state.shapes?.length));
  dom.bgClearBtn && (dom.bgClearBtn.disabled = !(state.background?.dataUrl || state.background?.url));

  // Measure toggle button (icon)
  if(dom.measureBtn){
    dom.measureBtn.classList.toggle("is-active", !!state.ui.measureMode);
    dom.measureBtn.setAttribute("aria-pressed", state.ui.measureMode ? "true" : "false");
  }

  // Grid toggle: checkbox (preferred) or legacy button
  if(dom.toggleGridBtn){
    if(dom.toggleGridBtn.type === "checkbox"){
      dom.toggleGridBtn.checked = !!state.grid.show;
    }else{
      dom.toggleGridBtn.classList.toggle("is-active", !!state.grid.show);
      dom.toggleGridBtn.setAttribute("aria-pressed", state.grid.show ? "true" : "false");
      dom.toggleGridBtn.textContent = `Grille : ${state.grid.show ? "ON" : "OFF"}`;
    }
  }

  // Checkbox-driven UI
  if(dom.fillMode && dom.fillMode.type === "checkbox") dom.fillMode.checked = (state.ui.fillMode === "fill");
  if(dom.snapMode && dom.snapMode.type === "checkbox") dom.snapMode.checked = (state.ui.snapMode !== "off");

  // Value readouts (sliders)
  dom.drawWidthValue && (dom.drawWidthValue.textContent = String(state.ui.drawWidth || 3));
  dom.cellPxValue && (dom.cellPxValue.textContent = String(state.grid.cellPx || 40));
  syncZoomUi();

  // Sync tool buttons (icon toolbar)
  if(dom.toolButtons){
    const buttons = dom.toolButtons.querySelectorAll("button[data-tool]");
    buttons.forEach((b) => {
      b.classList.toggle("is-active", (b.getAttribute("data-tool") || "") === (state.ui.tool || "tokens"));
    });
  }
}

  function fitBackgroundToView(){
    if(!(state.background?.dataUrl || state.background?.url)) return;
    const viewW = canvas.width / state.camera.zoom;
    const viewH = canvas.height / state.camera.zoom;
    const imgW = state.background._naturalW || state.background.w || 1000;
    const imgH = state.background._naturalH || state.background.h || 800;

    const scale = Math.min(viewW / imgW, viewH / imgH);
    const w = imgW * scale;
    const h = imgH * scale;

    state.background.w = w;
    state.background.h = h;
    state.background.x = state.camera.x - w/2;
    state.background.y = state.camera.y - h/2;
    dirty = true;
  }

  async function fileToDataUrl(file){
    const reader = new FileReader();
    return await new Promise((resolve, reject) => {
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  async function loadBackgroundFromFile(file){
    const dataUrl = await fileToDataUrl(file);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onerror = reject;
      img.onload = resolve;
      img.src = dataUrl;
    });

    state.background = {
      dataUrl,
      opacity: (Number(dom.bgOpacity?.value) || 85) / 100,
      x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight,
      _naturalW: img.naturalWidth,
      _naturalH: img.naturalHeight,
    };

    fitBackgroundToView();
    setStatus("Carte chargée ✅");
    setTimeout(() => setStatus("Prêt"), 900);

    dirty = true;
    markDirty(false);
  }

  // Wire controls
  
  async function loadBackgroundFromUrl(url){
    const clean = String(url || "").trim();
    if(!clean){
      state.background = null;
      dirty = true;
      markDirty(false);
      return;
    }

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onerror = reject;
      img.onload = resolve;
      img.src = clean;
    });

    state.background = {
      url: clean,
      dataUrl: null,
      opacity: (Number(dom.bgOpacity?.value) || 85) / 100,
      x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight,
      _naturalW: img.naturalWidth,
      _naturalH: img.naturalHeight,
    };

    fitBackgroundToView();
    setStatus("Fond URL chargé ✅");
    setTimeout(() => setStatus("Prêt"), 900);
    dirty = true;
    markDirty(false);
  }
dom.bgFile?.addEventListener("change", async () => {
    const file = dom.bgFile.files?.[0];
    if(!file) return;
    try{ await loadBackgroundFromFile(file); }
    catch{
      setStatus("Impossible de lire l’image ❌");
      setTimeout(() => setStatus("Prêt"), 1100);
    }finally{
      dom.bgFile.value = "";
    }
  });

  dom.bgOpacity?.addEventListener("input", () => {
    if(!state.background) return;
    state.background.opacity = (Number(dom.bgOpacity.value) || 85) / 100;
    dirty = true;
  });

  dom.bgFitBtn?.addEventListener("click", () => { fitBackgroundToView(); markDirty(false); });
  dom.bgClearBtn?.addEventListener("click", () => { state.background = null; dirty = true; markDirty(false); });

  dom.toolSelect?.addEventListener("change", () => {
    state.ui.tool = dom.toolSelect.value || "tokens";
    dirty = true;
    markDirty(false);
  });

  // Icon tool buttons (preferred UI)
  if(dom.toolButtons){
    const buttons = dom.toolButtons.querySelectorAll("button[data-tool]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tool = btn.getAttribute("data-tool") || "tokens";
        state.ui.tool = tool;
        if(dom.toolSelect) dom.toolSelect.value = tool;
        dirty = true;
        markDirty(false);
      });
    });
  }
  dom.drawColor?.addEventListener("input", () => { state.ui.drawColor = dom.drawColor.value || "#22c55e"; });
  dom.drawWidth?.addEventListener("input", () => {
    const v = Number(dom.drawWidth.value || 3);
    state.ui.drawWidth = Math.max(1, Math.min(16, v));
    dom.drawWidth.value = String(state.ui.drawWidth);
    dom.drawWidthValue && (dom.drawWidthValue.textContent = String(state.ui.drawWidth));
    dirty = true;
    markDirty(false);
  });
  dom.fillMode?.addEventListener("change", () => {
    if(dom.fillMode.type === "checkbox"){
      state.ui.fillMode = dom.fillMode.checked ? "fill" : "none";
    }else{
      state.ui.fillMode = dom.fillMode.value || "none";
    }
    dirty = true;
    markDirty(false);
  });
  dom.snapMode?.addEventListener("change", () => {
    if(dom.snapMode.type === "checkbox"){
      state.ui.snapMode = dom.snapMode.checked ? "on" : "off";
    }else{
      state.ui.snapMode = dom.snapMode.value || "on";
    }
    dirty = true;
    markDirty(false);
  });

  dom.undoDrawBtn?.addEventListener("click", () => { undoShape(state); dirty = true; markDirty(false); });
  dom.clearDrawBtn?.addEventListener("click", () => { clearShapes(state); dirty = true; markDirty(false); });

  dom.cellPx?.addEventListener("input", () => {
    const v = Number(dom.cellPx.value || 60);
    state.grid.cellPx = Math.max(10, Math.min(200, v));
    dom.cellPx.value = String(state.grid.cellPx);
    dom.cellPxValue && (dom.cellPxValue.textContent = String(state.grid.cellPx));
    dirty = true;
    markDirty(false);
  });
  dom.zoomRange?.addEventListener("input", () => {
    const v = Number(dom.zoomRange.value || 1);
    if(!isFinite(v)) return;
    applyZoom(v);
    markDirty(false);
  });
  dom.metersPerCell?.addEventListener("change", () => {
    const v = Number(dom.metersPerCell.value || 1);
    state.grid.metersPerCell = Math.max(0.1, Math.min(50, v));
    dom.metersPerCell.value = String(state.grid.metersPerCell);
    dirty = true;
  });
  dom.distanceRule?.addEventListener("change", () => { state.grid.distanceRule = "chebyshev"; if(dom.distanceRule) dom.distanceRule.value = "chebyshev"; dirty = true; markDirty(false); });

  dom.measureBtn?.addEventListener("click", () => {
    state.ui.measureMode = !state.ui.measureMode;
    state.ui.measureStartCell = null;
    state.ui.measureEndCell = null;
    dirty = true;
    markDirty(false);
  });
  if(dom.toggleGridBtn){
    if(dom.toggleGridBtn.type === "checkbox"){
      dom.toggleGridBtn.addEventListener("change", () => {
        state.grid.show = !!dom.toggleGridBtn.checked;
        dirty = true;
        markDirty(false);
      });
    }else{
      dom.toggleGridBtn.addEventListener("click", () => {
        state.grid.show = !state.grid.show;
        dirty = true;
        markDirty(false);
      });
    }
  }

  // Input attach
  function attachInput(){
    if(detachInput) detachInput();
    detachInput = createInputController({
      canvas,
      state,
      onChange: (full=true) => { if(full) dirty = true; dom.onDirty?.(); markDirty(false); },
      onStatus: (t) => setStatus(t),
      onDropImage: async (file) => {
        try{ await loadBackgroundFromFile(file); }
        catch{
          setStatus("Drop image impossible ❌");
          setTimeout(() => setStatus("Prêt"), 1100);
        }
      }
    });
  }
  attachInput();
  markDirty(false);

  // ---- API for integration ----
  function getSerializableState(){
    const { ui, ...core } = state;
    return JSON.parse(JSON.stringify(core));
  }

  function setStateFromData(raw){
    const migrated = migrateState(raw);
    if(!migrated) return false;
    const ui = state.ui;
    state = migrated;
    state.ui = ui;
    // sync UI inputs
    if(dom.cellPx) dom.cellPx.value = String(state.grid.cellPx);
    if(dom.metersPerCell) dom.metersPerCell.value = String(state.grid.metersPerCell);
    if(dom.distanceRule) dom.distanceRule.value = "chebyshev";
    dirty = true;
    attachInput();
    markDirty(false);
    return true;
  }

  function reset(){
    const ui = state.ui;
    state = createInitialState();
    state.ui = ui;
    dirty = true;
    attachInput();
    markDirty(false);
  }

  function upsertTokenForCombatant(combatant){
    if(!combatant) return null;
    const tokenId = combatant.mapTokenId;
    let t = tokenId != null ? state.tokens.find(x => x.id === tokenId) : null;
    if(!t){
      const centerCell = { x: state.camera.x / state.grid.cellPx, y: state.camera.y / state.grid.cellPx };
      const id = addToken(state, {
        name: combatant.name || "Token",
        size: (combatant.tokenSize || 1),
        color: (combatant.tokenColor || colorFromId(combatant.id)),
        hiddenForPlayers: !!combatant.hiddenFromPlayers,
        hideNameForPlayers: !!combatant.hideNameForPlayers,
        censorLabel: (typeof combatant.censorLabel === "string" && combatant.censorLabel.trim()) ? combatant.censorLabel.trim().toUpperCase() : null,
        hp: combatant.hpCurrent ?? "",
        hpTemp: combatant.hpTemp ?? 0,
        ac: (combatant.acBase ?? 10) + (combatant.acTemp ?? 0),
        x: Math.round(centerCell.x * 2) / 2,
        y: Math.round(centerCell.y * 2) / 2,
      });
      combatant.mapTokenId = id;
      dirty = true;
      dom.onDirty?.();
      return id;
    }
    // update props
    t.name = combatant.name || t.name;
    if (typeof combatant.tokenSize === "number") t.size = combatant.tokenSize;
    t.hp = combatant.hpCurrent ?? t.hp;
    t.hpTemp = typeof combatant.hpTemp === "number" ? combatant.hpTemp : (t.hpTemp ?? 0);
    t.ac = (combatant.acBase ?? 10) + (combatant.acTemp ?? 0);
    t.hiddenForPlayers = !!combatant.hiddenFromPlayers;
    t.hideNameForPlayers = !!combatant.hideNameForPlayers;
    if(combatant.hideNameForPlayers){
      t.censorLabel = (typeof combatant.censorLabel === "string" && combatant.censorLabel.trim()) ? combatant.censorLabel.trim().toUpperCase() : (t.censorLabel || null);
    }
    if(combatant.tokenColor) t.color = combatant.tokenColor;
    if(!t.color) t.color = colorFromId(combatant.id);
    dirty = true;
    return t.id;
  }

  function removeToken(tokenId){
    if(tokenId == null) return;
    state.tokens = state.tokens.filter(t => t.id !== tokenId);
    if(state.selectedTokenId === tokenId) state.selectedTokenId = null;
    dirty = true;
    dom.onDirty?.();
  }

  function focusToken(tokenId){
    const t = state.tokens.find(x => x.id === tokenId);
    if(!t) return;
    state.camera.x = t.x * state.grid.cellPx;
    state.camera.y = t.y * state.grid.cellPx;
    dirty = true;
  }

  function selectToken(tokenId){
    state.selectedTokenId = tokenId;
    dirty = true;
    state.ui?.onTokenSelected?.(tokenId);
  }

  function setCallbacks({ onTokenSelected, onTokenMoved }){
    state.ui.onTokenSelected = onTokenSelected || null;
    state.ui.onTokenMoved = onTokenMoved || null;
  }

  function setOverlayProvider(fn){
    overlayProvider = (typeof fn === "function") ? fn : null;
    dirty = true;
  }

  function invalidate(){
    dirty = true;
  }

  // allow external zoom change if needed
  function setZoom(z){
    applyZoom(z);
  }

  return {
    getSerializableState,
    setStateFromData,
    reset,
    upsertTokenForCombatant,
    removeToken,
    focusToken,
    selectToken,
    setCallbacks,
    // overlays / redraw control (used for pings, measurement preview, etc.)
    setOverlayProvider,
    invalidate,
    setZoom,
    setBackgroundFromUrl: loadBackgroundFromUrl,
    _getState: () => state,
  };
}
