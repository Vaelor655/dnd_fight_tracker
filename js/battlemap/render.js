const imageCache = new Map();

// ===== Name censor "roulette" (player view) =====
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

function getImage(src){
  if(!src) return null;
  let img = imageCache.get(src);
  if(!img){
    img = new Image();
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

function worldToScreen(canvas, camera, world){
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { x: (world.x - camera.x) * camera.zoom + cx, y: (world.y - camera.y) * camera.zoom + cy };
}

export function screenToWorld(canvas, camera, screen){
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return { x: (screen.x - cx) / camera.zoom + camera.x, y: (screen.y - cy) / camera.zoom + camera.y };
}

export function worldToCell(state, world){
  const cell = state.grid.cellPx;
  if(state.grid?.layout === "hex"){
    const qf = ((Math.sqrt(3) / 3) * world.x - (1 / 3) * world.y) / cell;
    const rf = ((2 / 3) * world.y) / cell;
    return hexRound(qf, rf);
  }
  return { x: world.x / cell, y: world.y / cell };
}

export function cellToWorld(state, cell){
  const c = state.grid.cellPx;
  if(state.grid?.layout === "hex"){
    return {
      x: c * Math.sqrt(3) * (cell.x + cell.y / 2),
      y: c * 1.5 * cell.y
    };
  }
  return { x: cell.x * c, y: cell.y * c };
}

export function pickTokenAt(state, cell){
  for(let i = state.tokens.length - 1; i >= 0; i--){
    const t = state.tokens[i];
    const half = (t.size || 1) / 2;
    if(state.grid?.layout === "hex"){
      const d = hexDistance(cell, { x: t.x, y: t.y });
      if(d <= half) return t.id;
    }else if(Math.abs(cell.x - t.x) <= half && Math.abs(cell.y - t.y) <= half){
      return t.id;
    }
  }
  return null;
}

export function draw(canvas, ctx, state, overlay){
  const { camera, grid } = state;

  const view = (state?.ui?.view || "mj");
  const isPlayerView = view === "player";
  const hideNamesForPlayer = isPlayerView && !!state?.playerView?.hideTokenNames;
  const showHpOnTokens = !isPlayerView; // player : jamais de PV sur les tokens

  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0,0,canvas.width,canvas.height);

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  ctx.setTransform(camera.zoom, 0, 0, camera.zoom, cx - camera.x * camera.zoom, cy - camera.y * camera.zoom);

  const left = camera.x - (canvas.width/2) / camera.zoom;
  const right = camera.x + (canvas.width/2) / camera.zoom;
  const top = camera.y - (canvas.height/2) / camera.zoom;
  const bottom = camera.y + (canvas.height/2) / camera.zoom;

  // Background
  const bgSrc = state.background?.dataUrl || state.background?.url;
  if(bgSrc){
    const img = getImage(bgSrc);
    if(img && img.complete && img.naturalWidth){
      const { x, y, w, h, opacity } = state.background;
      const prevAlpha = ctx.globalAlpha;
      ctx.globalAlpha = Math.max(0, Math.min(1, (opacity ?? 0.85)));
      ctx.drawImage(img, x, y, w, h);
      ctx.globalAlpha = prevAlpha;
    }
  }

  // Grid
  if(grid.show){
    const cell = grid.cellPx;
    if(grid.layout === "hex"){
      drawHexGrid(ctx, camera, cell, left, right, top, bottom);
    }else{
      const startX = Math.floor(left / cell) * cell;
      const endX = Math.ceil(right / cell) * cell;
      const startY = Math.floor(top / cell) * cell;
      const endY = Math.ceil(bottom / cell) * cell;

      // Minor lines
      ctx.lineWidth = 1 / camera.zoom;
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath();
      for(let x = startX; x <= endX; x += cell){ ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
      for(let y = startY; y <= endY; y += cell){ ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
      ctx.stroke();

      // Major lines (every 5 cells)
      const major = cell * 5;
      const startMX = Math.floor(startX / major) * major;
      const endMX = Math.ceil(endX / major) * major;
      const startMY = Math.floor(startY / major) * major;
      const endMY = Math.ceil(endY / major) * major;

      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.strokeStyle = "rgba(0,0,0,0.20)";
      ctx.beginPath();
      for(let x = startMX; x <= endMX; x += major){ ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
      for(let y = startMY; y <= endMY; y += major){ ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
      ctx.stroke();

      // Axis
      ctx.lineWidth = 2 / camera.zoom;
      ctx.strokeStyle = "rgba(245,158,11,0.32)";
      ctx.beginPath();
      ctx.moveTo(0, startY); ctx.lineTo(0, endY);
      ctx.moveTo(startX, 0); ctx.lineTo(endX, 0);
      ctx.stroke();
    }
  }

// Shapes
  for(const s of (state.shapes || [])){
    drawShape(ctx, camera, s);
  }
  if(overlay?.previewShape){
    drawShape(ctx, camera, overlay.previewShape, true);
  }

  // Tokens
  for(const t of state.tokens){
    if(isPlayerView && t.hiddenForPlayers) continue;
    const size = t.size || 1;
    const diameter = size * grid.cellPx;
    const r = diameter / 2;

    const center = cellToWorld(state, { x: t.x, y: t.y });
    const cxTok = center.x;
    const cyTok = center.y;

    // ── Movement trail (dotted path from turn start) ──
    if(Array.isArray(t.movementPath) && t.movementPath.length >= 2){
      ctx.save();
      ctx.strokeStyle = (t.color || "#c05621");
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 3 / camera.zoom;
      ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
      ctx.lineCap = "round";
      ctx.beginPath();
      const p0 = t.movementPath[0];
      const w0 = cellToWorld(state, p0);
      ctx.moveTo(w0.x, w0.y);
      for(let pi = 1; pi < t.movementPath.length; pi++){
        const pp = t.movementPath[pi];
        const wp = cellToWorld(state, pp);
        ctx.lineTo(wp.x, wp.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Movement distance label near token
      let totalDist = 0;
      for(let pi = 1; pi < t.movementPath.length; pi++){
        const dx = t.movementPath[pi].x - t.movementPath[pi-1].x;
        const dy = t.movementPath[pi].y - t.movementPath[pi-1].y;
        if(grid.layout === "hex") totalDist += hexDistance(t.movementPath[pi], t.movementPath[pi-1]);
        else totalDist += Math.max(Math.abs(dx), Math.abs(dy)); // chebyshev cells
      }
      if(totalDist > 0){
        const distM = totalDist * (state.grid.metersPerCell || 1);
        const label = distM >= 1 ? `${distM.toFixed(1)}m` : `${(distM * 100).toFixed(0)}cm`;
        ctx.globalAlpha = 0.85;
        ctx.font = `bold ${Math.max(10, grid.cellPx * 0.16)}px system-ui`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const labelX = cxTok + r + 4 / camera.zoom;
        const labelY = cyTok - r;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(label, labelX + 1, labelY + 1);
        ctx.fillStyle = t.color || "#f59e0b";
        ctx.fillText(label, labelX, labelY);
      }
      ctx.restore();
    }

    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.arc(cxTok + 4, cyTok + 4, r, 0, Math.PI*2);
    ctx.fill();

    // Token circle
    ctx.fillStyle = t.color || "#c05621";
    ctx.beginPath();
    ctx.arc(cxTok, cyTok, r, 0, Math.PI*2);
    ctx.fill();

    const isSelected = (state.selectedTokenId === t.id);
    ctx.lineWidth = (isSelected ? 3 : 1.5) / camera.zoom;
    ctx.strokeStyle = isSelected ? "rgba(245,158,11,0.95)" : "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(cxTok, cyTok, r, 0, Math.PI*2);
    ctx.stroke();

    // ── Rotation indicator (facing arrow) ──
    const rot = typeof t.rotation === "number" ? t.rotation : 0;
    if(rot !== 0 || isSelected){
      ctx.save();
      ctx.translate(cxTok, cyTok);
      ctx.rotate(rot * Math.PI / 180);
      // Arrow pointing "up" (forward direction)
      const arrowLen = r * 0.65;
      const arrowW = r * 0.22;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.beginPath();
      ctx.moveTo(0, -r + 4 / camera.zoom);
      ctx.lineTo(-arrowW, -r + 4 / camera.zoom + arrowLen);
      ctx.lineTo(arrowW, -r + 4 / camera.zoom + arrowLen);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // ── HP bar (under token) — hidden for players ──
    const hpMax = typeof t.hpMax === "number" ? t.hpMax : 0;
    const hpCur = (t.hp != null && t.hp !== "") ? Number(t.hp) : -1;
    const tempHpValue = typeof t.hpTemp === "number" ? t.hpTemp : Number(t.hpTemp || 0);
    const showHpBar = !isPlayerView && hpMax > 0 && hpCur >= 0;
    if(showHpBar){
      const barW = diameter * 0.8;
      const barH = Math.max(4, grid.cellPx * 0.08);
      const barX = cxTok - barW / 2;
      const barY = cyTok + r + 3 / camera.zoom;
      const ratio = Math.max(0, Math.min(1, hpCur / hpMax));

      // background
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      roundRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.fill();

      // HP fill
      const fillW = barW * ratio;
      if(ratio > 0 && fillW >= 1){
        const hpColor = ratio > 0.5 ? "#22c55e" : ratio > 0.25 ? "#f59e0b" : "#ef4444";
        ctx.fillStyle = hpColor;
        roundRect(ctx, barX, barY, Math.max(fillW, barH), barH, barH / 2);
        ctx.fill();
      }

      // Temp HP overlay (gold, stacked on top)
      if(tempHpValue > 0){
        const tempRatio = Math.min(1, tempHpValue / hpMax);
        const tempW = Math.max(barW * tempRatio, barH);
        const tempX = barX + fillW;
        const maxTempW = barX + barW - tempX;
        if(maxTempW > 1){
          ctx.fillStyle = "rgba(250,204,21,0.6)";
          roundRect(ctx, tempX, barY, Math.min(tempW, maxTempW), barH, barH / 2);
          ctx.fill();
        }
      }

      // border
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1 / camera.zoom;
      roundRect(ctx, barX, barY, barW, barH, barH / 2);
      ctx.stroke();
    }

    // ── HP text at center (MJ only) ──
    const hpText = (t.hp != null && t.hp !== "") ? String(t.hp) : "";
    const tempHpText = tempHpValue > 0 ? `+${tempHpValue}` : "";
    if(showHpOnTokens && hpText){
      const hpFontSize = Math.max(12, grid.cellPx * 0.30);
      const tempFontSize = Math.max(10, grid.cellPx * 0.22);
      ctx.font = `bold ${hpFontSize}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillText(hpText, cxTok + 1, cyTok + 1);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(hpText, cxTok, cyTok);
      if(tempHpText){
        const tempY = cyTok + hpFontSize * 0.7;
        ctx.font = `${tempFontSize}px system-ui`;
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillText(tempHpText, cxTok + 1, tempY + 1);
        ctx.fillStyle = "rgba(250,204,21,0.98)";
        ctx.fillText(tempHpText, cxTok, tempY);
      }
    }

    // ── Condition icons (small dots around token perimeter) ──
    const conditions = typeof t.conditions === "string" ? t.conditions.split(",").map(s => s.trim()).filter(Boolean) : [];
    const isConc = !!t.isConcentrating;
    if(isConc) conditions.unshift("⟡ Concentration");
    if(conditions.length > 0){
      const iconR = Math.max(5, grid.cellPx * 0.1);
      const ringR = r + iconR + 2 / camera.zoom;
      const startAngle = -Math.PI / 2;
      const step = (Math.PI * 2) / Math.max(conditions.length, 1);

      for(let ci = 0; ci < conditions.length; ci++){
        const angle = startAngle + step * ci;
        const ix = cxTok + Math.cos(angle) * ringR;
        const iy = cyTok + Math.sin(angle) * ringR;
        const condColor = getConditionColor(conditions[ci]);

        // dot background
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.arc(ix, iy, iconR + 1 / camera.zoom, 0, Math.PI * 2);
        ctx.fill();

        // colored dot
        ctx.fillStyle = condColor;
        ctx.beginPath();
        ctx.arc(ix, iy, iconR, 0, Math.PI * 2);
        ctx.fill();

        // icon letter
        const letter = getConditionLetter(conditions[ci]);
        ctx.font = `bold ${Math.max(8, iconR * 1.2)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff";
        ctx.fillText(letter, ix, iy);
      }
    }

    // ── Name label under token ──
    const nameYOffset = showHpBar
      ? r + 3 / camera.zoom + Math.max(4, grid.cellPx * 0.08) + 6 / camera.zoom
      : r + 8 / camera.zoom;
    const name = (t.name || "Token").trim();
    const censorName = isPlayerView && (hideNamesForPlayer || !!t.hideNameForPlayers);

    if(name && !censorName){
      drawTokenLabel(ctx, camera, grid, cxTok, cyTok + nameYOffset, name, diameter);
    }else if(censorName){
      const seed = (typeof t.censorLabel === "string" && t.censorLabel.trim()) ? t.censorLabel.trim() : "";
      const label = rollingCensorLabel(seed, t.id, Date.now());
      drawTokenLabel(ctx, camera, grid, cxTok, cyTok + nameYOffset, label, diameter);
    }
  }

  // ── Fog of War ──
  if(state.fog?.enabled){
    const fogAlpha = isPlayerView ? 1.0 : 0.35;
    const fogPad = 2000;
    const revealed = state.fog.revealedAreas || [];

    // Use an offscreen canvas so overlapping revealed areas don't cancel each other
    // (evenodd would re-fog the intersection — destination-out avoids that)
    const fog = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(canvas.width, canvas.height)
      : Object.assign(document.createElement("canvas"), { width: canvas.width, height: canvas.height });
    const fCtx = fog.getContext("2d");
    fCtx.setTransform(camera.zoom, 0, 0, camera.zoom, cx - camera.x * camera.zoom, cy - camera.y * camera.zoom);

    // Fill solid fog
    fCtx.fillStyle = "#111111";
    fCtx.fillRect(left - fogPad, top - fogPad, (right - left) + fogPad * 2, (bottom - top) + fogPad * 2);

    // Punch holes with destination-out (additive — overlaps stay revealed)
    fCtx.globalCompositeOperation = "destination-out";
    for(const area of revealed){
      fCtx.beginPath();
      if(area.type === "rect"){
        const ax = Math.min(area.x, area.x + area.w);
        const ay = Math.min(area.y, area.y + area.h);
        fCtx.rect(ax, ay, Math.abs(area.w), Math.abs(area.h));
      }else if(area.type === "circle"){
        fCtx.arc(area.cx, area.cy, area.r, 0, Math.PI * 2);
      }else if(area.type === "polygon" && area.points?.length >= 2){
        const pts = area.points;
        fCtx.moveTo(pts[0].x, pts[0].y);
        for(let i = 1; i < pts.length; i++) fCtx.lineTo(pts[i].x, pts[i].y);
        fCtx.closePath();
      }
      fCtx.fill();
    }

    // Composite onto main canvas
    ctx.save();
    ctx.globalAlpha = fogAlpha;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.restore();
  }

  // Fog preview shape (MJ drawing fog reveal)
  if(overlay?.fogPreview){
    const fp = overlay.fogPreview;
    ctx.save();
    ctx.strokeStyle = "rgba(245,158,11,0.8)";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([8 / camera.zoom, 6 / camera.zoom]);
    ctx.fillStyle = "rgba(245,158,11,0.12)";
    if(fp.type === "rect"){
      const x = Math.min(fp.x, fp.x + fp.w);
      const y = Math.min(fp.y, fp.y + fp.h);
      ctx.fillRect(x, y, Math.abs(fp.w), Math.abs(fp.h));
      ctx.strokeRect(x, y, Math.abs(fp.w), Math.abs(fp.h));
    }else if(fp.type === "circle"){
      ctx.beginPath();
      ctx.arc(fp.cx, fp.cy, Math.max(0, fp.r), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }else if(fp.type === "polygon" && fp.points?.length >= 2){
      ctx.beginPath();
      ctx.moveTo(fp.points[0].x, fp.points[0].y);
      for(let i = 1; i < fp.points.length; i++) ctx.lineTo(fp.points[i].x, fp.points[i].y);
      // Don't close during drawing — open path looks like a lasso in progress
      ctx.stroke();
    }
    ctx.restore();
  }

  // Measurement overlay

  // Ping (ephemeral marker, can be off-screen)
  if(overlay?.ping){
    const { world, ts, label, color, kind } = overlay.ping;
    const isGM = (String(kind || "").toLowerCase() === "gm");
    const fallback = isGM ? "#ef4444" : "#f59e0b";
    const pingColor = (typeof color === "string" && color.trim()) ? color.trim() : fallback;
    const now = Date.now();
    const age = Math.max(0, now - (ts || now));
    const duration = 4000;
    const alpha = 1 - (age / duration);
    if(alpha > 0 && world && isFinite(world.x) && isFinite(world.y)){
      const screen = worldToScreen(canvas, camera, world);
      const inside = (screen.x >= 0 && screen.x <= canvas.width && screen.y >= 0 && screen.y <= canvas.height);

      if(inside){
        const pulse = (age % 900) / 900; // 0..1
        const rBase = Math.max(10, grid.cellPx * 0.35);
        const rPulse = rBase + pulse * Math.max(20, grid.cellPx * 0.95);

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.95));

        // ring
        ctx.lineWidth = (isGM ? 4 : 3) / camera.zoom;
        ctx.setLineDash(isGM ? [8 / camera.zoom, 6 / camera.zoom] : []);
        ctx.strokeStyle = pingColor;
        ctx.beginPath();
        ctx.arc(world.x, world.y, rPulse, 0, Math.PI*2);
        ctx.stroke();

        // marker
        ctx.setLineDash([]);
        if(!isGM){
          // dot
          ctx.fillStyle = pingColor;
          ctx.beginPath();
          ctx.arc(world.x, world.y, 5 / camera.zoom, 0, Math.PI*2);
          ctx.fill();
        }else{
          // crosshair + diamond
          const s = 10 / camera.zoom;
          ctx.strokeStyle = pingColor;
          ctx.lineWidth = 3 / camera.zoom;

          // cross
          ctx.beginPath();
          ctx.moveTo(world.x - s, world.y);
          ctx.lineTo(world.x + s, world.y);
          ctx.moveTo(world.x, world.y - s);
          ctx.lineTo(world.x, world.y + s);
          ctx.stroke();

          // diamond
          ctx.globalAlpha *= 0.9;
          ctx.fillStyle = pingColor;
          ctx.beginPath();
          ctx.moveTo(world.x, world.y - s);
          ctx.lineTo(world.x + s, world.y);
          ctx.lineTo(world.x, world.y + s);
          ctx.lineTo(world.x - s, world.y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(world.x, world.y, 5 / camera.zoom, 0, Math.PI*2);
        ctx.fill();

        ctx.restore();
      }else{
        // off-screen indicator (screen space)
        const cx0 = canvas.width / 2;
        const cy0 = canvas.height / 2;
        let dx = screen.x - cx0;
        let dy = screen.y - cy0;

        // avoid zero division
        if(Math.abs(dx) < 1e-6) dx = 1e-6;
        if(Math.abs(dy) < 1e-6) dy = 1e-6;

        const margin = 18;
        const halfW = (canvas.width / 2) - margin;
        const halfH = (canvas.height / 2) - margin;

        const t = Math.min(halfW / Math.abs(dx), halfH / Math.abs(dy));
        const ix = cx0 + dx * t;
        const iy = cy0 + dy * t;

        const ang = Math.atan2(dy, dx);

        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha * 0.95));

        // bubble
        ctx.fillStyle = pingColor;
        ctx.strokeStyle = "rgba(0,0,0,0.20)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ix, iy, 12, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();

        // arrow
        const arrowLen = 16;
        const ax = ix + Math.cos(ang) * arrowLen;
        const ay = iy + Math.sin(ang) * arrowLen;

        ctx.fillStyle = pingColor;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ix + Math.cos(ang + 2.45) * 10, iy + Math.sin(ang + 2.45) * 10);
        ctx.lineTo(ix + Math.cos(ang - 2.45) * 10, iy + Math.sin(ang - 2.45) * 10);
        ctx.closePath();
        ctx.fill();

        // label
        const txt = (label || "PING").toString().slice(0, 24);
        ctx.font = "12px system-ui";
        const padX = 10;
        const textW = ctx.measureText(txt).width;
        const boxW = textW + padX*2;
        const boxH = 22;

        // position label slightly inward from edge
        const inward = 26;
        const lx = ix - Math.cos(ang) * inward;
        const ly = iy - Math.sin(ang) * inward;

        ctx.fillStyle = "rgba(0,0,0,0.60)";
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        roundRect(ctx, lx - boxW/2, ly - boxH/2, boxW, boxH, 999);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(txt, lx, ly);

        ctx.restore();
      }
    }
  }

if(overlay?.measure){
    const { aWorld, bWorld, label } = overlay.measure;

    ctx.lineWidth = 2 / camera.zoom;
    ctx.strokeStyle = "rgba(34,197,94,0.95)";
    ctx.beginPath();
    ctx.moveTo(aWorld.x, aWorld.y);
    ctx.lineTo(bWorld.x, bWorld.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(34,197,94,0.95)";
    ctx.beginPath(); ctx.arc(aWorld.x, aWorld.y, 4 / camera.zoom, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(bWorld.x, bWorld.y, 4 / camera.zoom, 0, Math.PI*2); ctx.fill();

    const mid = { x: (aWorld.x + bWorld.x)/2, y: (aWorld.y + bWorld.y)/2 };
    const midScreen = worldToScreen(canvas, camera, mid);

    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;

    ctx.font = "12px system-ui";
    const padX = 10;
    const textW = ctx.measureText(label).width;
    const boxW = textW + padX*2;
    const boxH = 24;

    roundRect(ctx, midScreen.x - boxW/2, midScreen.y - boxH/2, boxW, boxH, 999);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, midScreen.x, midScreen.y);
  }

  ctx.setTransform(1,0,0,1,0,0);
}

// ── Condition helpers ──
const CONDITION_COLORS = {
  "aveuglé": "#6366f1", "blinded": "#6366f1",
  "charmé": "#ec4899", "charmed": "#ec4899",
  "assourdi": "#8b5cf6", "deafened": "#8b5cf6",
  "effrayé": "#a855f7", "frightened": "#a855f7",
  "agrippé": "#f97316", "grappled": "#f97316",
  "neutralisé": "#6b7280", "incapacitated": "#6b7280",
  "invisible": "#94a3b8", "invisible": "#94a3b8",
  "paralysé": "#dc2626", "paralyzed": "#dc2626",
  "pétrifié": "#78716c", "petrified": "#78716c",
  "empoisonné": "#22c55e", "poisoned": "#22c55e",
  "à terre": "#92400e", "prone": "#92400e",
  "entravé": "#ea580c", "restrained": "#ea580c",
  "étourdi": "#eab308", "stunned": "#eab308",
  "inconscient": "#1e293b", "unconscious": "#1e293b",
  "exténué": "#854d0e", "exhaustion": "#854d0e",
  "concentration": "#3b82f6",
};

function getConditionColor(cond){
  const lower = String(cond || "").toLowerCase();
  for(const [key, color] of Object.entries(CONDITION_COLORS)){
    if(lower.includes(key)) return color;
  }
  return "#6b7280";
}

function getConditionLetter(cond){
  const lower = String(cond || "").toLowerCase();
  if(lower.includes("concentration")) return "C";
  if(lower.includes("aveuglé") || lower.includes("blinded")) return "B";
  if(lower.includes("charmé") || lower.includes("charmed")) return "Ch";
  if(lower.includes("assourdi") || lower.includes("deafened")) return "D";
  if(lower.includes("effrayé") || lower.includes("frightened")) return "F";
  if(lower.includes("agrippé") || lower.includes("grappled")) return "G";
  if(lower.includes("neutralisé") || lower.includes("incapacitated")) return "N";
  if(lower.includes("invisible")) return "I";
  if(lower.includes("paralysé") || lower.includes("paralyzed")) return "Pa";
  if(lower.includes("pétrifié") || lower.includes("petrified")) return "Pe";
  if(lower.includes("empoisonné") || lower.includes("poisoned")) return "Po";
  if(lower.includes("à terre") || lower.includes("prone")) return "Pr";
  if(lower.includes("entravé") || lower.includes("restrained")) return "R";
  if(lower.includes("étourdi") || lower.includes("stunned")) return "S";
  if(lower.includes("inconscient") || lower.includes("unconscious")) return "U";
  if(lower.includes("exténué") || lower.includes("exhaustion")) return "E";
  const first = String(cond || "?").trim();
  return first.charAt(0).toUpperCase();
}

function hexRound(qf, rf){
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(-qf - rf);
  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s + qf + rf);
  if(qDiff > rDiff && qDiff > sDiff) q = -r - s;
  else if(rDiff > sDiff) r = -q - s;
  return { x: q, y: r };
}

function hexDistance(a, b){
  const dq = (a.x - b.x);
  const dr = (a.y - b.y);
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

function drawHexGrid(ctx, camera, radius, left, right, top, bottom){
  const pad = Math.max(4, Math.ceil(3 / Math.max(0.25, camera.zoom)));
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  const invW = 1 / (Math.sqrt(3) * radius);
  let qMinF = Infinity, qMaxF = -Infinity, rMinF = Infinity, rMaxF = -Infinity;
  for(const p of corners){
    const qf = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / radius;
    const rf = ((2 / 3) * p.y) / radius;
    qMinF = Math.min(qMinF, qf);
    qMaxF = Math.max(qMaxF, qf);
    rMinF = Math.min(rMinF, rf);
    rMaxF = Math.max(rMaxF, rf);
  }
  const rMin = Math.floor(rMinF) - pad;
  const rMax = Math.ceil(rMaxF) + pad;

  ctx.lineWidth = 1 / camera.zoom;
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for(let r = rMin; r <= rMax; r++){
    // Per-row q bounds to avoid drawing an oversized q/r rectangle (perf + artifacts).
    const qMin = Math.floor((left * invW) - (r / 2)) - pad;
    const qMax = Math.ceil((right * invW) - (r / 2)) + pad;
    ctx.beginPath();
    for(let q = qMin; q <= qMax; q++){
      const cx = radius * Math.sqrt(3) * (q + r / 2);
      const cy = radius * 1.5 * r;
      const a0 = -Math.PI / 6; // -30°
      ctx.moveTo(cx + radius * Math.cos(a0), cy + radius * Math.sin(a0));
      for(let i = 1; i <= 6; i++){
        const a = (Math.PI / 180) * (60 * i - 30);
        ctx.lineTo(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
      }
      ctx.closePath();
    }
    ctx.stroke();
  }
}

function drawTokenLabel(ctx, camera, grid, cx, yTop, text, diameter){
  ctx.font = `${Math.max(11, grid.cellPx * 0.18)}px system-ui`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const maxW = Math.max(90, diameter * 1.35);
  let label = text;
  while(label.length > 2 && ctx.measureText(label).width > maxW){
    label = label.slice(0, -2).trimEnd() + "…";
  }

  const padX = 8 / camera.zoom;
  const padY = 4 / camera.zoom;
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1 / camera.zoom;

  roundRect(ctx, cx - (textW/2) - padX, yTop - padY, textW + padX*2, (16 / camera.zoom) + padY*2, 999);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.fillText(label, cx, yTop);
}


// ── Animated spell effects (one-shot) ──────────────────────────────────────

// Visual noise clock (page-relative, smooth)
function _n(){ return performance.now() / 1000; }

function hexToRgb(hex){
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) }
           : { r: 255, g: 100, b: 0 };
}
// Blend rgb toward white for bright core
function _rc(rgb, a){ return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`; }
function _rw(rgb, t, a){ // t=0 → color, t=1 → white
  const r = Math.round(rgb.r + (255-rgb.r)*t);
  const g = Math.round(rgb.g + (255-rgb.g)*t);
  const b = Math.round(rgb.b + (255-rgb.b)*t);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * Compute animation state for a one-shot spell shape.
 * - preview (no animStart): loops visually so the user can see the effect during drag
 * - after release (animStart set): counts down to expiry and returns done=true
 */
function animProg(s, durationMs){
  const n = _n();
  if(!s.animStart){
    // Preview: cycle progress for a representative look, never expires
    const cycle = durationMs / 1000;
    return { p: (n % cycle) / cycle, fade: 1, n, done: false, isPreview: true };
  }
  const elapsed = Date.now() - s.animStart;
  const p = Math.min(elapsed / durationMs, 1);
  // Fade: full for first 60%, then ease out over last 40%
  const fade = p < 0.6 ? 1 : 1 - ((p - 0.6) / 0.4);
  return { p, fade, n, done: p >= 1, isPreview: false };
}

// Returns true if the shape should be skipped (expired one-shot)
export function isAnimShapeExpired(s){
  if(!s.anim || !s.animStart) return false;
  const dur = s.anim === "arcane" ? 2500 : s.type === "circle" ? 2000 : s.type === "cone" ? 1800 : 1500;
  return (Date.now() - s.animStart) >= dur;
}

function drawSpellFireCircle(ctx, camera, s, preview){
  const DURATION = 2000;
  const { p, fade, n, done } = animProg(s, DURATION);
  if(done) return;

  const rgb = hexToRgb(s.stroke || "#f59e0b");
  const cx = s.cx, cy = s.cy, r = Math.max(1, s.r);
  // Expansion burst at start (scale 1.4→1 in first 20%)
  const burst = p < 0.2 ? (1.4 - p / 0.2 * 0.4) : 1.0;
  const ef = fade;

  // White flash on impact (first 15%)
  if(p < 0.15){
    const flashA = (1 - p / 0.15) * 0.85 * ef;
    ctx.save();
    ctx.globalAlpha = flashA;
    const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * burst * 1.1);
    fg.addColorStop(0,   "rgba(255,255,255,1)");
    fg.addColorStop(0.4, _rw(rgb, 0.6, 0.8));
    fg.addColorStop(1,   _rc(rgb, 0));
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy, r * burst * 1.1, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // Shockwave ring expanding outward
  const swP = Math.min(p / 0.4, 1);
  const swR = r * (1 + swP * 0.8);
  const swA = (1 - swP) * 0.6 * ef;
  ctx.save();
  ctx.globalAlpha = swA;
  ctx.strokeStyle = _rw(rgb, 0.5, 1);
  ctx.lineWidth = (4 - swP * 3) / camera.zoom;
  ctx.beginPath(); ctx.arc(cx, cy, swR, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  // Radial fill
  const noiseP = 0.88 + Math.sin(n * 5.3) * 0.08 + Math.sin(n * 7.7) * 0.04;
  const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * burst * noiseP);
  gr.addColorStop(0,    `rgba(255,255,200,${0.95*ef})`);
  gr.addColorStop(0.25, _rw(rgb, 0.4, 0.75*ef));
  gr.addColorStop(0.6,  _rc(rgb, 0.5*ef));
  gr.addColorStop(1,    _rc(rgb, 0));
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r * burst, 0, Math.PI*2);
  ctx.fillStyle = gr; ctx.fill();
  ctx.restore();

  // Corona particles (skip during fade-out)
  if(p < 0.7){
    const np = 10;
    ctx.save();
    for(let i = 0; i < np; i++){
      const angle = (i/np)*Math.PI*2 + n*1.8 + i*0.4;
      const dist  = r * burst * (0.85 + Math.sin(n*3.5+i*0.9)*0.18);
      const px = cx + Math.cos(angle)*dist;
      const py = cy + Math.sin(angle)*dist;
      const sz = r*0.18 + Math.sin(n*4+i)*r*0.07;
      ctx.globalAlpha = (0.7 + Math.sin(n*5+i)*0.25) * ef;
      ctx.fillStyle = _rw(rgb, 0.3 + Math.sin(n*3+i)*0.2, 1);
      ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  // Outer ring
  ctx.save();
  ctx.globalAlpha = ef;
  ctx.lineWidth = (2.5 + Math.sin(n*4)*0.6) / camera.zoom;
  ctx.strokeStyle = _rc(rgb, 1);
  ctx.shadowBlur  = 14 / camera.zoom;
  ctx.shadowColor = _rw(rgb, 0.3, 1);
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  ctx.restore();
}

function drawSpellFireCone(ctx, camera, s, preview){
  const DURATION = 1800;
  const { p, fade, n, done } = animProg(s, DURATION);
  if(done) return;

  const rgb = hexToRgb(s.stroke || "#f59e0b");
  const spread = Math.PI / 3, half = spread / 2;
  // Cone "grows" from 0 to full in first 10% (minimum 0.02 to keep clip non-degenerate)
  const grow = p < 0.1 ? Math.max(0.02, p / 0.1) : 1.0;
  const len = Math.max(1, (s.length || 0)) * grow;
  const ang = s.angle || 0;
  const ef = fade;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(s.cx, s.cy);
  ctx.lineTo(s.cx + Math.cos(ang - half) * len, s.cy + Math.sin(ang - half) * len);
  ctx.arc(s.cx, s.cy, len, ang - half, ang + half);
  ctx.closePath();
  ctx.clip();

  const gr = ctx.createRadialGradient(s.cx, s.cy, 0, s.cx, s.cy, len);
  const np = 0.82 + Math.sin(n * 5) * 0.1;
  gr.addColorStop(0,       `rgba(255,255,200,${0.9*ef})`);
  gr.addColorStop(0.35*np, _rw(rgb, 0.35, 0.75*ef));
  gr.addColorStop(0.7,     _rc(rgb, 0.4*ef));
  gr.addColorStop(1,       _rc(rgb, 0));
  ctx.fillStyle = gr;
  ctx.fillRect(s.cx - len, s.cy - len, len * 2, len * 2);

  // Flame tendrils
  const nt = 9;
  for(let i = 0; i < nt; i++){
    const ta = ang - half*0.9 + (i/(nt-1))*half*1.8;
    const wb = Math.sin(n*4.2+i*1.6) * 0.09;
    const tl = len * (0.65 + Math.sin(n*3.1+i*0.8)*0.22);
    const tx = s.cx + Math.cos(ta+wb)*tl;
    const ty = s.cy + Math.sin(ta+wb)*tl;
    const lw = (4 + Math.sin(n*5+i)*2) / camera.zoom;
    const al = (0.25 + Math.sin(n*3.7+i*0.9)*0.18) * ef;
    const tg = ctx.createLinearGradient(s.cx, s.cy, tx, ty);
    tg.addColorStop(0, _rw(rgb, 0.7, al*1.4));
    tg.addColorStop(1, _rc(rgb, 0));
    ctx.globalAlpha = 1; ctx.strokeStyle = tg;
    ctx.lineWidth = lw; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(tx, ty); ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = ef;
  ctx.lineWidth = 2 / camera.zoom;
  ctx.strokeStyle = _rc(rgb, 1);
  ctx.shadowBlur  = 12 / camera.zoom;
  ctx.shadowColor = _rw(rgb, 0.3, 1);
  ctx.beginPath();
  ctx.moveTo(s.cx, s.cy);
  ctx.lineTo(s.cx + Math.cos(ang - half)*len, s.cy + Math.sin(ang - half)*len);
  ctx.arc(s.cx, s.cy, len, ang - half, ang + half);
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function drawSpellFireLine(ctx, camera, s, preview){
  const DURATION = 1500;
  const { p, fade, n, done } = animProg(s, DURATION);
  if(done) return;

  const rgb = hexToRgb(s.stroke || "#f59e0b");
  const dx = (s.x2||0)-(s.x1||0), dy = (s.y2||0)-(s.y1||0);
  const len = Math.sqrt(dx*dx+dy*dy);
  if(len < 1) return;
  const ef = fade;
  const nx = -dy/len, ny = dx/len;
  const hw = (s.width||30) / 2;

  // Bolt "travels" along the line in first 25% (minimum 0.02 to keep clip non-degenerate)
  const travel = p < 0.25 ? Math.max(0.02, p / 0.25) : 1.0;
  const ex = s.x1 + dx * travel, ey = s.y1 + dy * travel;

  const c1 = { x: s.x1+nx*hw, y: s.y1+ny*hw };
  const c2 = { x: ex+nx*hw, y: ey+ny*hw };
  const c3 = { x: ex-nx*hw, y: ey-ny*hw };
  const c4 = { x: s.x1-nx*hw, y: s.y1-ny*hw };

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y);
  ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y);
  ctx.closePath(); ctx.clip();

  const midX = (s.x1+ex)/2, midY = (s.y1+ey)/2;
  const pg = ctx.createLinearGradient(midX+nx*hw, midY+ny*hw, midX-nx*hw, midY-ny*hw);
  const cp = 0.82 + Math.sin(n*6.2)*0.14;
  pg.addColorStop(0,    _rc(rgb, 0.05*ef));
  pg.addColorStop(0.28, _rc(rgb, 0.55*ef));
  pg.addColorStop(0.5,  _rw(rgb, 0.7, cp*ef));
  pg.addColorStop(0.72, _rc(rgb, 0.55*ef));
  pg.addColorStop(1,    _rc(rgb, 0.05*ef));
  ctx.fillStyle = pg;
  const tLen = Math.sqrt((ex-s.x1)**2+(ey-s.y1)**2);
  ctx.fillRect(Math.min(s.x1,ex)-hw, Math.min(s.y1,ey)-hw, tLen+hw*2, tLen+hw*2);

  // Moving energy blobs along traveled portion
  const ns = 6;
  for(let i = 0; i < ns; i++){
    const pr = ((n*1.1+i/ns) % 1) * travel;
    const bx = s.x1+dx*pr + nx*Math.sin(n*5+i*1.4)*hw*0.55;
    const by = s.y1+dy*pr + ny*Math.sin(n*5+i*1.4)*hw*0.55;
    const bAlpha = travel > 0 ? Math.sin(pr/travel*Math.PI)*0.7*ef : 0;
    ctx.globalAlpha = bAlpha;
    ctx.fillStyle = _rw(rgb, 0.5, 1);
    ctx.beginPath(); ctx.arc(bx, by, hw*0.32, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = ef;
  ctx.lineWidth = (1.5+Math.sin(n*5)*0.5) / camera.zoom;
  ctx.strokeStyle = _rc(rgb, 1);
  ctx.shadowBlur  = 10 / camera.zoom;
  ctx.shadowColor = _rw(rgb, 0.3, 1);
  ctx.beginPath();
  ctx.moveTo(c1.x,c1.y); ctx.lineTo(c2.x,c2.y);
  ctx.lineTo(c3.x,c3.y); ctx.lineTo(c4.x,c4.y);
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function drawSpellArcaneRect(ctx, camera, s, preview){
  const DURATION = 2500;
  const { p, fade, n, done } = animProg(s, DURATION);
  if(done) return;

  const x = Math.min(s.x, s.x+s.w), y = Math.min(s.y, s.y+s.h);
  const w = Math.abs(s.w), h = Math.abs(s.h);
  if(w < 1 || h < 1) return;
  const col = s.stroke || "#ef4444";
  const ef = fade;
  // Expand in during first 15% (minimum 0.01 to avoid ctx.scale(0,0))
  const expand = p < 0.15 ? Math.max(0.01, p / 0.15) : 1.0;
  const cx = x + w/2, cy = y + h/2;
  const ew = w * expand, eh = h * expand;
  const ex = cx - ew/2, ey = cy - eh/2;

  ctx.save();
  ctx.globalAlpha = ef;
  ctx.translate(cx, cy);
  ctx.scale(expand, expand);
  ctx.translate(-cx, -cy);

  // Pulsing fill
  ctx.globalAlpha = (0.35 + Math.sin(n*2.4)*0.12) * ef;
  const fg = ctx.createLinearGradient(x, y, x+w, y+h);
  fg.addColorStop(0, col+"40"); fg.addColorStop(0.5, col+"15"); fg.addColorStop(1, col+"40");
  ctx.fillStyle = fg; ctx.fillRect(x, y, w, h);

  // Interior grid
  const gs = Math.min(w,h) / 5;
  if(gs > 0){
    ctx.globalAlpha = (0.2 + Math.sin(n*2)*0.06) * ef;
    ctx.strokeStyle = col; ctx.lineWidth = 0.7/camera.zoom;
    ctx.setLineDash([3/camera.zoom, 3/camera.zoom]);
    for(let gx = x+gs; gx < x+w; gx += gs){ ctx.beginPath(); ctx.moveTo(gx,y); ctx.lineTo(gx,y+h); ctx.stroke(); }
    for(let gy = y+gs; gy < y+h; gy += gs){ ctx.beginPath(); ctx.moveTo(x,gy); ctx.lineTo(x+w,gy); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  // Rotating diamond runes
  const cs = Math.min(w,h) * 0.11;
  const corners = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  ctx.strokeStyle = col; ctx.lineWidth = 2/camera.zoom;
  ctx.shadowBlur = 8/camera.zoom; ctx.shadowColor = col;
  for(let ci = 0; ci < 4; ci++){
    const [rx,ry] = corners[ci];
    ctx.save(); ctx.translate(rx,ry);
    ctx.rotate(n*(ci%2===0?1:-1)*1.2); ctx.globalAlpha = ef;
    ctx.beginPath(); ctx.moveTo(0,-cs); ctx.lineTo(cs,0); ctx.lineTo(0,cs); ctx.lineTo(-cs,0); ctx.closePath(); ctx.stroke();
    ctx.globalAlpha = 0.4*ef;
    ctx.beginPath(); ctx.moveTo(0,-cs*.5); ctx.lineTo(cs*.5,0); ctx.lineTo(0,cs*.5); ctx.lineTo(-cs*.5,0); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  // Marching-ants border
  const dl = Math.min(w,h)/6;
  ctx.globalAlpha = ef;
  ctx.strokeStyle = col; ctx.lineWidth = (2.2+Math.sin(n*3)*0.6)/camera.zoom;
  ctx.shadowBlur = 10/camera.zoom; ctx.shadowColor = col;
  if(dl > 0){
    ctx.setLineDash([dl/camera.zoom, dl/camera.zoom]);
    ctx.lineDashOffset = -(n*55 % (dl*2)) / camera.zoom;
  }
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Main shape draw (static + animated) ────────────────────────────────────

function drawShape(ctx, camera, s, preview=false){
  // Dispatch to animated renderers for spell shapes
  if(s.anim === "fire"){
    if(s.type === "circle")        return drawSpellFireCircle(ctx, camera, s, preview);
    if(s.type === "cone")          return drawSpellFireCone(ctx, camera, s, preview);
    if(s.type === "line-template") return drawSpellFireLine(ctx, camera, s, preview);
  }
  if(s.anim === "arcane"){
    if(s.type === "rect")          return drawSpellArcaneRect(ctx, camera, s, preview);
  }

  // ── Static fallback ─────────────────────────────────────────────────────
  const stroke = s.stroke || "#22c55e";
  const width = Math.max(1, Number(s.strokeWidth || 3));
  const fill = s.fill || null;
  const fillAlpha = s.fillAlpha ?? 0.18;

  ctx.save();
  ctx.lineWidth = width / camera.zoom;
  ctx.strokeStyle = stroke;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if(preview){
    ctx.setLineDash([10 / camera.zoom, 8 / camera.zoom]);
    ctx.globalAlpha = 0.9;
  }

  if(s.type === "rect"){
    const x = Math.min(s.x, s.x + s.w);
    const y = Math.min(s.y, s.y + s.h);
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);

    if(fill){
      ctx.save();
      ctx.globalAlpha = preview ? 0.12 : fillAlpha;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }
    ctx.strokeRect(x, y, w, h);
  }else if(s.type === "circle"){
    const cx = s.cx, cy = s.cy, r = Math.max(0, s.r);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    if(fill){
      ctx.save();
      ctx.globalAlpha = preview ? 0.12 : fillAlpha;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
    ctx.stroke();
  }else if(s.type === "path"){
    const pts = s.points || [];
    if(pts.length >= 2){
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  }else if(s.type === "cone"){
    const spread = Math.PI / 3;
    const halfSpread = spread / 2;
    const len = s.length || 0;
    const ang = s.angle || 0;

    ctx.beginPath();
    ctx.moveTo(s.cx, s.cy);
    ctx.lineTo(s.cx + Math.cos(ang - halfSpread) * len, s.cy + Math.sin(ang - halfSpread) * len);
    ctx.arc(s.cx, s.cy, len, ang - halfSpread, ang + halfSpread);
    ctx.closePath();

    if(fill){
      ctx.save();
      ctx.globalAlpha = preview ? 0.15 : fillAlpha;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
    ctx.stroke();
  }else if(s.type === "line-template"){
    const dx = (s.x2 || 0) - (s.x1 || 0);
    const dy = (s.y2 || 0) - (s.y1 || 0);
    const len = Math.sqrt(dx*dx + dy*dy);
    if(len > 0){
      const nx = -dy / len * (s.width || 10) / 2;
      const ny = dx / len * (s.width || 10) / 2;

      ctx.beginPath();
      ctx.moveTo(s.x1 + nx, s.y1 + ny);
      ctx.lineTo(s.x2 + nx, s.y2 + ny);
      ctx.lineTo(s.x2 - nx, s.y2 - ny);
      ctx.lineTo(s.x1 - nx, s.y1 - ny);
      ctx.closePath();

      if(fill){
        ctx.save();
        ctx.globalAlpha = preview ? 0.15 : fillAlpha;
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
