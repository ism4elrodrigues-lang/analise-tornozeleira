// Monta um texto cronológico a partir do que já foi calculado para o caso
// (violações de zona, anomalias de velocidade, possíveis encontros com
// outros casos) mais as anotações do investigador — pronto para colar num
// relatório ou despacho. Não substitui a leitura dos dados brutos, é um
// rascunho a revisar.
import { formatDateTime } from "../util/format.js";
import { summarizeTransportSegments } from "../patterns/transportMode.js";

/**
 * @param {object} caseObj caso ativo (com filteredRecords/zoneEpisodes/speedAnomalies já calculados)
 * @param {Array} connectionsForCase encontros que envolvem este caso
 * @param {Array} notesForCase anotações {time, text, targetLabel} deste caso
 */
export function buildNarrative(caseObj, connectionsForCase = [], notesForCase = []) {
  const label = caseObj.caseMeta?.name || caseObj.fileName;
  const records = caseObj.filteredRecords || [];
  const lines = [];

  lines.push(`NARRATIVA — ${label}`);
  const first = records[0]?.createdAt;
  const last = records[records.length - 1]?.createdAt;
  if (first && last) {
    lines.push(`Período analisado: ${formatDateTime(first)} até ${formatDateTime(last)}.`);
  }
  lines.push(`Total de eventos: ${records.length}. Com geolocalização: ${caseObj.geoRecords?.length ?? 0}.`);

  const transportTotals = summarizeTransportSegments(caseObj.transportSegments || []);
  if (transportTotals.length > 0) {
    const parts = transportTotals.map((t) => `${t.mode.label.toLowerCase()}: ${t.distanceKm.toFixed(1)} km`);
    lines.push(`Modo de deslocamento estimado (por velocidade, indício não confirmado): ${parts.join(", ")}.`);
  }
  lines.push("");

  const events = [];

  for (const ep of caseObj.zoneEpisodes || []) {
    const durationTxt = ep.durationMin < 1 ? "menos de 1 min" : `${Math.round(ep.durationMin)} min`;
    const distTxt = ep.minDistanceM != null ? `, mín. ${ep.minDistanceM.toFixed(0)} m da referência` : "";
    const addrTxt = ep.addresses?.[0] ? `, em ${ep.addresses[0]}` : "";
    events.push({
      time: ep.start,
      text: `Violação da zona de exclusão das ${formatDateTime(ep.start)} às ${formatDateTime(
        ep.end
      )} (${durationTxt}${distTxt}${addrTxt}).`,
    });
  }

  for (const a of caseObj.speedAnomalies || []) {
    events.push({
      time: a.from.createdAt,
      text: `Deslocamento com velocidade implausível entre ${formatDateTime(a.from.createdAt)} e ${formatDateTime(
        a.to.createdAt
      )} (${a.distanceKm.toFixed(1)} km em ${a.hours.toFixed(2)} h, ${a.speedKmh.toFixed(0)} km/h).`,
    });
  }

  for (const conn of connectionsForCase) {
    const other = conn.caseAId === caseObj.id ? conn.caseBLabel : conn.caseALabel;
    events.push({
      time: conn.start,
      text: `Possível encontro com "${other}" entre ${formatDateTime(conn.start)} e ${formatDateTime(
        conn.end
      )} (mín. ${conn.minDistanceM.toFixed(0)} m de distância) — verificar.`,
    });
  }

  for (const note of notesForCase) {
    events.push({
      time: note.time,
      text: `[Nota do investigador${note.targetLabel ? ` — ${note.targetLabel}` : ""}] ${note.text}`,
    });
  }

  events.sort((a, b) => (a.time?.getTime() || 0) - (b.time?.getTime() || 0));

  if (events.length === 0) {
    lines.push("Nenhum evento notável (violação, anomalia, encontro ou anotação) no intervalo selecionado.");
  } else {
    for (const e of events) {
      lines.push(`• ${e.time ? `${formatDateTime(e.time)} — ` : ""}${e.text}`);
    }
  }

  return lines.join("\n");
}
