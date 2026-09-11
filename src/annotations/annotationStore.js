// Guarda anotações (texto e/ou foto) em memória, associadas a um "alvo" —
// um evento, uma violação de zona, um possível encontro entre casos, um
// local frequente ou um ponto de interesse marcado manualmente — por uma
// chave estável, derivada dos dados (não do objeto recalculado a cada
// render), para sobreviver a refiltragens.
//
// Assim como o resto da extensão, isso fica só na memória da aba: fechar a
// aba perde as anotações (nenhum dado sai do navegador nem é salvo em disco).
const store = new Map();
let seq = 0;

export function buildRecordKey(recordId) {
  return `rec:${recordId}`;
}
export function buildViolationKey(caseId, startMs) {
  return `viol:${caseId}:${startMs}`;
}
export function buildConnectionKey(caseAId, caseBId, startMs) {
  const [a, b] = [caseAId, caseBId].sort();
  return `conn:${a}:${b}:${startMs}`;
}
export function buildPlaceKey(caseId, lat, lon) {
  return `place:${caseId}:${lat.toFixed(3)}:${lon.toFixed(3)}`;
}
export function buildPoiKey(poiId) {
  return `poi:${poiId}`;
}

export function getAnnotation(key) {
  return store.get(key) || null;
}

export function hasAnnotation(key) {
  return store.has(key);
}

/**
 * Cria/atualiza uma anotação. Se texto e foto ficarem vazios, remove.
 * @returns a anotação salva, ou null se removida.
 */
export function setAnnotation(key, { caseId, targetType, targetLabel, time, text, photoDataUrl }) {
  const existing = store.get(key);
  const trimmedText = (text || "").trim();
  if (!trimmedText && !photoDataUrl) {
    store.delete(key);
    return null;
  }
  const ann = {
    id: existing?.id || `ann${seq++}`,
    key,
    caseId: caseId ?? existing?.caseId ?? null,
    targetType: targetType || existing?.targetType || "unknown",
    targetLabel: targetLabel ?? existing?.targetLabel ?? "",
    time: time ?? existing?.time ?? null,
    text: trimmedText,
    photoDataUrl: photoDataUrl ?? null,
    createdAt: existing?.createdAt || new Date(),
    updatedAt: new Date(),
  };
  store.set(key, ann);
  return ann;
}

export function deleteAnnotation(key) {
  store.delete(key);
}

export function listAnnotations() {
  return Array.from(store.values()).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export function listAnnotationsForCase(caseId) {
  return listAnnotations().filter((a) => a.caseId === caseId);
}
