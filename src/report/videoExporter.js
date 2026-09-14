// Grava o deslocamento como vídeo, desenhando os tiles do mapa e o marcador
// animado num <canvas> próprio (não reaproveita o DOM do Leaflet, que mistura
// <img> + SVG e não é capturável via canvas.captureStream). Os tiles são
// buscados uma única vez para o enquadramento atual (sem pan durante o vídeo,
// só o marcador/trajeto se movem) e reaproveitados a cada quadro.
import { drawTileMosaic, makeProjector } from "../map/tileSnapshot.js";
import { formatDateTime } from "../util/format.js";

const FPS = 12;
const STATIC_CLIP_MS = 2500;
export const DEFAULT_PHOTO_HOLD_MS = 5000;

/**
 * @param {object} opts
 * @param {(record: object) => (string|null)} [opts.getPhotoForRecord] retorna a foto (dataURL) anexada a um
 *   registro, se houver — quando o trajeto animado "chega" nesse ponto, o vídeo pausa mostrando a foto em
 *   tela cheia por `photoHoldMs` antes de continuar.
 * @param {number} [opts.photoHoldMs] duração (ms) de cada pausa com foto. Padrão 5s.
 */
export async function exportVideo({ mapView, playback, zone, onProgress, getPhotoForRecord, photoHoldMs = DEFAULT_PHOTO_HOLD_MS }) {
  if (playback.records.length === 0) {
    throw new Error("Não há pontos com geolocalização no intervalo selecionado para gerar vídeo.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Gravação de vídeo não é suportada neste navegador.");
  }

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
  await drawTileMosaic(ctx, zoom, pixelBounds, mapView.getActiveTileProvider());

  const project = makeProjector(leafletMap, zoom, pixelBounds);

  if (zone && zone.lat != null && zone.lon != null && zone.radiusM) {
    const metersPerPixel = (156543.03392 * Math.cos((zone.lat * Math.PI) / 180)) / Math.pow(2, zoom);
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

  const baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const mimeType = pickSupportedMimeType();
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));

  const renderFrame = (frame) => {
    ctx.putImageData(baseImage, 0, 0);
    drawOverlay(ctx, project, playback.records, frame);
  };

  recorder.start();

  if (!playback.hasAnimation) {
    const only = playback.records[0];
    const frame = { lat: only.lat, lon: only.lon, time: only.createdAt, record: only };
    renderFrame(frame);
    const photo = getPhotoForRecord && getPhotoForRecord(only);
    if (photo) {
      await showPhotoHold(ctx, canvas, photo, photoHoldMs);
      renderFrame(frame);
    }
    await sleep(STATIC_CLIP_MS);
  } else {
    // Não usamos playback.play() aqui: dirigimos a animação nós mesmos (via
    // frameAtFraction, que é uma função pura) para poder pausar em pontos com
    // foto anexada sem mexer no estado da reprodução ao vivo do painel.
    const wasPlaying = playback.playing;
    playback.pause();
    await playAnimatedWithPhotoStops({ playback, renderFrame, onProgress, getPhotoForRecord, photoHoldMs, ctx, canvas });
    if (wasPlaying) playback.play();
  }

  recorder.stop();
  await stopped;

  const blob = new Blob(chunks, { type: mimeType });
  downloadBlob(blob, `deslocamento_${Date.now()}.webm`);
}

/** Toca a animação do trajeto no tempo real (respeitando `playback.speed`), pausando em pontos com foto anexada. */
async function playAnimatedWithPhotoStops({ playback, renderFrame, onProgress, getPhotoForRecord, photoHoldMs, ctx, canvas }) {
  const totalMs = playback.totalMs;
  const speed = playback.speed;
  const photoStops = getPhotoForRecord ? buildPhotoStops(playback, getPhotoForRecord) : [];
  let photoIdx = 0;
  let elapsed = 0;
  let lastTs = null;

  await new Promise((resolve) => {
    const step = async (ts) => {
      if (lastTs != null) {
        elapsed = Math.min(totalMs, elapsed + (ts - lastTs) * speed);
      }
      lastTs = ts;

      const frame = playback.frameAtFraction(totalMs === 0 ? 0 : elapsed / totalMs);
      if (frame) renderFrame(frame);
      if (onProgress) onProgress(totalMs === 0 ? 1 : elapsed / totalMs);

      while (photoIdx < photoStops.length && elapsed >= photoStops[photoIdx].arrivalMs) {
        const stop = photoStops[photoIdx++];
        await showPhotoHold(ctx, canvas, stop.photo, photoHoldMs);
        if (frame) renderFrame(frame); // volta a mostrar o mapa antes de continuar o trajeto
        lastTs = null; // o tempo real passado durante a pausa não pode virar um salto na animação
      }

      if (elapsed >= totalMs) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Pontos com foto anexada, na ordem em que a animação passa por eles, com o instante (ms decorridos) de chegada. */
function buildPhotoStops(playback, getPhotoForRecord) {
  const records = playback.records;
  const n = records.length - 1;
  const stops = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const photo = getPhotoForRecord(record);
    if (!photo) continue;
    const arrivalMs = i === 0 ? 0 : i === n ? playback.totalMs : playback.segments[i]?.cumStart ?? playback.totalMs;
    stops.push({ record, photo, arrivalMs });
  }
  return stops;
}

/** Desenha a foto ocupando o quadro todo (mantendo proporção) e mantém assim por `durationMs`. */
async function showPhotoHold(ctx, canvas, photoDataUrl, durationMs) {
  try {
    const img = await loadImage(photoDataUrl);
    ctx.save();
    ctx.fillStyle = "#111417";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  } catch (err) {
    console.warn("Não foi possível carregar a foto anexada para o vídeo:", err);
    return;
  }
  await sleep(durationMs);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Falha ao carregar imagem anexada"));
    img.src = dataUrl;
  });
}

function drawOverlay(ctx, project, records, frame) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "#1e3a5f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  let started = false;
  for (const r of records) {
    if (r.createdAt.getTime() > frame.time.getTime()) break;
    const p = project(r.lat, r.lon);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  const curP = project(frame.lat, frame.lon);
  if (started) ctx.lineTo(curP.x, curP.y);
  ctx.stroke();

  ctx.fillStyle = frame.record?.isViolation ? "#d9534f" : "#1e3a5f";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(curP.x, curP.y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const label = formatDateTime(frame.time);
  ctx.font = "bold 16px system-ui, sans-serif";
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(30,58,95,0.88)";
  ctx.fillRect(10, 10, textW + 20, 30);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 20, 25);
  ctx.restore();
}

function pickSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "video/webm";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
