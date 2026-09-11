import { lerpLatLng, lerp } from "../util/geo.js";

// Os pings de geolocalização variam de segundo a segundo (rastro contínuo de
// tornozeleira, um ponto por minuto) a dia a dia (log esparso de acessos de
// app). Para virar um playback assistível nos dois casos, distribuímos um
// orçamento de tempo TOTAL fixo (que cresce pouco com a quantidade de pontos,
// mas satura num teto) entre os segmentos, proporcionalmente a um peso em
// escala log do intervalo real — preserva "esse trecho foi rápido" vs "esse
// trecho foi um salto grande no tempo" sem o total explodir com centenas de
// pontos nem ficar instantâneo com poucos.
const MIN_SEGMENT_MS = 20;
const MAX_SEGMENT_MS = 5000;
const MIN_TOTAL_MS = 20_000;
const MAX_TOTAL_MS = 90_000;
const MS_PER_SEGMENT_BUDGET = 30;

function segmentWeight(realMs) {
  const realSec = Math.max(0, realMs / 1000);
  return Math.log10(1 + realSec) + 0.001; // nunca zero, mesmo para gaps de 0s
}

export class PlaybackController {
  constructor() {
    this.records = [];
    this.segments = [];
    this.totalMs = 0;
    this.elapsedMs = 0;
    this.playing = false;
    this.speed = 1;
    this.onFrame = null;
    this.onEnd = null;
    this._rafId = null;
    this._lastTs = null;
  }

  setRecords(geoRecordsSorted) {
    this.pause();
    this.records = geoRecordsSorted;
    this.segments = [];

    const n = this.records.length - 1;
    if (n <= 0) {
      this.totalMs = 0;
      this.elapsedMs = 0;
      this._emit();
      return;
    }

    const weights = [];
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      const realMs = Math.max(0, this.records[i + 1].createdAt.getTime() - this.records[i].createdAt.getTime());
      const w = segmentWeight(realMs);
      weights.push(w);
      totalWeight += w;
    }

    const targetTotalMs = Math.min(MAX_TOTAL_MS, Math.max(MIN_TOTAL_MS, n * MS_PER_SEGMENT_BUDGET));

    let cum = 0;
    for (let i = 0; i < n; i++) {
      const raw = (weights[i] / totalWeight) * targetTotalMs;
      const displayMs = Math.min(MAX_SEGMENT_MS, Math.max(MIN_SEGMENT_MS, raw));
      this.segments.push({ from: this.records[i], to: this.records[i + 1], displayMs, cumStart: cum });
      cum += displayMs;
    }
    this.totalMs = cum;
    this.elapsedMs = 0;
    this._emit();
  }

  get hasAnimation() {
    return this.segments.length > 0;
  }

  setSpeed(mult) {
    this.speed = mult;
  }

  play() {
    if (!this.hasAnimation || this.playing) return;
    if (this.elapsedMs >= this.totalMs) this.elapsedMs = 0;
    this.playing = true;
    this._lastTs = null;
    const step = (ts) => {
      if (!this.playing) return;
      if (this._lastTs != null) {
        const dt = (ts - this._lastTs) * this.speed;
        this.elapsedMs = Math.min(this.totalMs, this.elapsedMs + dt);
      }
      this._lastTs = ts;
      this._emit();
      if (this.elapsedMs >= this.totalMs) {
        this.pause();
        if (this.onEnd) this.onEnd();
        return;
      }
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  seekFraction(f) {
    this.elapsedMs = Math.min(this.totalMs, Math.max(0, f) * this.totalMs);
    this._emit();
  }

  /** Cálculo puro (não muda estado interno) usado pelo exportador de vídeo para amostrar quadros deterministicamente. */
  frameAtFraction(f) {
    const elapsedMs = Math.min(this.totalMs, Math.max(0, f) * this.totalMs);
    return this._frameAt(elapsedMs);
  }

  _frameAt(elapsedMs) {
    if (this.records.length === 0) return null;
    if (this.segments.length === 0) {
      const r = this.records[0];
      return { lat: r.lat, lon: r.lon, time: r.createdAt, record: r, segmentT: 0 };
    }
    let seg = this.segments[this.segments.length - 1];
    for (const s of this.segments) {
      if (elapsedMs < s.cumStart + s.displayMs || s === this.segments[this.segments.length - 1]) {
        seg = s;
        if (elapsedMs < s.cumStart + s.displayMs) break;
      }
    }
    const segmentT = seg.displayMs === 0 ? 1 : Math.min(1, Math.max(0, (elapsedMs - seg.cumStart) / seg.displayMs));
    const pos = lerpLatLng(seg.from, seg.to, segmentT);
    const time = new Date(lerp(seg.from.createdAt.getTime(), seg.to.createdAt.getTime(), segmentT));
    const record = segmentT < 0.5 ? seg.from : seg.to;
    return { lat: pos.lat, lon: pos.lon, time, record, segmentT, segment: seg };
  }

  _emit() {
    if (this.onFrame) this.onFrame(this._frameAt(this.elapsedMs), this.fraction);
  }

  get fraction() {
    return this.totalMs === 0 ? 0 : this.elapsedMs / this.totalMs;
  }
}
