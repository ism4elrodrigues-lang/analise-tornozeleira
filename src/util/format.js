// Os dados analisados (CSV/PDF/XLSX de monitoramento eletrônico) vêm no
// horário de Brasília (UTC-3, sem horário de verão desde 2019). Fixamos essa
// timezone tanto na exibição quanto na leitura dos filtros de data/hora para
// que os horários mostrados batam com os da planilha original, independente
// do fuso configurado no sistema operacional de quem está usando a extensão.
const TZ = "America/Sao_Paulo";

const dtFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dtShortFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatDateTime(date) {
  if (!date) return "-";
  return dtFormatter.format(date);
}

export function formatDateTimeShort(date) {
  if (!date) return "-";
  return dtShortFormatter.format(date);
}

export function formatCoord(n) {
  return n == null ? "-" : n.toFixed(6);
}

function partsInSaoPaulo(date) {
  const parts = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return parts;
}

/** Valor para <input type="datetime-local">, já no horário de Brasília. */
export function toDatetimeLocalValue(date) {
  if (!date) return "";
  const p = partsInSaoPaulo(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Lê de volta um valor de <input type="datetime-local"> como horário de Brasília. */
export function parseDatetimeLocal(value) {
  if (!value) return null;
  const d = new Date(`${value}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
