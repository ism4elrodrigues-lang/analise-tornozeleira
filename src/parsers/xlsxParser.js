// Depende do global `XLSX` (SheetJS), carregado via lib/xlsx/xlsx.full.min.js.
//
// Formato alvo: planilhas exportadas por sistemas de rastreamento de
// tornozeleira eletrônica (ex.: SAC24), com duas abas:
//  - uma aba de "ficha"/metadados do monitorado, em pares rótulo:valor
//    (ex.: "Nome Completo:", "CPF:", "Raio de Restrição:", coordenadas de
//    referência da zona de exclusão, número do processo);
//  - uma aba de log de rastreamento, com uma linha por posição de GPS
//    (Data, Hora, Latitude, Longitude, endereço já resolvido, status
//    Regular/Violação, etc.).
//
// A aba de log é localizada automaticamente pelo cabeçalho (não pelo nome da
// aba), então planilhas com nomes de aba diferentes também devem funcionar,
// desde que as colunas sejam reconhecíveis pelos aliases abaixo. Se não
// houver aba de metadados reconhecível, a extensão segue funcionando só com
// o rastro (sem cabeçalho do caso nem zona de exclusão).
import { normalizeHeaderKey } from "./fieldSchema.js";
import { nextId, sortRecordsByDate } from "./normalize.js";
import { haversineKm } from "../util/geo.js";

const TRACK_ALIASES = {
  date: ["data"],
  time: ["hora"],
  lat: ["latitude"],
  lon: ["longitude"],
  altitude: ["altitudem", "altitude"],
  address: ["logradouroenderecoregistrado", "logradouro", "endereco", "enderecoregistrado"],
  status: ["alarmestatus", "status"],
  signal: ["sinaldispositivo", "sinal", "dispositivo"],
};

const TRACK_ALIAS_INDEX = new Map();
for (const [key, aliases] of Object.entries(TRACK_ALIASES)) {
  for (const alias of aliases) TRACK_ALIAS_INDEX.set(alias, key);
}

const META_LABELS = {
  nomecompleto: "name",
  idmonitorado: "monitoredId",
  sexo: "sex",
  cpf: "cpf",
  prontuariosigep: "sigep",
  equipamento: "equipment",
  enderecoregulamentado: "zoneAddress",
  raioderestricao: "zoneRadiusRaw",
  cepdereferencia: "zoneCep",
  tipoderestricao: "zoneType",
  latitudedereferencia: "zoneLat",
  longitudedereferencia: "zoneLon",
  periododoregistro: "periodRaw",
  totalderegistros: "totalRecordsRaw",
  processojudicial: "processNumber",
  referenciamovimento: "movRef",
  geradordorelatorio: "reportGenerator",
  datadeemissao: "issuedAt",
  geradoporusuarioid: "generatedByUserId",
  assinadodigitalmentepor: "signedBy",
};

const MIN_HEADER_MATCHES = 4;
const MAX_HEADER_SEARCH_ROWS = 10;

export async function parseXlsxFile(file) {
  if (typeof XLSX === "undefined") {
    throw new Error("Biblioteca XLSX não carregada.");
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  let trackAoa = null;
  let metaAoa = null;

  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null });
    if (!trackAoa && findTrackHeaderRow(aoa) !== -1) {
      trackAoa = aoa;
    } else if (!metaAoa && looksLikeMetaSheet(aoa)) {
      metaAoa = aoa;
    }
  }

  const warnings = [];
  const meta = metaAoa ? parseMetaSheet(metaAoa) : emptyMeta();
  if (!metaAoa) {
    warnings.push(
      "Não foi possível localizar a aba com os dados do monitorado (nome/CPF/zona de exclusão). O painel mostrará só o rastro."
    );
  }

  if (!trackAoa) {
    warnings.push(
      "Não foi possível localizar a aba de rastreamento (colunas de Data/Hora/Latitude/Longitude)."
    );
    return { records: [], meta, warnings };
  }

  const records = parseTrackSheet(trackAoa, meta);
  return { records: sortRecordsByDate(records), meta, warnings };
}

function findTrackHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, MAX_HEADER_SEARCH_ROWS); i++) {
    const row = aoa[i];
    if (!row) continue;
    const matches = row.filter((cell) => cell != null && TRACK_ALIAS_INDEX.has(normalizeHeaderKey(String(cell))));
    if (matches.length >= MIN_HEADER_MATCHES) return i;
  }
  return -1;
}

