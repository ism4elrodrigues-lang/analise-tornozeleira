// Agrupa os pontos de geolocalização de um caso por proximidade para achar
// locais visitados repetidamente ("padrão de vida"): possível residência,
// possível local de trabalho, ou só um local frequente sem padrão claro de
// horário. É uma heurística (clustering incremental simples + proporção de
// pontos noturnos/diurnos), não uma identificação confirmada — por isso cada
// resultado pode ser anotado/confirmado manualmente pelo investigador.
import { haversineKm } from "../util/geo.js";

const DEFAULT_RADIUS_M = 100;
const DEFAULT_TOP_N = 6;
const DWELL_GAP_MS = 30 * 60_000;

export function detectFrequentPlaces(geoRecordsSorted, { radiusM = DEFAULT_RADIUS_M, topN = DEFAULT_TOP_N } = {}) {
  if (!geoRecordsSorted || geoRecordsSorted.length === 0) return [];

  const clusters = [];
  for (const r of geoRecordsSorted) {
    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const centroid = { lat: c.sumLat / c.count, lon: c.sumLon / c.count };
      const d = haversineKm(centroid, r) * 1000;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best && bestDist <= radiusM) {
      best.sumLat += r.lat;
      best.sumLon += r.lon;
      best.count += 1;
      best.points.push(r);
    } else {
      clusters.push({ sumLat: r.lat, sumLon: r.lon, count: 1, points: [r] });
    }
  }

  return clusters
    .map(summarize)
    .filter((p) => p.visitCount > 1 || p.totalDurationMin >= 15)
    .sort((a, b) => b.totalDurationMin - a.totalDurationMin)
    .slice(0, topN);
}

function summarize(cluster) {
  const points = [...cluster.points].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const lat = cluster.sumLat / cluster.count;
  const lon = cluster.sumLon / cluster.count;

  const visits = [];
  let current = null;
  for (const p of points) {
    if (current && p.createdAt.getTime() - current.lastTime > DWELL_GAP_MS) {
      visits.push(current);
      current = null;
    }
    if (!current) current = { start: p.createdAt, lastTime: 0, points: [] };
    current.lastTime = p.createdAt.getTime();
    current.points.push(p);
  }
  if (current) visits.push(current);

  let totalDurationMin = 0;
  const hourCounts = new Array(24).fill(0);
  const days = new Set();
  for (const v of visits) {
    const end = v.points[v.points.length - 1].createdAt;
    totalDurationMin += Math.max(1, (end.getTime() - v.start.getTime()) / 60_000);
    for (const p of v.points) {
      hourCounts[p.createdAt.getHours()]++;
      days.add(p.createdAt.toDateString());
    }
  }

  const totalCount = points.length;
  const nightCount = hourCounts.slice(0, 6).reduce((a, b) => a + b, 0) + hourCounts.slice(22).reduce((a, b) => a + b, 0);
  const businessCount = hourCounts.slice(8, 18).reduce((a, b) => a + b, 0);
  let label = "Local frequente";
  if (nightCount / totalCount > 0.5) label = "Possível residência (predomínio noturno)";
  else if (businessCount / totalCount > 0.6) label = "Possível trabalho/rotina diurna";

  const addressCounts = new Map();
  for (const p of points) {
    if (p.address) addressCounts.set(p.address, (addressCounts.get(p.address) || 0) + 1);
  }
  let address = null;
  let bestCount = 0;
  for (const [addr, n] of addressCounts) {
    if (n > bestCount) {
      bestCount = n;
      address = addr;
    }
  }

  return {
    lat,
    lon,
    label,
    address,
    totalDurationMin,
    visitCount: visits.length,
    daysCount: days.size,
    firstSeen: points[0].createdAt,
    lastSeen: points[points.length - 1].createdAt,
  };
}
