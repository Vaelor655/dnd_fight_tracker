import { screenToWorld, worldToCell, pickTokenAt } from "./render.js";
import { updateTokenPosition, addShape } from "./model.js";
import { clamp } from "./utils.js";

function snapWorld(state, world){
  if(state.ui.snapMode !== "on") return world;
  const c = state.grid.cellPx;
  return { x: Math.round(world.x / c) * c, y: Math.round(world.y / c) * c };
}

function snapCellForToken(state, cell){
  if(state.ui.snapMode !== "on") return cell;
  return {
    x: Math.round(cell.x * 2) / 2,
    y: Math.round(cell.y * 2) / 2,
  };
}

export function createInputController({ canvas, state, onChange, onStatus, onDropImage }){
  let isDown = false;
  let dragTokenId = null;
  let dragMode = null; // pan | measure | token | background | draw-rect | draw-circle | draw-pen
  let drawStart = null;
  let dragBackgroundOffset = null;

  function getDpr(){
    const r = canvas.getBoundingClientRect();
    return r.width ? (canvas.width / r.width) : 1;
  }

  function getScreen(e){
    const r = canvas.getBoundingClientRect();
    const dpr = getDpr();
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  }

  function setCursor(){
    if(dragMode === "pan") canvas.style.cursor = "grabbing";
    else if(dragMode === "background") canvas.style.cursor = "grabbing";
    else if(state.ui.tool === "background") canvas.style.cursor = "grab";
    else if(state.ui.measureMode) canvas.style.cursor = "crosshair";
    else if(state.ui.tool !== "tokens") canvas.style.cursor = "crosshair";
    else canvas.style.cursor = "default";
  }

  const onContextMenu = (e) => { e.preventDefault(); };

  const onPointerDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    isDown = true;

    const screen = getScreen(e);
    let world = screenToWorld(canvas, state.camera, screen);
    world = snapWorld(state, world);
    const cell = worldToCell(state, world);

    // Right click ALWAYS pans
    const wantsPan = (e.button === 2) || e.shiftKey || state.ui.spaceDown || (e.button === 1);
    if(wantsPan){
      dragMode = "pan";
      onStatus("Déplacement caméra");
      setCursor();
      return;
    }

    if(state.ui.measureMode){
      dragMode = "measure";
      state.ui.measureStartCell = { x: cell.x, y: cell.y };
      state.ui.measureEndCell = { x: cell.x, y: cell.y };
      onStatus("Mesure…");
      setCursor();
      onChange();
      return;
    }

    if(state.ui.tool === "background"){
      if(!state.background){
        onStatus("Aucune image de fond");
        setCursor();
        onChange();
        return;
      }
      dragMode = "background";
      dragBackgroundOffset = { x: world.x - state.background.x, y: world.y - state.background.y };
      onStatus("Déplacement du fond");
      setCursor();
      onChange();
      return;
    }

    // Drawing tools
    if(state.ui.tool !== "tokens"){
      drawStart = world;

      if(state.ui.tool === "rect"){
        dragMode = "draw-rect";
        state.ui.previewShape = {
          type: "rect",
          x: drawStart.x, y: drawStart.y, w: 0, h: 0,
          stroke: state.ui.drawColor,
          strokeWidth: state.ui.drawWidth,
          fill: state.ui.fillMode === "fill" ? state.ui.drawColor : null,
          fillAlpha: 0.18,
        };
        onStatus("Rectangle…");
      }else if(state.ui.tool === "circle"){
        dragMode = "draw-circle";
        state.ui.previewShape = {
          type: "circle",
          cx: drawStart.x, cy: drawStart.y, r: 0,
          stroke: state.ui.drawColor,
          strokeWidth: state.ui.drawWidth,
          fill: state.ui.fillMode === "fill" ? state.ui.drawColor : null,
          fillAlpha: 0.18,
        };
        onStatus("Cercle…");
      }else{
        dragMode = "draw-pen";
        state.ui.previewShape = {
          type: "path",
          points: [{ x: drawStart.x, y: drawStart.y }],
          stroke: state.ui.drawColor,
          strokeWidth: state.ui.drawWidth,
        };
        onStatus("Main levée…");
      }

      setCursor();
      onChange();
      return;
    }

    // Token mode
    const hitId = pickTokenAt(state, cell);
    if(hitId != null){
      dragMode = "token";
      dragTokenId = hitId;
      state.selectedTokenId = hitId;
      state.ui?.onTokenSelected?.(hitId);
      onStatus("Déplacement token");
      setCursor();
      onChange();
    }else{
      state.selectedTokenId = null;
      state.ui?.onTokenSelected?.(null);
      dragMode = null;
      dragTokenId = null;
      onStatus("Prêt");
      onChange();
    }
  };

  const onPointerMove = (e) => {
    const screen = getScreen(e);
    let world = screenToWorld(canvas, state.camera, screen);

    const cellRaw = worldToCell(state, world);
    state.ui.mouseCell = { x: cellRaw.x, y: cellRaw.y };
    onChange(false);

    if(!isDown) return;

    if(dragMode === "pan"){
      const dpr = getDpr();
      const dx = (e.movementX || 0) * dpr / state.camera.zoom;
      const dy = (e.movementY || 0) * dpr / state.camera.zoom;
      state.camera.x -= dx;
      state.camera.y -= dy;
      onChange();
      return;
    }

    const worldSnap = snapWorld(state, world);

    if(dragMode === "measure"){
      const cell = worldToCell(state, worldSnap);
      state.ui.measureEndCell = { x: cell.x, y: cell.y };
      onChange();
      return;
    }

    if(dragMode === "token" && dragTokenId != null){
      const cell = worldToCell(state, world);
      const snapped = snapCellForToken(state, cell);
      updateTokenPosition(state, dragTokenId, snapped.x, snapped.y);
      state.ui?.onTokenMoved?.(dragTokenId, snapped.x, snapped.y);
      onChange();
      return;
    }

    if(dragMode === "background" && dragBackgroundOffset && state.background){
      state.background.x = world.x - dragBackgroundOffset.x;
      state.background.y = world.y - dragBackgroundOffset.y;
      onChange();
      return;
    }

    if(dragMode === "background" && dragBackgroundOffset && state.background){
      state.background.x = world.x - dragBackgroundOffset.x;
      state.background.y = world.y - dragBackgroundOffset.y;
      onChange();
      return;
    }

    if(dragMode === "draw-rect" && state.ui.previewShape){
      state.ui.previewShape.w = worldSnap.x - drawStart.x;
      state.ui.previewShape.h = worldSnap.y - drawStart.y;
      onChange();
      return;
    }

    if(dragMode === "draw-circle" && state.ui.previewShape){
      const dx = worldSnap.x - drawStart.x;
      const dy = worldSnap.y - drawStart.y;
      state.ui.previewShape.r = Math.sqrt(dx*dx + dy*dy);
      onChange();
      return;
    }

    if(dragMode === "draw-pen" && state.ui.previewShape){
      const pts = state.ui.previewShape.points;
      const last = pts[pts.length - 1];
      const dx = worldSnap.x - last.x;
      const dy = worldSnap.y - last.y;
      if((dx*dx + dy*dy) > 9){
        pts.push({ x: worldSnap.x, y: worldSnap.y });
        onChange();
      }
    }
  };

  const onEnd = () => {
    if(!isDown) return;
    isDown = false;

    if(dragMode?.startsWith("draw") && state.ui.previewShape){
      const s = state.ui.previewShape;
      if(s.type !== "path" || (s.points?.length || 0) >= 2){
        addShape(state, s);
      }
      state.ui.previewShape = null;
      onChange();
    }

    if(dragMode === "measure") onStatus("Prêt");
    else if(dragMode?.startsWith("draw")) onStatus("Prêt");
    else if(dragMode === "background") onStatus("Prêt");
    dragMode = null;
    dragTokenId = null;
    drawStart = null;
    dragBackgroundOffset = null;
    setCursor();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const dpr = getDpr();
    const screen = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
    const anchor = screenToWorld(canvas, state.camera, screen);

    const factor = e.deltaY < 0 ? 1.08 : 1/1.08;
    const old = state.camera.zoom;
    const next = clamp(old * factor, 0.25, 3.5);

    state.camera.zoom = next;
    const after = screenToWorld(canvas, state.camera, screen);
    state.camera.x += (anchor.x - after.x);
    state.camera.y += (anchor.y - after.y);

    onChange();
  };

  const onKeyDown = (e) => { if(e.code === "Space"){ state.ui.spaceDown = true; setCursor(); } };
  const onKeyUp = (e) => { if(e.code === "Space"){ state.ui.spaceDown = false; setCursor(); } };

  const onDragOver = (e) => {
    e.preventDefault();
    canvas.style.outline = "2px dashed rgba(245,158,11,.6)";
    canvas.style.outlineOffset = "-6px";
  };
  const onDragLeave = () => {
    canvas.style.outline = "";
    canvas.style.outlineOffset = "";
  };
  const onDrop = (e) => {
    e.preventDefault();
    onDragLeave();
    const file = e.dataTransfer?.files?.[0];
    if(file && file.type?.startsWith("image/")){
      onDropImage?.(file);
    }
  };

  canvas.addEventListener("contextmenu", onContextMenu);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onEnd);
  canvas.addEventListener("pointercancel", onEnd);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  canvas.addEventListener("dragover", onDragOver);
  canvas.addEventListener("dragleave", onDragLeave);
  canvas.addEventListener("drop", onDrop);

  setCursor();

  return () => {
    canvas.removeEventListener("contextmenu", onContextMenu);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onEnd);
    canvas.removeEventListener("pointercancel", onEnd);
    canvas.removeEventListener("wheel", onWheel);

    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);

    canvas.removeEventListener("dragover", onDragOver);
    canvas.removeEventListener("dragleave", onDragLeave);
    canvas.removeEventListener("drop", onDrop);
  };
}