function looksLikeMetaSheet(aoa) {
  const flat = aoa.flat().filter((v) => typeof v === "string");
  const normalized = flat.map((s) => normalizeHeaderKey(s));
  return normalized.some((n) => n === "nomecompleto" || n === "cpf" || n === "processojudicial");
}

function emptyMeta() {
  return { zone: {}, legal: {} };
}

function parseMetaSheet(aoa) {
  const flat = {};
  for (const row of aoa) {
    if (!row) continue;
    for (let i = 0; i + 1 < row.length; i += 2) {
      const label = row[i];
      const value = row[i + 1];
      if (typeof label !== "string") continue;
      const trimmed = label.trim();
      if (!trimmed.endsWith(":")) continue;
      const key = normalizeHeaderKey(trimmed.slice(0, -1));
      const mapped = META_LABELS[key];
      if (mapped) flat[mapped] = value;
    }
  }

  const zoneLat = toNumber(flat.zoneLat);
  const zoneLon = toNumber(flat.zoneLon);
  const zoneRadiusM = parseFirstNumber(flat.zoneRadiusRaw);

  return {
    name: textOrNull(flat.name),
    monitoredId: textOrNull(flat.monitoredId),
    sex: textOrNull(flat.sex),
    cpf: textOrNull(flat.cpf),
    sigep: textOrNull(flat.sigep),
    equipment: textOrNull(flat.equipment),
    periodRaw: textOrNull(flat.periodRaw),
    totalRecordsRaw: textOrNull(flat.totalRecordsRaw),
    zone: {
      address: textOrNull(flat.zoneAddress),
      cep: textOrNull(flat.zoneCep),
      type: textOrNull(flat.zoneType),
      lat: zoneLat,
      lon: zoneLon,
      radiusM: zoneRadiusM,
    },
    legal: {
      processNumber: textOrNull(flat.processNumber),
      movRef: textOrNull(flat.movRef),
      reportGenerator: textOrNull(flat.reportGenerator),
      issuedAt: textOrNull(flat.issuedAt),
      generatedByUserId: textOrNull(flat.generatedByUserId),
      signedBy: textOrNull(flat.signedBy),
    },
  };
}

function parseTrackSheet(aoa, meta) {
  const headerRowIdx = findTrackHeaderRow(aoa);
  const headerRow = aoa[headerRowIdx];
  const columnKeyByIndex = {};
  headerRow.forEach((cell, idx) => {
    if (cell == null) return;
    const key = TRACK_ALIAS_INDEX.get(normalizeHeaderKey(String(cell)));
    if (key) columnKeyByIndex[idx] = key;
  });

  const hasZoneRef = meta.zone && meta.zone.lat != null && meta.zone.lon != null;
  const records = [];

  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || row.every((c) => c == null || c === "")) continue;

    const raw = {};
    for (const [idxStr, key] of Object.entries(columnKeyByIndex)) {
      raw[key] = row[Number(idxStr)];
    }

    const createdAt = parseBrDateTime(raw.date, raw.time);
    const lat = toNumber(raw.lat);
    const lon = toNumber(raw.lon);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lon);
    const status = textOrNull(raw.status);

    const record = {
      id: nextId(),
      createdAt,
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      hasGeo,
      action: status || "posição registrada",
      accountNumber: meta.monitoredId || null,
      cpf: meta.cpf || null,
      deviceModel: meta.equipment || null,
      os: null,
      osVersion: null,
      ip: null,
      port: null,
      address: textOrNull(raw.address),
      altitude: toNumber(raw.altitude),
      status,
      isViolation: isViolationStatus(status),
      signalTags: textOrNull(raw.signal),
      distanceToZoneM:
        hasZoneRef && hasGeo
          ? haversineKm({ lat, lon }, { lat: meta.zone.lat, lon: meta.zone.lon }) * 1000
          : null,
    };
    records.push(record);
  }
  return records;
}

function isViolationStatus(status) {
  if (!status) return false;
  const norm = status.toString().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return norm.includes("violac");
}

function parseBrDateTime(dateStr, timeStr) {
  if (dateStr == null || timeStr == null) return null;
  const dm = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dateStr).trim());
  if (!dm) return null;
  const [, dd, mm, yyyy] = dm;
  const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr).trim());
  if (!tm) return null;
  const [, hh, mi, ss = "00"] = tm;
  const iso = `${yyyy}-${mm}-${dd}T${hh.padStart(2, "0")}:${mi}:${ss}-03:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseFirstNumber(v) {
  if (v == null) return null;
  const m = /([\d.,]+)/.exec(String(v));
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function textOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
