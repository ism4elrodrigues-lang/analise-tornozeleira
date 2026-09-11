import { parseCsvFile } from "../src/parsers/csvParser.js";
import { parsePdfFile } from "../src/parsers/pdfParser.js";
import { parseXlsxFile } from "../src/parsers/xlsxParser.js";
import { sortRecordsByDate } from "../src/parsers/normalize.js";
import { MapView } from "../src/map/mapView.js";
import { TimelineView } from "../src/timeline/timelineView.js";
import { PlaybackController } from "../src/playback/playbackController.js";
import { detectSpeedAnomalies } from "../src/anomalies/anomalyDetector.js";
import { detectZoneViolationEpisodes } from "../src/anomalies/zoneViolations.js";
import { detectAllConnections } from "../src/anomalies/caseConnections.js";
import { exportVideo } from "../src/report/videoExporter.js";
import { exportReportPdf, exportReportImage } from "../src/report/reportExporter.js";
import { lookupIp } from "../src/ipgeo/ipGeolocation.js";
import { formatDateTime, toDatetimeLocalValue, parseDatetimeLocal } from "../src/util/format.js";

const CASE_COLORS = ["#1e3a5f", "#2e8b57", "#b8860b", "#6a5acd", "#c2185b", "#00838f", "#8d6e63", "#5d4037"];

const el = (id) => document.getElementById(id);

const fileInput = el("file-input");
const fileStatus = el("file-status");
const warningsBox = el("warnings");
const casesSection = el("cases-section");
const casesList = el("cases-list");
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
const connectionsSection = el("connections-section");
const connectionsList = el("connections-list");
const zoneViolationsBlock = el("zone-violations-block");
const zoneViolationsList = el("zone-violations-list");
const anomaliesList = el("anomalies-list");
const recordsCount = el("records-count");
const recordsTbody = el("records-tbody");

const mapView = new MapView("map");
const timelineView = new TimelineView(el("timeline"));
const playback = new PlaybackController();

let cases = [];
let activeCaseId = null;
let caseSeq = 0;
let colorSeq = 0;
let scrubbing = false;

function caseLabel(c) {
  return c.caseMeta?.name || c.fileName;
}

function getActiveCase() {
  return cases.find((c) => c.id === activeCaseId) || null;
}

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
  try {
    const ext = file.name.split(".").pop().toLowerCase();
    let result;
    let caseMeta = null;
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

    const newCase = {
      id: `case-${caseSeq++}`,
      fileName: file.name,
      color: CASE_COLORS[colorSeq++ % CASE_COLORS.length],
      records: result.records,
      caseMeta,
      visible: true,
    };
    cases.push(newCase);
    activeCaseId = newCase.id;

    fileStatus.textContent = `${file.name} — ${newCase.records.length} eventos carregados. (${cases.length} caso${
      cases.length > 1 ? "s" : ""
    } carregado${cases.length > 1 ? "s" : ""})`;

    if (result.warnings && result.warnings.length > 0) {
      warningsBox.hidden = false;
      warningsBox.textContent = result.warnings.join(" ");
    }

    setControlsEnabled(true);
    resetFilterToFullRange();
    renderCasesMenu();
    applyFilter();
    mapView.fitToVisible();
  } catch (err) {
    console.error(err);
    fileStatus.textContent = "";
    warningsBox.hidden = false;
    warningsBox.textContent = `Erro ao processar arquivo: ${err.message}`;
  } finally {
    fileInput.value = "";
  }
});

function resetFilterToFullRange() {
  const allTimes = cases.flatMap((c) => c.records.map((r) => r.createdAt).filter(Boolean).map((d) => d.getTime()));
  if (allTimes.length === 0) return;
  filterStart.value = toDatetimeLocalValue(new Date(Math.min(...allTimes)));
  filterEnd.value = toDatetimeLocalValue(new Date(Math.max(...allTimes)));
}

applyFilterBtn.addEventListener("click", applyFilter);
clearFilterBtn.addEventListener("click", () => {
  resetFilterToFullRange();
  applyFilter();
});

