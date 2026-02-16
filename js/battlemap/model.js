import { snapHalf } from "./utils.js";

export function createInitialState(){
  return {
    version: 3,
    grid: { show: true, cellPx: 40, metersPerCell: 1, distanceRule: "chebyshev" },
    camera: { x: 0, y: 0, zoom: 1 },
    background: null, // { dataUrl, x, y, w, h, opacity, _naturalW, _naturalH } (world px)
    shapes: [],       // drawing layer (world px)
    tokens: [],
    // Options de rendu côté player (contrôlées par le MJ)
    playerView: {
      hideTokenNames: false,
    },
    // Ordre des tours (affiché côté player)
    turnBar: {
      order: [],
      activeIndex: 0,
    },
    selectedTokenId: null,
    nextId: 1,
    nextShapeId: 1,
  };
}

export function migrateState(raw){
  if(!raw || typeof raw !== "object") return null;
  const v = Number(raw.version || 1);

  const cellPx = raw.grid?.cellPx ?? 60;
  const distanceRule = raw.grid?.distanceRule ?? "chebyshev";

  let metersPerCell = 1;
  if(v === 2){
    // v2 used feetPerCell in state; convert to meters
    const feet = raw.grid?.feetPerCell ?? 5;
    metersPerCell = Math.max(0.1, Number(raw.grid?.metersPerCell ?? (feet * 0.3048) ?? 1));
  }else if(v >= 3){
    metersPerCell = Math.max(0.1, Number(raw.grid?.metersPerCell ?? 1));
  }else{
    metersPerCell = 1;
  }

  return {
    version: 3,
    grid: {
      show: raw.grid?.show ?? true,
      cellPx: Number(cellPx) || 60,
      metersPerCell,
      distanceRule
    },
    camera: raw.camera || { x: 0, y: 0, zoom: 1 },
    background: raw.background || null,
    shapes: Array.isArray(raw.shapes) ? raw.shapes : [],
    tokens: Array.isArray(raw.tokens) ? raw.tokens : [],
    playerView: {
      hideTokenNames: !!(raw.playerView?.hideTokenNames ?? raw.playerView?.hideNames ?? false),
    },
    turnBar: {
      order: Array.isArray(raw.turnBar?.order) ? raw.turnBar.order : (Array.isArray(raw.turn?.order) ? raw.turn.order : []),
      activeIndex: Number(raw.turnBar?.activeIndex ?? raw.turn?.activeIndex ?? raw.turnBar?.active ?? raw.turn?.active ?? 0) || 0,
    },
    selectedTokenId: raw.selectedTokenId ?? null,
    nextId: raw.nextId || 1,
    nextShapeId: raw.nextShapeId || (Array.isArray(raw.shapes) ? (raw.shapes.length + 1) : 1),
  };
}

export function addToken(state, token){
  const id = state.nextId++;
  state.tokens.push({ id, ...token });
  state.selectedTokenId = id;
  return id;
}

export function deleteSelected(state){
  if(state.selectedTokenId == null) return;
  state.tokens = state.tokens.filter(t => t.id !== state.selectedTokenId);
  state.selectedTokenId = state.tokens.length ? state.tokens[state.tokens.length - 1].id : null;
}

export function clearTokens(state){
  state.tokens = [];
  state.selectedTokenId = null;
  state.nextId = 1;
}

export function updateTokenPosition(state, id, cellX, cellY){
  const t = state.tokens.find(x => x.id === id);
  if(!t) return;
  t.x = snapHalf(cellX);
  t.y = snapHalf(cellY);
}

export function addShape(state, shape){
  const id = state.nextShapeId++;
  state.shapes.push({ id, ...shape });
  return id;
}

export function undoShape(state){
  if(!state.shapes?.length) return;
  state.shapes.pop();
}

export function clearShapes(state){
  state.shapes = [];
}
