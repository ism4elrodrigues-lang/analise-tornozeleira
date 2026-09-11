// Grava o deslocamento como vídeo, desenhando os tiles do mapa e o marcador
// animado num <canvas> próprio (não reaproveita o DOM do Leaflet, que mistura
// <img> + SVG e não é capturável via canvas.captureStream). Os tiles são
// buscados uma única vez para o enquadramento atual (sem pan durante o vídeo,
// só o marcador/trajeto se movem) e reaproveitados a cada quadro.
import { drawTileMosaic, makeProjector } from "../map/tileSnapshot.js";
import { formatDateTime } from "../util/format.js";

const FPS = 12;
const STATIC_CLIP_MS = 2500;

export async function exportVideo({ mapView, playback, onProgress }) {
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
  await drawTileMosaic(ctx, zoom, pixelBounds);
  const baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const mimeType = pickSupportedMimeType();
  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));

  const project = makeProjector(leafletMap, zoom, pixelBounds);

  const renderFrame = (frame) => {
    ctx.putImageData(baseImage, 0, 0);
    drawOverlay(ctx, project, playback.records, frame);
  };

  recorder.start();

  if (!playback.hasAnimation) {
    renderFrame({ lat: playback.records[0].lat, lon: playback.records[0].lon, time: playback.records[0].createdAt, record: playback.records[0] });
    await sleep(STATIC_CLIP_MS);
  } else {
    const prevOnFrame = playback.onFrame;
    const prevOnEnd = playback.onEnd;
    const wasPlaying = playback.playing;
    playback.pause();
    playback.elapsedMs = 0;

    playback.onFrame = (frame, fraction) => {
      if (frame) renderFrame(frame);
      if (onProgress) onProgress(fraction);
    };

    await new Promise((resolve) => {
      playback.onEnd = resolve;
      playback.play();
    });

    playback.onFrame = prevOnFrame;
    playback.onEnd = prevOnEnd;
    if (wasPlaying) playback.play();
  }

  recorder.stop();
  await stopped;

  const blob = new Blob(chunks, { type: mimeType });
  downloadBlob(blob, `deslocamento_${Date.now()}.webm`);
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

  ctx.fillStyle = "#d9534f";
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
