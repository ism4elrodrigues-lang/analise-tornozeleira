// Depende do global `window.jspdf.jsPDF`, carregado via lib/jspdf/jspdf.umd.min.js.
import { drawTileMosaic, makeProjector } from "../map/tileSnapshot.js";
import { formatDateTime } from "../util/format.js";

async function captureMapImage(mapView, geoRecords, anomalies) {
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
    ctx.fillStyle = "#4cafd9";
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  return canvas;
}

function metaLines(meta) {
  return [
    `Conta: ${meta.accountNumber || "-"}    CPF: ${meta.cpf || "-"}`,
    `Período analisado: ${meta.periodStart ? formatDateTime(meta.periodStart) : "-"} até ${
      meta.periodEnd ? formatDateTime(meta.periodEnd) : "-"
    }`,
    `Total de eventos: ${meta.totalEvents}    Eventos com geolocalização: ${meta.geoEvents}    Anomalias de deslocamento: ${meta.anomaliesCount}`,
  ];
}

export async function exportReportPdf({ mapView, geoRecords, anomalies, meta }) {
  if (typeof window.jspdf === "undefined") {
    throw new Error("Biblioteca jsPDF não carregada.");
  }
  const { jsPDF } = window.jspdf;
  const mapCanvas = await captureMapImage(mapView, geoRecords, anomalies);

  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  let y = margin;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("Relatório de Análise de Monitoramento Eletrônico", margin, y);
  y += 22;

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  for (const line of metaLines(meta)) {
    doc.text(line, margin, y);
    y += 14;
  }
  y += 8;

  const imgW = pageWidth - margin * 2;
  const imgH = (mapCanvas.height / mapCanvas.width) * imgW;
  doc.addImage(mapCanvas.toDataURL("image/png"), "PNG", margin, y, imgW, imgH);
  y += imgH + 16;

  if (anomalies.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      y = margin;
    }
    doc.setFont(undefined, "bold");
    doc.setFontSize(12);
    doc.text("Anomalias de deslocamento (velocidade implausível)", margin, y);
    y += 16;
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    for (const a of anomalies) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      const line = `${formatDateTime(a.from.createdAt)} -> ${formatDateTime(a.to.createdAt)}: ${a.distanceKm.toFixed(
        1
      )} km em ${a.hours.toFixed(2)} h (${a.speedKmh.toFixed(0)} km/h)`;
      doc.text(line, margin, y);
      y += 13;
    }
  }

  doc.save(`relatorio_analise_${Date.now()}.pdf`);
}

export async function exportReportImage({ mapView, geoRecords, anomalies, meta }) {
  const mapCanvas = await captureMapImage(mapView, geoRecords, anomalies);
  const headerH = 90;
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
  metaLines(meta).forEach((line, i) => ctx.fillText(line, 16, 50 + i * 16));

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
