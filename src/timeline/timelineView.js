import { formatDateTimeShort } from "../util/format.js";

const PADDING_X = 16;
const BOTTOM_LABEL_H = 18;
const LANE_MIN_H = 30;
const TICK_TOP_INSET = 10;

export class TimelineView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cases = []; // [{id, color, label, records, highlightIds}]
    this.minTime = null;
    this.maxTime = null;
    this.cursorTime = null;
    this.onPick = null; // (caseId, record) => void

    this._resize = this._resize.bind(this);
    window.addEventListener("resize", this._resize);
    this.canvas.addEventListener("click", (e) => this._handleClick(e));

    this._resize();
  }

  /** @param {Array<{id, color, label, records, highlightIds?: Set<string>}>} cases */
  setCases(cases) {
    this.cases = cases.map((c) => ({
      ...c,
      records: c.records.filter((r) => r.createdAt),
      highlightIds: c.highlightIds || new Set(),
    }));

    let min = null;
    let max = null;
    for (const c of this.cases) {
      for (const r of c.records) {
        const t = r.createdAt.getTime();
        if (min == null || t < min) min = t;
        if (max == null || t > max) max = t;
      }
    }
    if (min != null) {
      this.minTime = min;
      this.maxTime = min === max ? max + 60_000 : max;
    } else {
      this.minTime = this.maxTime = null;
    }

    const desiredH = Math.max(90, this.cases.length * LANE_MIN_H + BOTTOM_LABEL_H + 10);
    if (this.canvas.style.height !== `${desiredH}px`) {
      this.canvas.style.height = `${desiredH}px`;
    }
    this._resize();
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

  _laneRect(index) {
    const n = Math.max(1, this.cases.length);
    const usableH = this.cssHeight - BOTTOM_LABEL_H;
    const laneH = usableH / n;
    const top = index * laneH;
    return { top, axisY: top + laneH - 6, height: laneH };
  }

  _handleClick(e) {
    if (!this.onPick || this.cases.length === 0 || !this.minTime) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const n = this.cases.length;
    const usableH = this.cssHeight - BOTTOM_LABEL_H;
    const idx = Math.min(n - 1, Math.max(0, Math.floor((y / usableH) * n)));
    const caseEntry = this.cases[idx];
    if (!caseEntry || caseEntry.records.length === 0) return;

    const t = this._xToTime(x);
    let nearest = caseEntry.records[0];
    let bestDiff = Infinity;
    for (const r of caseEntry.records) {
      const diff = Math.abs(r.createdAt.getTime() - t);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = r;
      }
    }
    this.onPick(caseEntry.id, nearest);
  }

  draw() {
    const ctx = this.ctx;
    const w = this.cssWidth;
    const h = this.cssHeight;
    ctx.clearRect(0, 0, w, h);

    if (!this.minTime || this.cases.length === 0) {
      ctx.fillStyle = "#999";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("Carregue um arquivo para ver a linha do tempo.", PADDING_X, h / 2);
      return;
    }

    this.cases.forEach((c, idx) => {
      const { top, axisY } = this._laneRect(idx);

      ctx.fillStyle = c.color;
      ctx.font = "bold 10px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(c.label, PADDING_X, top + 1);

      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PADDING_X, axisY);
      ctx.lineTo(w - PADDING_X, axisY);
      ctx.stroke();

      for (const r of c.records) {
        const x = this._timeToX(r.createdAt.getTime());
        const highlighted = c.highlightIds.has(r.id);
        ctx.strokeStyle = highlighted ? "#d9534f" : c.color;
        ctx.lineWidth = highlighted ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x, top + TICK_TOP_INSET);
        ctx.lineTo(x, axisY);
        ctx.stroke();
      }
    });

    const labelY = h - BOTTOM_LABEL_H + 4;
    ctx.fillStyle = "#555";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(formatDateTimeShort(new Date(this.minTime)), PADDING_X, labelY);
    const endLabel = formatDateTimeShort(new Date(this.maxTime));
    const endWidth = ctx.measureText(endLabel).width;
    ctx.fillText(endLabel, w - PADDING_X - endWidth, labelY);

    if (this.cursorTime != null) {
      const x = this._timeToX(this.cursorTime);
      ctx.strokeStyle = "#d9534f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h - BOTTOM_LABEL_H);
      ctx.stroke();
    }
  }
}
