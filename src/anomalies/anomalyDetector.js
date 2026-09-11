import { haversineKm } from "../util/geo.js";

// Acima disso consideramos o deslocamento fisicamente implausível para um
// trajeto terrestre comum (carro/avião comercial em trecho curto) e sinalizamos
// como possível indício de burla/falha do dispositivo.
export const DEFAULT_SPEED_THRESHOLD_KMH = 250;

/**
 * @param {Array} geoRecordsSorted registros com hasGeo=true, já ordenados por createdAt.
 * @param {number} thresholdKmh
 * @returns {Array<{from, to, distanceKm, hours, speedKmh}>}
 */
export function detectSpeedAnomalies(geoRecordsSorted, thresholdKmh = DEFAULT_SPEED_THRESHOLD_KMH) {
  const anomalies = [];
  for (let i = 1; i < geoRecordsSorted.length; i++) {
    const prev = geoRecordsSorted[i - 1];
    const curr = geoRecordsSorted[i];
    if (!prev.createdAt || !curr.createdAt) continue;
    const hours = (curr.createdAt.getTime() - prev.createdAt.getTime()) / 3_600_000;
    if (hours <= 0) continue;
    const distanceKm = haversineKm(prev, curr);
    const speedKmh = distanceKm / hours;
    if (speedKmh > thresholdKmh) {
      anomalies.push({ from: prev, to: curr, distanceKm, hours, speedKmh });
    }
  }
  return anomalies;
}
