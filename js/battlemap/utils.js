export function clamp(v, min, max){
  return Math.max(min, Math.min(max, v));
}

export function snapHalf(n){
  return Math.round(n * 2) / 2;
}

export function downloadText(filename, text){
  const blob = new Blob([text], {type: "application/json;charset=utf-8"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function safeParseJSON(text){
  try{
    return { ok: true, value: JSON.parse(text) };
  }catch(e){
    return { ok: false, error: e };
  }
}
