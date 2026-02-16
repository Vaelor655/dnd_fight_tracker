import { getSupabase, isConfigured } from "./client.js";
import { BATTLEMAP_TABLE } from "./config.js";

function stableId(storageKey){
  try{
    const existing = localStorage.getItem(storageKey);
    if(existing && existing.trim()) return existing.trim();
  }catch{}
  let id = "";
  try{
    id = (crypto?.randomUUID && crypto.randomUUID()) || "";
  }catch{}
  if(!id){
    id = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`.slice(0,36);
  }
  try{ localStorage.setItem(storageKey, id); }catch{}
  return id;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function presencePlayersFromState(presenceState){
  const out = [];
  const state = presenceState || {};
  for(const key of Object.keys(state)){
    const arr = state[key] || [];
    for(const p of arr){
      if(String(p?.role || "").toLowerCase() !== "player") continue;
      out.push({
        name: String(p?.name || p?.username || "Player"),
        color: String(p?.color || "#999999"),
      });
    }
  }
  // dedupe
  const seen = new Set();
  const uniq = [];
  for(const p of out){
    const k = `${p.name}|${p.color}`;
    if(seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  uniq.sort((a,b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  return uniq;
}

function renderOnlinePlayers(listEl, players){
  if(!listEl) return;
  if(!players || !players.length){
    listEl.innerHTML = `<span class="muted">—</span>`;
    return;
  }
  listEl.innerHTML = players.map(p => `
    <span class="player-pill" title="${escapeHtml(p.name)}">
      <span class="player-color" style="background:${escapeHtml(p.color)}"></span>
      <span class="player-name">${escapeHtml(p.name)}</span>
    </span>
  `).join("");
}



/**
 * Realtime sync: MJ écrit dans la table (upsert), joueurs s'abonnent via postgres_changes.
 * Cette version est volontairement simple : on sync le "state" complet, throttlé.
 */
export function initMapRealtimeMJ({
  battlemap,
  roomInput,
  statusEl,
  connectBtn,
  playerLinkInput,
  copyBtn,
  bgUrlInput,
  bgUrlBtn,
  onlineEl,
  onPing,
}){
  const supabase = getSupabase();

  let connected = false;
  let roomId = "";
  let dirtyTs = 0;
  let flushTimer = null;

const presenceKey = stableId("battlemap_presence_key_mj_v1");
let presenceChannel = null;

function updateOnlineList(){
  if(!presenceChannel) return;
  try{
    const players = presencePlayersFromState(presenceChannel.presenceState());
    renderOnlinePlayers(onlineEl, players);
  }catch{}
}

async function startPresence(){
  if(!supabase) return;
  if(presenceChannel){
    try{ supabase.removeChannel(presenceChannel); }catch{}
    presenceChannel = null;
  }
  presenceChannel = supabase
    .channel(`battlemap:${roomId}`, { config: { presence: { key: presenceKey } } })
    .on("broadcast", { event: "ping" }, (msg) => { try{ onPing && onPing(msg?.payload); }catch{} })
    .on("presence", { event: "sync" }, () => updateOnlineList())
    .on("presence", { event: "join" }, () => updateOnlineList())
    .on("presence", { event: "leave" }, () => updateOnlineList())
    .subscribe(async (status) => {
      if(status === "SUBSCRIBED"){
        try{
          await presenceChannel.track({ role: "mj", name: "MJ", color: "#6b7280", ts: Date.now() });
        }catch{}
        updateOnlineList();
      }
    });
}

function stopPresence(){
  if(!supabase) return;
  if(presenceChannel){
    try{ supabase.removeChannel(presenceChannel); }catch{}
    presenceChannel = null;
  }
  renderOnlinePlayers(onlineEl, []);
}


  function setStatus(t){ if(statusEl) statusEl.textContent = t; }

  function computeRoomFromUrl(){
    const qs = new URLSearchParams(location.search);
    const q = (qs.get("room") || "").trim();
    return q || localStorage.getItem("battlemap_room") || "default";
  }

  function setRoom(newRoom){
    roomId = (newRoom || "").trim() || "default";
    localStorage.setItem("battlemap_room", roomId);
    if(roomInput) roomInput.value = roomId;

    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    history.replaceState(null, "", url.toString());

    // player link (player.html)
    const playerUrl = new URL(location.href);
    playerUrl.pathname = playerUrl.pathname.replace(/\/index\.html?$/, "/player.html");
    if(playerUrl.pathname.endsWith("/")) playerUrl.pathname += "player.html";
    playerUrl.searchParams.set("room", roomId);
    if(playerLinkInput) playerLinkInput.value = playerUrl.toString();
  }

  function sanitizeStateForSync(core){
    // éviter d'envoyer un fond base64 énorme
    const s = JSON.parse(JSON.stringify(core || {}));
    if(s.background?.dataUrl && String(s.background.dataUrl).startsWith("data:")){
      // on garde juste les métadonnées, mais pas le binaire
      s.background.dataUrl = null;
    }
    return s;
  }

  async function loadRemoteOnce(){
    if(!connected) return;
    try{
      const { data, error } = await supabase
        .from(BATTLEMAP_TABLE)
        .select("state, updated_at")
        .eq("room_id", roomId)
        .maybeSingle();

      if(error){
        console.warn(error);
        setStatus("Erreur lecture");
        return;
      }
      if(data?.state){
        battlemap.setStateFromData(data.state);
        setStatus("State chargé (remote) ✅");
      }else{
        setStatus("Aucun state remote (ok)");
      }
    }catch(e){
      console.warn(e);
      setStatus("Erreur lecture");
    }
  }

  async function flushNow(){
    if(!connected) return;
    try{
      const core = battlemap.getSerializableState();
      const state = sanitizeStateForSync(core);
      const row = {
        room_id: roomId,
        state,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from(BATTLEMAP_TABLE)
        .upsert(row, { onConflict: "room_id" });

      if(error){
        console.warn(error);
        setStatus("Erreur écriture");
        return;
      }
      setStatus("Sync ✅");
    }catch(e){
      console.warn(e);
      setStatus("Erreur écriture");
    }
  }

  function markDirty(){
    if(!connected) return;
    dirtyTs = Date.now();
  }

  function startLoop(){
    if(flushTimer) return;

    // Mode "fluide" : on flush régulièrement pendant les mouvements
    // (sinon les joueurs voient des "sauts" car on attend l'idle).
    let lastFlushAt = 0;

    flushTimer = setInterval(() => {
      if(!connected) return;
      if(!dirtyTs) return;

      const now = Date.now();

      // Limite : ~8-10 updates/sec max (évite de spammer Postgres)
      if(now - lastFlushAt < 120) return;

      lastFlushAt = now;
      dirtyTs = 0;
      flushNow();
    }, 60);
  }

  function stopLoop(){
    if(flushTimer){
      clearInterval(flushTimer);
      flushTimer = null;
    }
    dirtyTs = 0;
  }

  async function connect(){
    if(!isConfigured()){
      setStatus("Config Supabase manquante (js/realtime/config.js)");
      return;
    }
    if(connected) return;
    connected = true;
    connectBtn && (connectBtn.textContent = "Realtime : ON");
    setStatus("Connexion…");
    startLoop();
    await loadRemoteOnce();
    startPresence();
  }

  function disconnect(){
    connected = false;
    connectBtn && (connectBtn.textContent = "Realtime : OFF");
    setStatus("OFF");
    stopLoop();
    stopPresence();
  }

  // UI wiring
  setRoom(computeRoomFromUrl());

  if(!isConfigured()){
    setStatus("non configuré");
    connectBtn && (connectBtn.disabled = false);
  }else{
    setStatus("prêt (OFF)");
  }

  connectBtn?.addEventListener("click", () => {
    if(!connected) connect();
    else disconnect();
  });

  copyBtn?.addEventListener("click", async () => {
    try{
      await navigator.clipboard.writeText(playerLinkInput?.value || "");
      setStatus("Lien copié ✅");
      setTimeout(() => setStatus(connected ? "Sync ✅" : "prêt (OFF)"), 900);
    }catch{
      setStatus("Copie impossible");
    }
  });

  roomInput?.addEventListener("change", async () => {
    setRoom(roomInput.value);
    if(connected){
      setStatus("Changement room…");
      await loadRemoteOnce();
    }
  });

  bgUrlBtn?.addEventListener("click", async () => {
    const url = (bgUrlInput?.value || "").trim();
    if(!url) return;
    try{
      await battlemap.setBackgroundFromUrl(url);
      markDirty();
      // flush quickly
      setTimeout(() => flushNow(), 50);
    }catch(e){
      console.warn(e);
      setStatus("Fond URL invalide");
    }
  });

  // flush on exit (best effort)
  window.addEventListener("beforeunload", () => {
    if(connected) flushNow();
  });

  return {
    markDirty,
    connect,
    disconnect,
    getRoom: () => roomId,
    sendPing: async (payload) => {
      if(!presenceChannel) return { error: "not_connected" };
      try{
        await presenceChannel.send({ type: "broadcast", event: "ping", payload });
        return { ok: true };
      }catch(e){
        return { error: String(e?.message || e) };
      }
    },
  };
}

export function initMapRealtimePlayer({
  onPing, // (payload) => void

  canvas,
  renderFn,
  setStateFromData,
  roomInput,
  connectBtn,
  statusEl,
  followCameraToggle,
  onlineEl,
  getIdentity,
}){
  const supabase = getSupabase();
  let roomId = "";
  let channel = null;

const presenceKey = stableId("battlemap_presence_key_player_v1");
let subscribed = false;

// Coalesce remote state updates (avoid jank / multiple renders in same tick)
let pendingState = null;
let rafApplyId = null;
let lastStatusTs = 0;

function scheduleApplyState(getFollowCamera){
  if(rafApplyId) return;
  rafApplyId = requestAnimationFrame(() => {
    rafApplyId = null;
    const st = pendingState;
    pendingState = null;
    if(!st) return;

    setStateFromData(st, { followCamera: getFollowCamera() });
    renderFn();

    const now = Date.now();
    if(now - lastStatusTs > 500){
      setStatus("Maj ✅");
      lastStatusTs = now;
    }
  });
}

function safeIdentity(){
  let name = "";
  let color = "";
  try{
    const id = (typeof getIdentity === "function") ? (getIdentity() || {}) : {};
    name = String(id?.name || id?.username || "").trim();
    color = String(id?.color || "").trim();
  }catch{}
  if(!name) name = `Player-${presenceKey.slice(-4).toUpperCase()}`;
  if(!color) color = "#999999";
  return { role: "player", name, color, ts: Date.now() };
}

function updateOnlineList(){
  if(!channel) return;
  try{
    const players = presencePlayersFromState(channel.presenceState());
    renderOnlinePlayers(onlineEl, players);
  }catch{}
}

async function trackIdentity(){
  if(!channel || !subscribed) return;
  try{ await channel.track(safeIdentity()); }catch{}
}


  function setStatus(t){ if(statusEl) statusEl.textContent = t; }

  function computeRoom(){
    const qs = new URLSearchParams(location.search);
    const q = (qs.get("room") || "").trim();
    return q || localStorage.getItem("battlemap_room") || "default";
  }

  function setRoom(newRoom){
    roomId = (newRoom || "").trim() || "default";
    localStorage.setItem("battlemap_room", roomId);
    if(roomInput) roomInput.value = roomId;

    const url = new URL(location.href);
    url.searchParams.set("room", roomId);
    history.replaceState(null, "", url.toString());
  }

  async function loadOnce(){
    const { data, error } = await supabase
      .from(BATTLEMAP_TABLE)
      .select("state, updated_at")
      .eq("room_id", roomId)
      .maybeSingle();

    if(error){
      console.warn(error);
      setStatus("Erreur lecture");
      return;
    }
    if(data?.state){
      setStateFromData(data.state, { followCamera: followCameraToggle?.checked ?? true });
      renderFn();
      setStatus("Connecté ✅");
    }else{
      setStatus("En attente du MJ…");
    }
  }

  function subscribe(){
    if(channel){
      try{ supabase.removeChannel(channel); }catch{}
      channel = null;
      subscribed = false;
      renderOnlinePlayers(onlineEl, []);
    }
    channel = supabase
      .channel(`battlemap:${roomId}`, { config: { presence: { key: presenceKey } } })

.on("presence", { event: "sync" }, () => updateOnlineList())
.on("presence", { event: "join" }, () => updateOnlineList())
.on("presence", { event: "leave" }, () => updateOnlineList())

      .on("postgres_changes",
        { event: "*", schema: "public", table: BATTLEMAP_TABLE, filter: `room_id=eq.${roomId}` },
        (payload) => {
          const st = payload?.new?.state;
          if(st){
            pendingState = st;
            scheduleApplyState(() => (followCameraToggle?.checked ?? true));
          }
        }
      )
      .on("broadcast", { event: "ping" }, (msg) => {
        try{ onPing && onPing(msg?.payload); }catch{}
      })

      .subscribe((status) => {
        if(status === "SUBSCRIBED"){
          subscribed = true;
          setStatus("Connecté ✅");
          trackIdentity();
          updateOnlineList();
        }else if(status === "CLOSED"){
          subscribed = false;
        }
      });
  }

  async function connect(){
    if(!isConfigured()){
      setStatus("Config Supabase manquante");
      return;
    }
    connectBtn && (connectBtn.textContent = "Connecté");
    setStatus("Connexion…");
    await loadOnce();
    subscribe();
  }

  // init
  setRoom(computeRoom());
  if(!isConfigured()){
    setStatus("non configuré");
  }else{
    setStatus("prêt");
  }

  connectBtn?.addEventListener("click", connect);
  roomInput?.addEventListener("change", connect);

  // auto connect
  connect();

  return {
    connect,
    getRoom: () => roomId,
    trackIdentity,
    sendPing: async (payload) => {
      if(!channel) return { error: "not_connected" };
      try{
        await channel.send({ type: "broadcast", event: "ping", payload });
        return { ok: true };
      }catch(e){
        return { error: String(e?.message || e) };
      }
    },
  };
}
