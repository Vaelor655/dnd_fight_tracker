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
  return { x: world.x / state.grid.cellPx, y: world.y / state.grid.cellPx };
}

export function pickTokenAt(state, cell){
  for(let i = state.tokens.length - 1; i >= 0; i--){
    const t = state.tokens[i];
    const half = (t.size || 1) / 2;
    if(Math.abs(cell.x - t.x) <= half && Math.abs(cell.y - t.y) <= half) return t.id;
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

    const cxTok = t.x * grid.cellPx;
    const cyTok = t.y * grid.cellPx;

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

    // HP at center (MJ uniquement)
    const hpText = (t.hp != null && t.hp !== "") ? String(t.hp) : "";
    const tempHpValue = typeof t.hpTemp === "number" ? t.hpTemp : Number(t.hpTemp || 0);
    const tempHpText = tempHpValue > 0 ? `+${tempHpValue}` : "";
    if(showHpOnTokens && hpText){
      const hpFontSize = Math.max(12, grid.cellPx * 0.30);
      const tempFontSize = Math.max(10, grid.cellPx * 0.22);
      ctx.font = `${hpFontSize}px system-ui`;
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

    // Full name under token (single line)
    // Player view: the MJ can either hide all names, or hide names individually per token.
    const name = (t.name || "Token").trim();
    const censorName = isPlayerView && (hideNamesForPlayer || !!t.hideNameForPlayers);

    if(name && !censorName){
      ctx.font = `${Math.max(11, grid.cellPx * 0.18)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const maxW = Math.max(90, diameter * 1.35);
      let label = name;
      while(label.length > 2 && ctx.measureText(label).width > maxW){
        label = label.slice(0, -2).trimEnd() + "…";
      }

      const yText = cyTok + r + (8 / camera.zoom);

      // small backing for readability
      const padX = 8 / camera.zoom;
      const padY = 4 / camera.zoom;
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1 / camera.zoom;

      roundRect(ctx, cxTok - (textW/2) - padX, yText - padY, textW + padX*2, (16 / camera.zoom) + padY*2, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillText(label, cxTok, yText);
    }else if(censorName){
      // Censored label: 6 chars, animated "roulette" (canvas needs redraw)
      const seed = (typeof t.censorLabel === "string" && t.censorLabel.trim()) ? t.censorLabel.trim() : "";
      const label = rollingCensorLabel(seed, t.id, Date.now());

      ctx.font = `${Math.max(11, grid.cellPx * 0.18)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      const yText = cyTok + r + (8 / camera.zoom);

      const padX = 8 / camera.zoom;
      const padY = 4 / camera.zoom;
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 1 / camera.zoom;

      roundRect(ctx, cxTok - (textW/2) - padX, yText - padY, textW + padX*2, (16 / camera.zoom) + padY*2, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fillText(label, cxTok, yText);
    }
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

function drawShape(ctx, camera, s, preview=false){
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
