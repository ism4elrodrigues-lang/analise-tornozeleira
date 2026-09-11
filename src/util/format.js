const dtFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dtShortFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
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

export function toDatetimeLocalValue(date) {
  if (!date) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
