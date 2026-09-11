import { lerpLatLng, lerp } from "../util/geo.js";

// Os pings de geolocalização costumam ter intervalos muito irregulares (segundos
// a dias). Para virar um playback assistível, cada segmento entre dois pontos
// consecutivos ganha uma duração "de exibição" numa escala log, entre
// MIN_SEGMENT_MS e MAX_SEGMENT_MS — não é tempo real, mas preserva a noção de
// "esse trecho foi rápido" vs "esse trecho foi um salto grande no tempo".
const MIN_SEGMENT_MS = 500;
const MAX_SEGMENT_MS = 3500;
const CAP_SECONDS_FOR_MAX = 86400; // 1 dia real já vale a duração máxima de exibição

function segmentDisplayMs(realMs) {
  const realSec = Math.max(0, realMs / 1000);
  const t = Math.log10(1 + realSec) / Math.log10(1 + CAP_SECONDS_FOR_MAX);
  const clamped = Math.min(1, Math.max(0, t));
  return MIN_SEGMENT_MS + (MAX_SEGMENT_MS - MIN_SEGMENT_MS) * clamped;
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
    let cum = 0;
    for (let i = 0; i < this.records.length - 1; i++) {
      const a = this.records[i];
      const b = this.records[i + 1];
      const realMs = Math.max(0, b.createdAt.getTime() - a.createdAt.getTime());
      const displayMs = segmentDisplayMs(realMs);
      this.segments.push({ from: a, to: b, displayMs, cumStart: cum });
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
