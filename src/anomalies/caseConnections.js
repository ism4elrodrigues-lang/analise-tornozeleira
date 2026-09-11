// Procura indícios de conexão entre dois casos carregados simultaneamente:
// pontos de geolocalização de cada um que estiveram próximos no tempo E no
// espaço (por padrão, até 200m de distância e 10 minutos de diferença),
// agrupados em episódios de "possível encontro".
import { haversineKm } from "../util/geo.js";

const DEFAULT_MAX_DISTANCE_M = 200;
const DEFAULT_MAX_TIME_GAP_MS = 10 * 60_000;
const MERGE_GAP_MS = 5 * 60_000; // pares próximos no tempo viram um único episódio

/**
 * @param {{id:string, label:string, records:Array}} caseA
 * @param {{id:string, label:string, records:Array}} caseB
 */
export function detectCaseConnections(caseA, caseB, opts = {}) {
  const maxDistanceM = opts.maxDistanceM ?? DEFAULT_MAX_DISTANCE_M;
  const maxTimeGapMs = opts.maxTimeGapMs ?? DEFAULT_MAX_TIME_GAP_MS;

  const geoA = caseA.records.filter((r) => r.hasGeo && r.createdAt);
  const geoB = caseB.records.filter((r) => r.hasGeo && r.createdAt);
  if (geoA.length === 0 || geoB.length === 0) return [];

  const pairs = [];
  for (const a of geoA) {
    const ta = a.createdAt.getTime();
    for (const b of geoB) {
      const tb = b.createdAt.getTime();
      if (Math.abs(ta - tb) > maxTimeGapMs) continue;
      const distanceM = haversineKm(a, b) * 1000;
      if (distanceM <= maxDistanceM) {
        pairs.push({ a, b, time: new Date((ta + tb) / 2), distanceM });
      }
    }
  }
  if (pairs.length === 0) return [];
  pairs.sort((x, y) => x.time.getTime() - y.time.getTime());

  const episodes = [];
  let current = null;
  for (const p of pairs) {
    if (current && p.time.getTime() - current.lastTime > MERGE_GAP_MS) {
      episodes.push(finalize(current, caseA, caseB));
      current = null;
    }
    if (!current) current = { pairs: [], lastTime: 0 };
    current.pairs.push(p);
    current.lastTime = p.time.getTime();
  }
  if (current) episodes.push(finalize(current, caseA, caseB));
  return episodes;
}

function finalize(ep, caseA, caseB) {
  const start = ep.pairs[0].time;
  const end = ep.pairs[ep.pairs.length - 1].time;
  let closest = ep.pairs[0];
  for (const p of ep.pairs) if (p.distanceM < closest.distanceM) closest = p;
  return {
    caseAId: caseA.id,
    caseALabel: caseA.label,
    caseBId: caseB.id,
    caseBLabel: caseB.label,
    start,
    end,
    minDistanceM: closest.distanceM,
    lat: closest.a.lat,
    lon: closest.a.lon,
    pairCount: ep.pairs.length,
  };
}

/** @param {Array<{id, label, records}>} visibleCases */
export function detectAllConnections(visibleCases, opts) {
  const results = [];
  for (let i = 0; i < visibleCases.length; i++) {
    for (let j = i + 1; j < visibleCases.length; j++) {
      results.push(...detectCaseConnections(visibleCases[i], visibleCases[j], opts));
    }
  }
  results.sort((a, b) => a.start.getTime() - b.start.getTime());
  return results;
}
