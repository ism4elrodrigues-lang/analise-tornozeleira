import { FIELDS, matchField } from "./fieldSchema.js";

function convertValue(field, raw) {
  const value = (raw ?? "").toString().trim();
  if (value === "") return null;
  switch (field.type) {
    case "float": {
      const n = parseFloat(value.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "datetime": {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    default:
      return value;
  }
}

function splitIpPort(ipPort) {
  if (!ipPort) return [null, null];
  const idx = ipPort.lastIndexOf(":");
  if (idx === -1) return [ipPort, null];
  return [ipPort.slice(0, idx), ipPort.slice(idx + 1)];
}

let seq = 0;

/**
 * @param {Record<string, string>} valuesByKey valores brutos (string) já indexados
 *   pela chave canônica do FIELDS (accountNumber, cpf, createdAt, ...).
 */
export function recordFromKeyedValues(valuesByKey) {
  const rec = { id: `r${seq++}` };
  for (const field of FIELDS) {
    if (field.key === "ipPort") continue;
    rec[field.key] = convertValue(field, valuesByKey[field.key]);
  }
  const [ip, port] = splitIpPort(valuesByKey.ipPort);
  rec.ip = ip ? ip.trim() : null;
  rec.port = port ? port.trim() : null;
  rec.hasGeo = rec.lat != null && rec.lon != null;
  return rec;
}

/**
 * Converte linhas do PapaParse (objetos indexados pelo header original do CSV)
 * para registros normalizados, resolvendo o header real -> chave canônica.
 */
export function recordsFromCsvRows(rows) {
  if (!rows || rows.length === 0) return [];
  const headerKeys = Object.keys(rows[0]);
  const keyToField = {};
  for (const h of headerKeys) {
    const field = matchField(h);
    if (field) keyToField[h] = field;
  }
  return rows.map((row) => {
    const valuesByKey = {};
    for (const [csvKey, field] of Object.entries(keyToField)) {
      valuesByKey[field.key] = row[csvKey];
    }
    return recordFromKeyedValues(valuesByKey);
  });
}

export function sortRecordsByDate(records) {
  return [...records].sort((a, b) => {
    const ta = a.createdAt ? a.createdAt.getTime() : 0;
    const tb = b.createdAt ? b.createdAt.getTime() : 0;
    return ta - tb;
  });
}