function applyFilter() {
  if (cases.length === 0) return;
  // O fim do intervalo é tratado como inclusive até o fim do minuto escolhido
  // (o <input type="datetime-local"> só tem granularidade de minuto).
  const startDate = parseDatetimeLocal(filterStart.value);
  const endDate = parseDatetimeLocal(filterEnd.value);
  const startMs = startDate ? startDate.getTime() : -Infinity;
  const endMs = endDate ? endDate.getTime() + 59_999 : Infinity;
  for (const c of cases) {
    c.filteredRecords = c.records.filter((r) => {
      if (!r.createdAt) return false;
      const t = r.createdAt.getTime();
      return t >= startMs && t <= endMs;
    });
  }
  render();
}

// --- Menu de casos ---

function renderCasesMenu() {
  casesSection.hidden = cases.length === 0;
  casesList.innerHTML = "";
  for (const c of cases) {
    const li = document.createElement("li");
    li.className = "case-row" + (c.id === activeCaseId ? " is-active" : "");

    const swatch = document.createElement("span");
    swatch.className = "case-swatch";
    swatch.style.background = c.color;

    const visToggle = document.createElement("input");
    visToggle.type = "checkbox";
    visToggle.checked = c.visible;
    visToggle.title = "Mostrar no mapa e na linha do tempo";
    visToggle.addEventListener("change", () => {
      c.visible = visToggle.checked;
      mapView.setCaseVisible(c.id, c.visible);
      mapView.fitToVisible();
      render();
    });

    const info = document.createElement("div");
    info.className = "case-row-info";
    const name = document.createElement("div");
    name.className = "case-row-name";
    name.textContent = caseLabel(c);
    const sub = document.createElement("div");
    sub.className = "case-row-sub";
    const count = c.filteredRecords ? c.filteredRecords.length : c.records.length;
    sub.textContent = `${count} eventos` + (c.caseMeta?.cpf ? ` · CPF ${c.caseMeta.cpf}` : "") + ` · ${c.fileName}`;
    info.appendChild(name);
    info.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "case-row-actions";

    const activeBtn = document.createElement("button");
    activeBtn.className = "case-active-btn";
    activeBtn.textContent = c.id === activeCaseId ? "Ativo" : "Tornar ativo";
    activeBtn.disabled = c.id === activeCaseId;
    activeBtn.title = "Define este caso como o usado no cabeçalho, reprodução e exportação";
    activeBtn.addEventListener("click", () => {
      activeCaseId = c.id;
      renderCasesMenu();
      render();
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "case-remove-btn";
    removeBtn.textContent = "Remover";
    removeBtn.addEventListener("click", () => {
      mapView.removeCase(c.id);
      cases = cases.filter((x) => x.id !== c.id);
      if (activeCaseId === c.id) activeCaseId = cases[0]?.id || null;
      if (cases.length === 0) {
        setControlsEnabled(false);
        fileStatus.textContent = "";
      }
      resetFilterToFullRange();
      renderCasesMenu();
      applyFilter();
      mapView.fitToVisible();
    });

    actions.appendChild(activeBtn);
    actions.appendChild(removeBtn);

    li.appendChild(swatch);
    li.appendChild(visToggle);
    li.appendChild(info);
    li.appendChild(actions);
    casesList.appendChild(li);
  }
}

function renderCaseHeader() {
  const active = getActiveCase();
  const meta = active?.caseMeta;
  if (!meta || (!meta.name && !meta.zone?.lat)) {
    caseHeader.hidden = true;
    return;
  }
  caseHeader.hidden = false;
  caseName.textContent = meta.name || "Monitorado não identificado";
  caseSubtitle.textContent = [
    meta.monitoredId ? `ID ${meta.monitoredId}` : null,
    meta.cpf ? `CPF ${meta.cpf}` : null,
    meta.equipment,
  ]
    .filter(Boolean)
    .join(" · ");

  const zone = meta.zone || {};
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

  const legal = meta.legal || {};
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

// --- Render principal ---

function render() {
  if (cases.length === 0) {
    mapView.fitToVisible();
    timelineView.setCases([]);
    renderCaseHeader();
    connectionsSection.hidden = true;
    zoneViolationsBlock.hidden = true;
    anomaliesList.innerHTML = "";
    recordsTbody.innerHTML = "";
    recordsCount.textContent = "0";
    statsBox.innerHTML = "";
    playback.setRecords([]);
    updatePlaybackControls();
    return;
  }

  for (const c of cases) {
    c.geoRecords = sortRecordsByDate((c.filteredRecords || []).filter((r) => r.hasGeo));
    c.speedAnomalies = detectSpeedAnomalies(c.geoRecords);
    c.hasZone = !!(c.caseMeta && c.caseMeta.zone && c.caseMeta.zone.lat != null && c.caseMeta.zone.lon != null);
    c.zoneEpisodes = c.hasZone
      ? detectZoneViolationEpisodes(sortRecordsByDate((c.filteredRecords || []).filter((r) => r.createdAt)))
      : [];

    c.highlightIds = new Set();
    for (const a of c.speedAnomalies) {
      c.highlightIds.add(a.from.id);
      c.highlightIds.add(a.to.id);
    }
    for (const ep of c.zoneEpisodes) {
      for (const r of ep.records) c.highlightIds.add(r.id);
    }

    mapView.setCase(c.id, {
      records: c.geoRecords,
      color: c.color,
      zone: c.hasZone ? c.caseMeta.zone : null,
      visible: c.visible,
      label: caseLabel(c),
      onSelect: (r) => onRecordSelect(c.id, r),
    });
    mapView.setCaseAnomalies(c.id, c.speedAnomalies);
  }

  timelineView.setCases(
    cases
      .filter((c) => c.visible)
      .map((c) => ({
        id: c.id,
        color: c.color,
        label: caseLabel(c),
        records: c.filteredRecords || [],
        highlightIds: c.highlightIds,
      }))
  );
  timelineView.onPick = onRecordSelect;

  renderCaseHeader();
  renderConnections();

  const active = getActiveCase();
  playback.setRecords(active ? active.geoRecords : []);
  updatePlaybackControls();

  renderStats(active);
  const showZoneBlock = !!active?.hasZone;
  zoneViolationsBlock.hidden = !showZoneBlock;
  if (showZoneBlock) renderZoneViolations(active);
  renderSpeedAnomalies(active);
  renderTable(active);
  renderCasesMenu();
}

function renderConnections() {
  const visible = cases.filter((c) => c.visible && (c.filteredRecords || []).length > 0);
  if (visible.length < 2) {
    connectionsSection.hidden = true;
    return;
  }
  const inputs = visible.map((c) => ({ id: c.id, label: caseLabel(c), records: c.filteredRecords }));
  const connections = detectAllConnections(inputs);

  connectionsSection.hidden = false;
  connectionsList.innerHTML = "";
  if (connections.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma coincidência de tempo/local entre os casos visíveis no intervalo selecionado.";
    connectionsList.appendChild(li);
    return;
  }
  for (const conn of connections) {
    const li = document.createElement("li");
    li.textContent =
      `${conn.caseALabel} ↔ ${conn.caseBLabel}: ${formatDateTime(conn.start)} → ${formatDateTime(conn.end)}` +
      ` — mín. ${conn.minDistanceM.toFixed(0)} m de distância`;
    li.addEventListener("click", () => {
      mapView.setCursor([conn.lat, conn.lon]);
      mapView.panTo([conn.lat, conn.lon]);
      timelineView.setCursorTime(conn.start);
    });
    connectionsList.appendChild(li);
  }
}

function renderStats(active) {
  if (!active) {
    statsBox.innerHTML = "";
    return;
  }
  const records = active.filteredRecords || [];
  const first = records[0]?.createdAt;
  const last = records[records.length - 1]?.createdAt;
  const chips = [
    `${records.length} eventos`,
    `${active.geoRecords.length} com geolocalização`,
    active.hasZone ? `${active.zoneEpisodes.length} violações de zona` : `${active.speedAnomalies.length} anomalias de velocidade`,
    first && last ? `${formatDateTime(first)} — ${formatDateTime(last)}` : "",
    cases.length > 1 ? `${cases.length} casos carregados` : "",
  ].filter(Boolean);
  statsBox.innerHTML = "";
  for (const c of chips) {
    const span = document.createElement("span");
    span.className = "stat-chip";
    span.textContent = c;
    statsBox.appendChild(span);
  }
}

function renderZoneViolations(active) {
  zoneViolationsList.innerHTML = "";
  if (active.zoneEpisodes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma violação da zona de exclusão no intervalo selecionado.";
    zoneViolationsList.appendChild(li);
    return;
  }
  for (const ep of active.zoneEpisodes) {
    const li = document.createElement("li");
    const durationTxt = ep.durationMin < 1 ? "menos de 1 min" : `${Math.round(ep.durationMin)} min`;
    const distTxt = ep.minDistanceM != null ? ` — mín. ${ep.minDistanceM.toFixed(0)} m da referência` : "";
    const addrTxt = ep.addresses.length > 0 ? ` (${ep.addresses[0]})` : "";
    li.textContent = `${formatDateTime(ep.start)} → ${formatDateTime(ep.end)} (${durationTxt})${distTxt}${addrTxt}`;
    li.addEventListener("click", () => onRecordSelect(active.id, ep.records[0]));
    zoneViolationsList.appendChild(li);
  }
}

function renderSpeedAnomalies(active) {
  anomaliesList.innerHTML = "";
  if (!active || active.speedAnomalies.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma anomalia de velocidade detectada no intervalo selecionado.";
    anomaliesList.appendChild(li);
    return;
  }
  for (const a of active.speedAnomalies) {
    const li = document.createElement("li");
    li.textContent = `${formatDateTime(a.from.createdAt)} → ${formatDateTime(a.to.createdAt)}: ${a.distanceKm.toFixed(
      1
    )} km em ${a.hours.toFixed(2)} h (${a.speedKmh.toFixed(0)} km/h)`;
    li.addEventListener("click", () => onRecordSelect(active.id, a.to));
    anomaliesList.appendChild(li);
  }
}

function renderTable(active) {
  const records = active?.filteredRecords || [];
  recordsCount.textContent = String(records.length);
  const highlightIds = active?.highlightIds || new Set();

  const frag = document.createDocumentFragment();
  for (const r of records) {
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

function onRecordSelect(caseId, record) {
  if (record.hasGeo) {
    mapView.setCursor([record.lat, record.lon]);
    mapView.panTo([record.lat, record.lon]);
  }
  timelineView.setCursorTime(record.createdAt);
}

// --- Playback (sempre sobre o caso ativo) ---

function updatePlaybackControls() {
  const active = getActiveCase();
  const enabled = playback.hasAnimation;
  playBtn.disabled = !enabled;
  pauseBtn.disabled = !enabled;
  scrubber.disabled = !enabled;
  exportVideoBtn.disabled = !active || active.geoRecords.length === 0;
  scrubber.value = 0;
  playbackTimeLabel.textContent = active && active.geoRecords.length > 0 ? formatDateTime(active.geoRecords[0].createdAt) : "-";
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

// --- Exportação (sempre sobre o caso ativo) ---

exportVideoBtn.addEventListener("click", async () => {
  const active = getActiveCase();
  if (!active) return;
  exportVideoBtn.disabled = true;
  videoProgress.textContent = "Gravando 0%...";
  try {
    await exportVideo({
      mapView,
      playback,
      zone: active.hasZone ? active.caseMeta.zone : null,
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
    exportVideoBtn.disabled = !active || active.geoRecords.length === 0;
    setTimeout(() => (videoProgress.textContent = ""), 4000);
  }
});

exportPdfBtn.addEventListener("click", async () => {
  const active = getActiveCase();
  if (!active) return;
  exportPdfBtn.disabled = true;
  try {
    await exportReportPdf({
      mapView,
      geoRecords: active.geoRecords,
      anomalies: active.speedAnomalies,
      zoneEpisodes: active.zoneEpisodes,
      caseMeta: active.caseMeta,
      meta: buildMeta(active),
    });
  } catch (err) {
    console.error(err);
    alert(`Falha ao gerar relatório PDF: ${err.message}`);
  } finally {
    exportPdfBtn.disabled = false;
  }
});

exportImageBtn.addEventListener("click", async () => {
  const active = getActiveCase();
  if (!active) return;
  exportImageBtn.disabled = true;
  try {
    await exportReportImage({
      mapView,
      geoRecords: active.geoRecords,
      anomalies: active.speedAnomalies,
      zoneEpisodes: active.zoneEpisodes,
      caseMeta: active.caseMeta,
      meta: buildMeta(active),
    });
  } catch (err) {
    console.error(err);
    alert(`Falha ao gerar relatório em imagem: ${err.message}`);
  } finally {
    exportImageBtn.disabled = false;
  }
});

function buildMeta(active) {
  const records = active.filteredRecords || [];
  const first = records[0];
  return {
    accountNumber: first?.accountNumber,
    cpf: first?.cpf,
    periodStart: records[0]?.createdAt,
    periodEnd: records[records.length - 1]?.createdAt,
    totalEvents: records.length,
    geoEvents: active.geoRecords.length,
    anomaliesCount: active.speedAnomalies.length,
  };
}

window.addEventListener("resize", () => mapView.invalidateSize());
