import { parseCsvFile } from "../src/parsers/csvParser.js";
import { parsePdfFile } from "../src/parsers/pdfParser.js";
import { parseXlsxFile } from "../src/parsers/xlsxParser.js";
import { sortRecordsByDate } from "../src/parsers/normalize.js";
import { MapView } from "../src/map/mapView.js";
import { TimelineView } from "../src/timeline/timelineView.js";
import { PlaybackController } from "../src/playback/playbackController.js";
import { detectSpeedAnomalies } from "../src/anomalies/anomalyDetector.js";
import { detectZoneViolationEpisodes } from "../src/anomalies/zoneViolations.js";
import { exportVideo } from "../src/report/videoExporter.js";
import { exportReportPdf, exportReportImage } from "../src/report/reportExporter.js";
import { lookupIp } from "../src/ipgeo/ipGeolocation.js";
import { formatDateTime, toDatetimeLocalValue, parseDatetimeLocal } from "../src/util/format.js";

const el = (id) => document.getElementById(id);

const fileInput = el("file-input");
const fileStatus = el("file-status");
const warningsBox = el("warnings");
const caseHeader = el("case-header");
const caseName = el("case-name");
const caseSubtitle = el("case-subtitle");
const caseZone = el("case-zone");
const caseLegal = el("case-legal");
const filterStart = el("filter-start");
const filterEnd = el("filter-end");
const applyFilterBtn = el("apply-filter");
const clearFilterBtn = el("clear-filter");
const statsBox = el("stats");
const playBtn = el("play-btn");
const pauseBtn = el("pause-btn");
const scrubber = el("scrubber");
const playbackTimeLabel = el("playback-time");
const speedSelect = el("speed-select");
const exportVideoBtn = el("export-video-btn");
const videoProgress = el("video-progress");
const exportPdfBtn = el("export-pdf-btn");
const exportImageBtn = el("export-image-btn");
const zoneViolationsBlock = el("zone-violations-block");
const zoneViolationsList = el("zone-violations-list");
const anomaliesList = el("anomalies-list");
const recordsCount = el("records-count");
const recordsTbody = el("records-tbody");

const mapView = new MapView("map");
const timelineView = new TimelineView(el("timeline"));
const playback = new PlaybackController();

let allRecords = [];
let filteredRecords = [];
let geoRecords = [];
let speedAnomalies = [];
let zoneEpisodes = [];
let caseMeta = null;
let scrubbing = false;

function setControlsEnabled(enabled) {
  applyFilterBtn.disabled = !enabled;
  clearFilterBtn.disabled = !enabled;
  exportPdfBtn.disabled = !enabled;
  exportImageBtn.disabled = !enabled;
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  fileStatus.textContent = `Lendo "${file.name}"...`;
  warningsBox.hidden = true;
  caseMeta = null;
  try {
    const ext = file.name.split(".").pop().toLowerCase();
    let result;
    if (ext === "csv" || file.type === "text/csv") {
      result = await parseCsvFile(file);
    } else if (ext === "xlsx" || file.type.includes("spreadsheetml")) {
      result = await parseXlsxFile(file);
      caseMeta = result.meta;
    } else if (ext === "pdf" || file.type === "application/pdf") {
      result = await parsePdfFile(file);
    } else {
      throw new Error("Formato não reconhecido. Use um arquivo .csv, .xlsx ou .pdf.");
    }

    allRecords = result.records;
    fileStatus.textContent = `${file.name} — ${allRecords.length} eventos carregados.`;

    if (result.warnings && result.warnings.length > 0) {
      warningsBox.hidden = false;
      warningsBox.textContent = result.warnings.join(" ");
    }

    renderCaseHeader();

    if (allRecords.length === 0) {
      setControlsEnabled(false);
      return;
    }

    const first = allRecords[0].createdAt;
    const last = allRecords[allRecords.length - 1].createdAt;
    if (first) filterStart.value = toDatetimeLocalValue(first);
    if (last) filterEnd.value = toDatetimeLocalValue(last);

    setControlsEnabled(true);
    applyFilter();
  } catch (err) {
    console.error(err);
    fileStatus.textContent = "";
    warningsBox.hidden = false;
    warningsBox.textContent = `Erro ao processar arquivo: ${err.message}`;
    setControlsEnabled(false);
  }
});

