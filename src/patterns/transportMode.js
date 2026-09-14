// Estima o modo de deslocamento provável entre dois pontos consecutivos a
// partir da velocidade implícita (distância/tempo) — não é uma medição real
// de meio de transporte, é uma heurística por faixa de velocidade, sujeita a
// ruído de GPS (sobretudo entre pontos muito próximos no tempo/espaço) e a
// faixas que se sobrepõem na prática (ex.: carro parado no trânsito anda na
// velocidade de uma caminhada). Serve como indício a mais no relatório, a
// confirmar por outros meios.
import { haversineKm } from "../util/geo.js";

export const TRANSPORT_MODES = {
  PARADO: { key: "parado", label: "Parado", color: "#8d99a6" },
  PE: { key: "pe", label: "A pé", color: "#2e8b57" },
  BICICLETA: { key: "bicicleta", label: "Bicicleta", color: "#b8860b" },
  VEICULO: { key: "veiculo", label: "Carro/moto", color: "#1e3a5f" },
};

// Limites superiores de cada faixa, em km/h.
const THRESHOLDS_KMH = [
  { max: 1, mode: TRANSPORT_MODES.PARADO },
  { max: 7, mode: TRANSPORT_MODES.PE },
  { max: 25, mode: TRANSPORT_MODES.BICICLETA },
  { max: Infinity, mode: TRANSPORT_MODES.VEICULO },
];

export function classifySpeedKmh(speedKmh) {
  for (const t of THRESHOLDS_KMH) {
    if (speedKmh <= t.max) return t.mode;
  }
  return TRANSPORT_MODES.VEICULO;
}

/**
 * @param {Array} geoRecordsSorted registros com hasGeo=true, ordenados por createdAt.
 * @returns {Array<{from, to, distanceKm, hours, speedKmh, mode}>}
 */
export function computeTransportSegments(geoRecordsSorted) {
  const segments = [];
  for (let i = 1; i < geoRecordsSorted.length; i++) {
    const a = geoRecordsSorted[i - 1];
    const b = geoRecordsSorted[i];
    if (!a.createdAt || !b.createdAt) continue;
    const hours = (b.createdAt.getTime() - a.createdAt.getTime()) / 3_600_000;
    if (hours <= 0) continue;
    const distanceKm = haversineKm(a, b);
    const speedKmh = distanceKm / hours;
    segments.push({ from: a, to: b, distanceKm, hours, speedKmh, mode: classifySpeedKmh(speedKmh) });
  }
  return segments;
}

/** @returns {Array<{mode, distanceKm, hours}>} ordenado por distância decrescente. */
export function summarizeTransportSegments(segments) {
  const totals = new Map();
  for (const s of segments) {
    const cur = totals.get(s.mode.key) || { mode: s.mode, distanceKm: 0, hours: 0 };
    cur.distanceKm += s.distanceKm;
    cur.hours += s.hours;
    totals.set(s.mode.key, cur);
  }
  return Array.from(totals.values()).sort((a, b) => b.distanceKm - a.distanceKm);
}

/** @returns {Map<string, object>} id do registro de chegada -> modo do trecho que o precedeu. */
export function buildRecordModeIndex(segments) {
  const index = new Map();
  for (const s of segments) index.set(s.to.id, s.mode);
  return index;
}
