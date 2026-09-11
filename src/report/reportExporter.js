// Depende do global `window.jspdf.jsPDF`, carregado via lib/jspdf/jspdf.umd.min.js.
import { drawTileMosaic, makeProjector } from "../map/tileSnapshot.js";
import { formatDateTime } from "../util/format.js";

async function captureMapImage(mapView, geoRecords, anomalies, zone) {
  const leafletMap = mapView.getLeafletMap();
  const size = leafletMap.getSize();
  const zoom = leafletMap.getZoom();
  const pixelBounds = leafletMap.getPixelBounds();

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size.x));
  canvas.height = Math.max(1, Math.round(size.y));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e8ecf1";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await drawTileMosaic(ctx, zoom, pixelBounds);

  const project = makeProjector(leafletMap, zoom, pixelBounds);

  if (zone && zone.lat != null && zone.lon != null && zone.radiusM) {
    // raio em metros -> pixels na latitude do centro da zona (aprox. válida em raios pequenos)
    const metersPerPixel =
      (156543.03392 * Math.cos((zone.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    const radiusPx = zone.radiusM / metersPerPixel;
    const center = project(zone.lat, zone.lon);
    ctx.strokeStyle = "#d9534f";
    ctx.fillStyle = "rgba(217,83,79,0.08)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPx, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (geoRecords.length > 0) {
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    geoRecords.forEach((r, i) => {
      const p = project(r.lat, r.lon);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }

  ctx.strokeStyle = "#d9534f";
  ctx.lineWidth = 4;
  ctx.setLineDash([8, 6]);
  for (const a of anomalies) {
    const p1 = project(a.from.lat, a.from.lon);
    const p2 = project(a.to.lat, a.to.lon);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  for (const r of geoRecords) {
    const p = project(r.lat, r.lon);
    const violation = !!r.isViolation;
    ctx.fillStyle = violation ? "#d9534f" : "#4cafd9";
    ctx.strokeStyle = violation ? "#a83431" : "#1e3a5f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, violation ? 5 : 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  return canvas;
}

function caseLines(caseMeta, meta) {
  if (caseMeta && (caseMeta.name || caseMeta.cpf)) {
    const lines = [
      `Monitorado: ${caseMeta.name || "-"}    CPF: ${caseMeta.cpf || "-"}    ID: ${caseMeta.monitoredId || "-"}`,
    ];
    if (caseMeta.legal?.processNumber) lines.push(`Processo judicial: ${caseMeta.legal.processNumber}`);
    if (caseMeta.zone?.address) {
      lines.push(
        `Zona de exclusão: ${caseMeta.zone.address} (raio ${caseMeta.zone.radiusM ? caseMeta.zone.radiusM.toFixed(0) : "-"} m)`
      );
    }
    return lines;
  }
  return [`Conta: ${meta.accountNumber || "-"}    CPF: ${meta.cpf || "-"}`];
}

function summaryLine(meta, zoneEpisodes) {
  const period = `Período analisado: ${meta.periodStart ? formatDateTime(meta.periodStart) : "-"} até ${
    meta.periodEnd ? formatDateTime(meta.periodEnd) : "-"
  }`;
  const counts = zoneEpisodesGiven(zoneEpisodes)
    ? `Total de eventos: ${meta.totalEvents}    Com geolocalização: ${meta.geoEvents}    Violações de zona: ${zoneEpisodes.length}`
    : `Total de eventos: ${meta.totalEvents}    Com geolocalização: ${meta.geoEvents}    Anomalias de velocidade: ${meta.anomaliesCount}`;
  return [period, counts];
}

function zoneEpisodesGiven(zoneEpisodes) {
  return Array.isArray(zoneEpisodes);
}

function episodeLine(ep) {
  const durationTxt = ep.durationMin < 1 ? "menos de 1 min" : `${Math.round(ep.durationMin)} min`;
  const distTxt = ep.minDistanceM != null ? `, mín. ${ep.minDistanceM.toFixed(0)} m da referência` : "";
  const addrTxt = ep.addresses.length > 0 ? ` — ${ep.addresses[0]}` : "";
  return `${formatDateTime(ep.start)} -> ${formatDateTime(ep.end)} (${durationTxt}${distTxt})${addrTxt}`;
}

function anomalyLine(a) {
  return `${formatDateTime(a.from.createdAt)} -> ${formatDateTime(a.to.createdAt)}: ${a.distanceKm.toFixed(
    1
  )} km em ${a.hours.toFixed(2)} h (${a.speedKmh.toFixed(0)} km/h)`;
}

export async function exportReportPdf({ mapView, geoRecords, anomalies, zoneEpisodes, caseMeta, meta }) {
  if (typeof window.jspdf === "undefined") {
    throw new Error("Biblioteca jsPDF não carregada.");
  }
  const { jsPDF } = window.jspdf;
  const hasZone = zoneEpisodesGiven(zoneEpisodes) && caseMeta?.zone?.lat != null;
  const mapCanvas = await captureMapImage(mapView, geoRecords, anomalies, hasZone ? caseMeta.zone : null);

  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;
  let y = margin;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Relatório de Análise de Monitoramento Eletrônico", margin, y);
  y += 22;

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  for (const line of [...caseLines(caseMeta, meta), ...summaryLine(meta, hasZone ? zoneEpisodes : null)]) {
    doc.text(line, margin, y);
    y += 14;
  }
  y += 8;

  const imgW = pageWidth - margin * 2;
  const imgH = (mapCanvas.height / mapCanvas.width) * imgW;
  doc.addImage(mapCanvas.toDataURL("image/png"), "PNG", margin, y, imgW, imgH);
  y += imgH + 16;

  const addSection = (title, lines) => {
    if (lines.length === 0) return;
    if (y > pageHeight - 100) {
      doc.addPage();
      y = margin;
    }
    doc.setFont(undefined, "bold");
    doc.setFontSize(12);
    doc.text(title, margin, y);
    y += 16;
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 13;
    }
    y += 8;
  };

  if (hasZone) {
    addSection(
      "Violações da zona de exclusão",
      zoneEpisodes.length > 0 ? zoneEpisodes.map(episodeLine) : ["Nenhuma violação no período analisado."]
    );
  }
  addSection("Anomalias de deslocamento (velocidade implausível)", anomalies.map(anomalyLine));

  doc.save(`relatorio_analise_${Date.now()}.pdf`);
}

export async function exportReportImage({ mapView, geoRecords, anomalies, zoneEpisodes, caseMeta, meta }) {
  const hasZone = zoneEpisodesGiven(zoneEpisodes) && caseMeta?.zone?.lat != null;
  const mapCanvas = await captureMapImage(mapView, geoRecords, anomalies, hasZone ? caseMeta.zone : null);

  const headerLines = [...caseLines(caseMeta, meta), ...summaryLine(meta, hasZone ? zoneEpisodes : null)];
  const episodeLines = hasZone && zoneEpisodes.length > 0 ? zoneEpisodes.slice(0, 6).map(episodeLine) : [];
  const headerH = 40 + (headerLines.length + episodeLines.length) * 16 + (episodeLines.length > 0 ? 10 : 0);

  const canvas = document.createElement("canvas");
  canvas.width = mapCanvas.width;
  canvas.height = headerH + mapCanvas.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.fillText("Relatório de Análise de Monitoramento Eletrônico", 16, 28);
  ctx.font = "12px system-ui, sans-serif";
  let ty = 50;
  for (const line of headerLines) {
    ctx.fillText(line, 16, ty);
    ty += 16;
  }
  if (episodeLines.length > 0) {
    ty += 6;
    ctx.font = "bold 12px system-ui, sans-serif";
    ctx.fillStyle = "#d9534f";
    ctx.fillText("Violações da zona de exclusão:", 16, ty);
    ty += 16;
    ctx.font = "11px system-ui, sans-serif";
    for (const line of episodeLines) {
      ctx.fillText(line, 16, ty);
      ty += 16;
    }
  }

  ctx.drawImage(mapCanvas, 0, headerH);

  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio_analise_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, "image/png");
}