applyFilterBtn.addEventListener("click", applyFilter);
clearFilterBtn.addEventListener("click", () => {
  if (allRecords.length === 0) return;
  const first = allRecords[0].createdAt;
  const last = allRecords[allRecords.length - 1].createdAt;
  if (first) filterStart.value = toDatetimeLocalValue(first);
  if (last) filterEnd.value = toDatetimeLocalValue(last);
  applyFilter();
});

function applyFilter() {
  if (allRecords.length === 0) return;
  // O fim do intervalo é tratado como inclusive até o fim do minuto escolhido
  // (o <input type="datetime-local"> só tem granularidade de minuto).
  const startDate = parseDatetimeLocal(filterStart.value);
  const endDate = parseDatetimeLocal(filterEnd.value);
  const startMs = startDate ? startDate.getTime() : -Infinity;
  const endMs = endDate ? endDate.getTime() + 59_999 : Infinity;
  filteredRecords = allRecords.filter((r) => {
    if (!r.createdAt) return false;
    const t = r.createdAt.getTime();
    return t >= startMs && t <= endMs;
  });
  render();
}

function renderCaseHeader() {
  if (!caseMeta || (!caseMeta.name && !caseMeta.zone?.lat)) {
    caseHeader.hidden = true;
    return;
  }
  caseHeader.hidden = false;
  caseName.textContent = caseMeta.name || "Monitorado não identificado";
  caseSubtitle.textContent = [
    caseMeta.monitoredId ? `ID ${caseMeta.monitoredId}` : null,
    caseMeta.cpf ? `CPF ${caseMeta.cpf}` : null,
    caseMeta.equipment,
  ]
    .filter(Boolean)
    .join(" · ");

  const zone = caseMeta.zone || {};
  caseZone.innerHTML = "";
  if (zone.address) {
    caseZone.appendChild(labelLine("Zona de exclusão", zone.address));
    caseZone.appendChild(
      labelLine(
        "Raio de restrição",
        zone.radiusM ? `${zone.radiusM.toFixed(0)} m${zone.type ? ` — ${zone.type}` : ""}` : "-"
      )
    );
  }

  const legal = caseMeta.legal || {};
  caseLegal.innerHTML = "";
  if (legal.processNumber) caseLegal.appendChild(labelLine("Processo", legal.processNumber));
  if (legal.issuedAt) caseLegal.appendChild(labelLine("Relatório emitido em", legal.issuedAt));
}

function labelLine(label, value) {
  const div = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  div.appendChild(strong);
  div.appendChild(document.createTextNode(value));
  return div;
}

function render() {
  geoRecords = sortRecordsByDate(filteredRecords.filter((r) => r.hasGeo));
  speedAnomalies = detectSpeedAnomalies(geoRecords);

  const hasZone = !!(caseMeta && caseMeta.zone && caseMeta.zone.lat != null && caseMeta.zone.lon != null);
  zoneEpisodes = hasZone ? detectZoneViolationEpisodes(sortRecordsByDate(filteredRecords.filter((r) => r.createdAt))) : [];

  mapView.setRecords(geoRecords, onRecordSelect);
  mapView.setAnomalies(speedAnomalies);
  mapView.setExclusionZone(hasZone ? caseMeta.zone : null);

  timelineView.setRecords(filteredRecords);
  const highlightIds = new Set();
  for (const a of speedAnomalies) {
    highlightIds.add(a.from.id);
    highlightIds.add(a.to.id);
  }
  for (const ep of zoneEpisodes) {
    for (const r of ep.records) highlightIds.add(r.id);
  }
  timelineView.setHighlightedIds(highlightIds);
  timelineView.onPick = onRecordSelect;

  playback.setRecords(geoRecords);
  updatePlaybackControls();

  renderStats(hasZone);
  zoneViolationsBlock.hidden = !hasZone;
  if (hasZone) renderZoneViolations();
  renderSpeedAnomalies();
  renderTable();
}

