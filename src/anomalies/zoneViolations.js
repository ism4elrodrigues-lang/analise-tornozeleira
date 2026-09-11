// Agrupa registros consecutivos marcados como violação (campo isViolation,
// vindo do status "Violação" já calculado pelo próprio sistema de
// monitoramento) em episódios com início, fim, duração e distância mínima
// até o ponto de referência da zona de exclusão — mesma ideia da síntese que
// alguns relatórios já trazem prontos, mas calculada de forma genérica a
// partir do rastro, então funciona para qualquer período/filtro selecionado.
const MAX_GAP_MS = 3 * 60_000; // uma falha isolada de sinal não quebra o episódio

export function detectZoneViolationEpisodes(recordsSorted) {
  const episodes = [];
  let current = null;

  for (const r of recordsSorted) {
    if (!r.createdAt) continue;
    if (r.isViolation) {
      if (current && r.createdAt.getTime() - current.lastTime > MAX_GAP_MS) {
        episodes.push(finalize(current));
        current = null;
      }
      if (!current) {
        current = { records: [], lastTime: 0 };
      }
      current.records.push(r);
      current.lastTime = r.createdAt.getTime();
    } else if (current) {
      episodes.push(finalize(current));
      current = null;
    }
  }
  if (current) episodes.push(finalize(current));
  return episodes;
}

function finalize(ep) {
  const records = ep.records;
  const start = records[0].createdAt;
  const end = records[records.length - 1].createdAt;
  const distances = records.map((r) => r.distanceToZoneM).filter((d) => d != null);
  const addresses = [...new Set(records.map((r) => r.address).filter(Boolean))];
  return {
    start,
    end,
    durationMin: (end.getTime() - start.getTime()) / 60_000,
    minDistanceM: distances.length > 0 ? Math.min(...distances) : null,
    addresses,
    records,
  };
}
