import { formatDateTimeShort } from "../util/format.js";

const PADDING_X = 16;
const AXIS_Y_RATIO = 0.72;
const TICK_TOP_RATIO = 0.15;

export class TimelineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.records = [];
    this.anomalySet = new Set();
    this.minTime = null;
    this.maxTime = null;
    this.cursorTime = null;
    this.onPick = null;

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this.canvas.addEventListener("click", (e) => this._handleClick(e));

    this._resize();
  }

  setRecords(records) {
    this.records = records.filter((r) => r.createdAt);
    if (this.records.length > 0) {
      this.minTime = this.records[0].createdAt.getTime();
      this.maxTime = this.records[this.records.length - 1].createdAt.getTime();
      if (this.minTime === this.maxTime) this.maxTime += 60_000;
    } else {
      this.minTime = this.maxTime = null;
    }
    this.draw();
  }

  setAnomalies(anomalies) {
    this.anomalySet = new Set();
    for (const a of anomalies) {
      this.anomalySet.add(a.from.id);
      this.anomalySet.add(a.to.id);
    }
    this.draw();
  }

  setCursorTime(date) {
    this.cursorTime = date ? date.getTime() : null;
    this.draw();
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.draw();
  }

  _timeToX(t) {
    const w = this.cssWidth - PADDING_X * 2;
    if (this.maxTime === this.minTime) return PADDING_X;
    return PADDING_X + ((t - this.minTime) / (this.maxTime - this.minTime)) * w;
  }

  _xToTime(x) {
    const w = this.cssWidth - PADDING_X * 2;
    const ratio = (x - PADDING_X) / w;
    return this.minTime + ratio * (this.maxTime - this.minTime);
  }

  _handleClick(e) {
    if (!this.onPick || this.records.length === 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = this._xToTime(x);
    let nearest = this.records[0];
    let bestDiff = Infinity;
    for (const r of this.records) {
      const diff = Math.abs(r.createdAt.getTime() - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = r;
      }
    }
    this.onPick(nearest);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    ctx.clearRect(0, 0, w, h);

    if (!this.minTime) {
      ctx.fillStyle = "#999";
      ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("Carregue um arquivo para ver a linha do tempo.", PADDING_X, h / 2);
      return;
    }

    const axisY = h * AXIS_Y_RATIO;
    const tickTop = h * TICK_TOP_RATIO;

    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_X, axisY);
    ctx.lineTo(w - PADDING_X, axisY);
    ctx.stroke();

    for (const r of this.records) {
      const x = this._timeToX(r.createdAt.getTime());
      const isAnomaly = this.anomalySet.has(r.id);
      ctx.strokeStyle = isAnomaly ? "#d9534f" : r.hasGeo ? "#1e3a5f" : "#b7bec7";
      ctx.lineWidth = isAnomaly ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(x, tickTop);
      ctx.lineTo(x, axisY);
      ctx.stroke();
    }

    ctx.fillStyle = "#555";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(formatDateTimeShort(new Date(this.minTime)), PADDING_X, axisY + 6);
    const endLabel = formatDateTimeShort(new Date(this.maxTime));
    const endWidth = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, w - PADDING_X - endWidth, axisY + 6);

    if (this.cursorTime != null) {
      const x = this._timeToX(this.cursorTime);
      ctx.strokeStyle = "#d9534f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, axisY);
      ctx.stroke();
      ctx.fillStyle = "#d9534f";
      ctx.beginPath();
      ctx.arc(x, 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