function renderStats(hasZone) {
  const first = filteredRecords[0]?.createdAt;
  const last = filteredRecords[filteredRecords.length - 1]?.createdAt;
  const chips = [
    `${filteredRecords.length} eventos`,
    `${geoRecords.length} com geolocalização`,
    hasZone ? `${zoneEpisodes.length} violações de zona` : `${speedAnomalies.length} anomalias de velocidade`,
    first && last ? `${formatDateTime(first)} — ${formatDateTime(last)}` : "",
  ].filter(Boolean);
  statsBox.innerHTML = "";
  for (const c of chips) {
    const span = document.createElement("span");
    span.className = "stat-chip";
    span.textContent = c;
    statsBox.appendChild(span);
  }
}

function renderZoneViolations() {
  zoneViolationsList.innerHTML = "";
  if (zoneEpisodes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma violação da zona de exclusão no intervalo selecionado.";
    zoneViolationsList.appendChild(li);
    return;
  }
  for (const ep of zoneEpisodes) {
    const li = document.createElement("li");
    const durationTxt = ep.durationMin < 1 ? "menos de 1 min" : `${Math.round(ep.durationMin)} min`;
    const distTxt = ep.minDistanceM != null ? ` — mín. ${ep.minDistanceM.toFixed(0)} m da referência` : "";
    const addrTxt = ep.addresses.length > 0 ? ` (${ep.addresses[0]})` : "";
    li.textContent = `${formatDateTime(ep.start)} → ${formatDateTime(ep.end)} (${durationTxt})${distTxt}${addrTxt}`;
    li.addEventListener("click", () => onRecordSelect(ep.records[0]));
    zoneViolationsList.appendChild(li);
  }
}

function renderSpeedAnomalies() {
  anomaliesList.innerHTML = "";
  if (speedAnomalies.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma anomalia de velocidade detectada no intervalo selecionado.";
    anomaliesList.appendChild(li);
    return;
  }
  for (const a of speedAnomalies) {
    const li = document.createElement("li");
    li.textContent = `${formatDateTime(a.from.createdAt)} → ${formatDateTime(a.to.createdAt)}: ${a.distanceKm.toFixed(
      1
    )} km em ${a.hours.toFixed(2)} h (${a.speedKmh.toFixed(0)} km/h)`;
    li.addEventListener("click", () => onRecordSelect(a.to));
    anomaliesList.appendChild(li);
  }
}

function renderTable() {
  recordsCount.textContent = String(filteredRecords.length);
  const highlightIds = new Set();
  for (const a of speedAnomalies) {
    highlightIds.add(a.from.id);
    highlightIds.add(a.to.id);
  }
  for (const ep of zoneEpisodes) for (const r of ep.records) highlightIds.add(r.id);

  const frag = document.createDocumentFragment();
  for (const r of filteredRecords) {
    const tr = document.createElement("tr");
    if (r.hasGeo) tr.classList.add("has-geo");
    if (r.isViolation || highlightIds.has(r.id)) tr.classList.add("anomaly-row");

    tr.appendChild(td(formatDateTime(r.createdAt)));
    tr.appendChild(td(r.status || r.action || "-"));
    tr.appendChild(td(detailsText(r)));
    tr.appendChild(td(r.lat != null ? r.lat.toFixed(6) : "-"));
    tr.appendChild(td(r.lon != null ? r.lon.toFixed(6) : "-"));

    const actionTd = document.createElement("td");
    if (!r.hasGeo && r.ip) {
      const btn = document.createElement("button");
      btn.className = "ip-geo-btn";
      btn.textContent = "Buscar geo por IP";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Buscando...";
        try {
          const geo = await lookupIp(r.ip);
          r.lat = geo.lat;
          r.lon = geo.lon;
          r.hasGeo = true;
          r.geoFromIp = true;
          render();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Buscar geo por IP";
          alert(`Não foi possível localizar o IP ${r.ip}: ${err.message}`);
        }
      });
      actionTd.appendChild(btn);
    }
    tr.appendChild(actionTd);
    frag.appendChild(tr);
  }
  recordsTbody.innerHTML = "";
  recordsTbody.appendChild(frag);
}

