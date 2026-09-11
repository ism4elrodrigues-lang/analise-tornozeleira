import { parseCsvFile } from "../src/parsers/csvParser.js";
import { parsePdfFile } from "../src/parsers/pdfParser.js";
import { sortRecordsByDate } from "../src/parsers/normalize.js";
import { MapView } from "../src/map/mapView.js";
import { TimelineView } from "../src/timeline/timelineView.js";
import { PlaybackController } from "../src/playback/playbackController.js";
import { detectSpeedAnomalies } from "../src/anomalies/anomalyDetector.js";
import { exportVideo } from "../src/report/videoExporter.js";
import { exportReportPdf, exportReportImage } from "../src/report/reportExporter.js";
import { lookupIp } from "../src/ipgeo/ipGeolocation.js";
import { formatDateTime, toDatetimeLocalValue } from "../src/util/format.js";

const el = (id) => document.getElementById(id);

const fileInput = el("file-input");
const fileStatus = el("file-status");
const warningsBox = el("warnings");
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
const anomaliesList = el("anomalies-list");
const recordsCount = el("records-count");
const recordsTbody = el("records-tbody");

const mapView = new MapView("map");
const timelineView = new TimelineView(el("timeline"));
const playback = new PlaybackController();

let allRecords = [];
let filteredRecords = [];
let geoRecords = [];
let anomalies = [];
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
  try {
    const ext = file.name.split(".").pop().toLowerCase();
    let result;
    if (ext === "csv") {
      result = await parseCsvFile(file);
    } else if (ext === "pdf") {
      result = await parsePdfFile(file);
    } else if (file.type === "text/csv") {
      result = await parseCsvFile(file);
    } else if (file.type === "application/pdf") {
      result = await parsePdfFile(file);
    } else {
      throw new Error("Formato não reconhecido. Use um arquivo .csv ou .pdf.");
    }

    allRecords = result.records;
    fileStatus.textContent = `${file.name} — ${allRecords.length} eventos carregados.`;

    if (result.warnings && result.warnings.length > 0) {
      warningsBox.hidden = false;
      warningsBox.textContent = result.warnings.join(" ");
    }

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
  // <input type="datetime-local"> só tem granularidade de minuto; tratamos o
  // fim do intervalo como inclusive até o fim daquele minuto (senão um
  // registro nos últimos segundos do minuto final seria descartado).
  const startMs = filterStart.value ? new Date(filterStart.value).getTime() : -Infinity;
  const endMs = filterEnd.value ? new Date(filterEnd.value).getTime() + 59_999 : Infinity;
  filteredRecords = allRecords.filter((r) => {
    if (!r.createdAt) return false;
    const t = r.createdAt.getTime();
    return t >= startMs && t <= endMs;
  });
  render();
}

function render() {
  geoRecords = sortRecordsByDate(filteredRecords.filter((r) => r.hasGeo));
  anomalies = detectSpeedAnomalies(geoRecords);

  mapView.setRecords(geoRecords, onRecordSelect);
  mapView.setAnomalies(anomalies);

  timelineView.setRecords(filteredRecords);
  timelineView.setAnomalies(anomalies);
  timelineView.onPick = onRecordSelect;

  playback.setRecords(geoRecords);
  updatePlaybackControls();

  renderStats();
  renderAnomalies();
  renderTable();
}

function renderStats() {
  const first = filteredRecords[0]?.createdAt;
  const last = filteredRecords[filteredRecords.length - 1]?.createdAt;
  const chips = [
    `${filteredRecords.length} eventos`,
    `${geoRecords.length} com geolocalização`,
    `${anomalies.length} anomalias`,
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

function renderAnomalies() {
  anomaliesList.innerHTML = "";
  if (anomalies.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nenhuma anomalia detectada no intervalo selecionado.";
    anomaliesList.appendChild(li);
    return;
  }
  for (const a of anomalies) {
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
  const anomalyIds = new Set();
  for (const a of anomalies) {
    anomalyIds.add(a.from.id);
    anomalyIds.add(a.to.id);
  }

  const frag = document.createDocumentFragment();
  for (const r of filteredRecords) {
    const tr = document.createElement("tr");
    if (r.hasGeo) tr.classList.add("has-geo");
    if (anomalyIds.has(r.id)) tr.classList.add("anomaly-row");

    tr.appendChild(td(formatDateTime(r.createdAt)));
    tr.appendChild(td(r.action || "-"));
    tr.appendChild(td(`${r.deviceModel || "-"} (${r.os || "-"} ${r.osVersion || ""})`));
    tr.appendChild(td(r.ip || "-"));
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
    await exportVideo({
      mapView,
      playback,
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
      anomalies,
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
      anomalies,
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
    anomaliesCount: anomalies.length,
  };
}

window.addEventListener("resize", () => mapView.invalidateSize());