function detailsText(r) {
  const parts = [];
  if (r.address) parts.push(r.address);
  if (r.deviceModel) parts.push(r.deviceModel);
  if (r.ip) parts.push(`IP ${r.ip}`);
  if (r.distanceToZoneM != null) parts.push(`${r.distanceToZoneM.toFixed(0)} m da zona`);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

function td(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

function onRecordSelect(record) {
  if (record.hasGeo) {
    mapView.setCursor([record.lat, record.lon]);
    mapView.getLeafletMap().panTo([record.lat, record.lon]);
  }
  timelineView.setCursorTime(record.createdAt);
}

// --- Playback ---

function updatePlaybackControls() {
  const enabled = playback.hasAnimation;
  playBtn.disabled = !enabled;
  pauseBtn.disabled = !enabled;
  scrubber.disabled = !enabled;
  exportVideoBtn.disabled = geoRecords.length === 0;
  scrubber.value = 0;
  playbackTimeLabel.textContent = geoRecords.length > 0 ? formatDateTime(geoRecords[0].createdAt) : "-";
}

playback.onFrame = (frame) => {
  if (!frame) return;
  mapView.setCursor([frame.lat, frame.lon]);
  timelineView.setCursorTime(frame.time);
  playbackTimeLabel.textContent = formatDateTime(frame.time);
  if (!scrubbing) scrubber.value = String(Math.round(playback.fraction * 1000));
};

playBtn.addEventListener("click", () => playback.play());
pauseBtn.addEventListener("click", () => playback.pause());
speedSelect.addEventListener("change", () => playback.setSpeed(parseFloat(speedSelect.value)));

scrubber.addEventListener("input", () => {
  scrubbing = true;
  playback.pause();
  playback.seekFraction(parseInt(scrubber.value, 10) / 1000);
});
scrubber.addEventListener("change", () => {
  scrubbing = false;
});

// --- Exportação ---

exportVideoBtn.addEventListener("click", async () => {
  exportVideoBtn.disabled = true;
  videoProgress.textContent = "Gravando 0%...";
  try {
    const hasZone = !!(caseMeta && caseMeta.zone && caseMeta.zone.lat != null && caseMeta.zone.lon != null);
    await exportVideo({
      mapView,
      playback,
      zone: hasZone ? caseMeta.zone : null,
      onProgress: (f) => {
        videoProgress.textContent = `Gravando ${Math.round(f * 100)}%...`;
      },
    });
    videoProgress.textContent = "Vídeo gerado com sucesso.";
  } catch (err) {
    console.error(err);
    videoProgress.textContent = "";
    alert(`Falha ao gerar vídeo: ${err.message}`);
  } finally {
    exportVideoBtn.disabled = geoRecords.length === 0;
    setTimeout(() => (videoProgress.textContent = ""), 4000);
  }
});

exportPdfBtn.addEventListener("click", async () => {
  exportPdfBtn.disabled = true;
  try {
    await exportReportPdf({
      mapView,
      geoRecords,
      anomalies: speedAnomalies,
      zoneEpisodes,
      caseMeta,
      meta: buildMeta(),
    });
  } catch (err) {
    console.error(err);
    alert(`Falha ao gerar relatório PDF: ${err.message}`);
  } finally {
    exportPdfBtn.disabled = false;
  }
});

exportImageBtn.addEventListener("click", async () => {
  exportImageBtn.disabled = true;
  try {
    await exportReportImage({
      mapView,
      geoRecords,
      anomalies: speedAnomalies,
      zoneEpisodes,
      caseMeta,
      meta: buildMeta(),
    });
  } catch (err) {
    console.error(err);
    alert(`Falha ao gerar relatório em imagem: ${err.message}`);
  } finally {
    exportImageBtn.disabled = false;
  }
});

function buildMeta() {
  const first = filteredRecords[0];
  return {
    accountNumber: first?.accountNumber,
    cpf: first?.cpf,
    periodStart: filteredRecords[0]?.createdAt,
    periodEnd: filteredRecords[filteredRecords.length - 1]?.createdAt,
    totalEvents: filteredRecords.length,
    geoEvents: geoRecords.length,
    anomaliesCount: speedAnomalies.length,
  };
}

window.addEventListener("resize", () => mapView.invalidateSize());
