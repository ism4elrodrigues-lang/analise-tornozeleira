// Parser do "Relatorio de Rastro de Monitorados SAC24" em PDF (o relatório
// que o SAC24 gera a partir de uma consulta por endereço + raio + período, e
// que costuma ser juntado ao Projudi).
//
// Estrutura do PDF:
//  - pág. 1: "Parâmetros utilizados: Endereço: ... | Data inicial: ... |
//    Data final: ... | Latitude: ... | Longitude: ... | Raio: ...";
//  - pág. 2: tabela "Legenda / Nome / Sexo / CPF / Prontuário SIGEP /
//    Equipamento" com os monitorados, seguida da tabela "Posicionamentos"
//    (Nome, Id. monitorado, Data do posicionamento, Latitude, Longitude,
//    Logradouro, Altitude, Alarmes, Eventos), que continua nas páginas
//    seguintes sem repetir o cabeçalho.
//
// Dificuldades que o parser genérico (uma linha de texto = uma linha da
// tabela) não resolve:
//  - as colunas são estreitas, então nome, latitude e longitude quebram em
//    duas linhas ("-25.516" / "89" = -25.51689), deslocadas para cima e para
//    baixo da linha da data;
//  - quando a linha da tabela cai no fim da página, a parte quebrada das
//    células (nome/lat/lon) às vezes é impressa no topo da página seguinte.
//
// Estratégia: cada linha da tabela tem exatamente uma data/hora — ela é a
// âncora da linha. Os demais textos são atribuídos à coluna pela posição X e
// à linha pela âncora mais próxima em Y. Latitude/longitude são remontadas
// como "células" (fragmento inicial com sinal + continuação só com dígitos)
// e casadas 1-para-1 com as âncoras; células que sobram acima da primeira
// âncora da página pertencem à última linha da página anterior.

import { normalizeHeaderKey } from "./fieldSchema.js";
import { nextId, sortRecordsByDate } from "./normalize.js";
import { haversineKm } from "../util/geo.js";

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const COORD_START_RE = /^-?\d+(?:[.,]\d*)?$/;
const DIGITS_RE = /^\d+$/;
// Distância máxima (em pontos do PDF) entre a âncora (data) e um texto da
// mesma linha. As linhas têm ~15,5pt de altura; células quebradas ficam a
// ~3,7pt da âncora, e linhas "altas" (com conteúdo vindo de quebra de
// página) chegam a ~10pt.
const MAX_ROW_DY = 12;
const FOOTER_MAX_Y = 45;

/** Reconhece o relatório pelo título impresso no topo das páginas. */
export function isSac24TrackReport(pages) {
  return pages.some((items) =>
    items.some((it) => /rastro de monitorados/i.test(it.str) && /sac24/i.test(it.str))
  );
}

/**
 * @param {Array<Array<{str:string,x:number,y:number}>>} pages itens de texto
 *   de cada página (x/y = transform[4]/transform[5] do pdf.js).
 */
export function parseSac24Pages(pages) {
  const warnings = [];
  const params = parseParams(pages);
  const legend = parseLegend(pages);

  let columns = null;
  const rows = []; // { anchorY, page, values: {key: [{str,y}]}, lat:[], lon:[] }
  let lastRowPrevPage = null;

  for (let p = 0; p < pages.length; p++) {
    const items = pages[p].filter((it) => it.str && it.str.trim() !== "");
    const header = detectPositionsHeader(items);
    let tableTopY;
    if (header) {
      columns = header.columns;
      tableTopY = header.bottomY - 4;
    } else {
      tableTopY = topOfTableWithoutHeader(items);
    }
    if (!columns) continue;

    const tableItems = splitMergedItems(
      items.filter((it) => it.y < tableTopY && it.y > FOOTER_MAX_Y),
      columns
    );
    const anchors = [];
    const others = [];
    for (const it of tableItems) {
      if (columnOf(it.x, columns) === "date" && DATE_RE.test(it.str.trim())) {
        anchors.push({ y: it.y, str: it.str.trim(), values: {}, lat: null, lon: null, page: p });
      } else {
        others.push(it);
      }
    }
    anchors.sort((a, b) => b.y - a.y);

    // Latitude / longitude: monta as células e casa 1-para-1 com as âncoras.
    // Células que sobram acima da primeira âncora são o "transbordo" da
    // última linha da página anterior; a parte de baixo delas marca até onde
    // vai esse transbordo (spillCutY) para as demais colunas.
    let spillCutY = Infinity;
    for (const key of ["lat", "lon"]) {
      const cells = buildCoordCells(others.filter((it) => columnOf(it.x, columns) === key));
      const leftovers = matchCellsToAnchors(cells, anchors, key);
      for (const cell of leftovers) {
        if (anchors.length === 0 || cell.y > anchors[0].y) {
          spillCutY = Math.min(spillCutY, cell.bottomY);
          if (lastRowPrevPage && lastRowPrevPage[key] == null) lastRowPrevPage[key] = cell.value;
        }
      }
    }

    // Demais colunas: âncora mais próxima; o que estiver no transbordo do
    // topo da página (ou acima da primeira âncora e longe dela) vai para a
    // última linha da página anterior.
    for (const it of others) {
      const key = columnOf(it.x, columns);
      if (!key || key === "lat" || key === "lon" || key === "name") continue;
      let target = nearestAnchor(anchors, it.y);
      const inSpill = lastRowPrevPage && it.y >= spillCutY - 1;
      if (inSpill || !target || Math.abs(target.y - it.y) > MAX_ROW_DY) {
        if (lastRowPrevPage && (anchors.length === 0 || it.y > anchors[0].y)) target = lastRowPrevPage;
        else continue;
      }
      (target.values[key] ||= []).push({ str: it.str.trim(), y: it.y });
    }

    rows.push(...anchors);
    if (anchors.length > 0) lastRowPrevPage = anchors[anchors.length - 1];
  }

  if (!columns) {
    warnings.push("Relatório SAC24 reconhecido, mas a tabela de \"Posicionamentos\" não foi encontrada.");
  }

  const zone = params.zone;
  const hasZoneRef = zone.lat != null && zone.lon != null;
  const records = [];
  let missingGeo = 0;

  for (const row of rows) {
    const createdAt = parseBrDateTime(row.str);
    const lat = toNumber(row.lat);
    const lon = toNumber(row.lon);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
    if (!hasGeo) missingGeo++;
    const address = joinCell(row.values.address, "text");
    const alarms = joinCell(row.values.alarms, "");
    const events = joinCell(row.values.events, "");
    const monitoredId = joinCell(row.values.monitoredId, "");
    const person = legend.find((l) => l.monitoredId && l.monitoredId === monitoredId) || legend[0] || {};

    records.push({
      id: nextId(),
      createdAt,
      lat: hasGeo ? lat : null,
      lon: hasGeo ? lon : null,
      hasGeo,
      action: alarms ? `Alarme: ${describeAlarms(alarms)}` : "posição registrada",
      accountNumber: monitoredId || null,
      cpf: person.cpf || null,
      deviceModel: person.equipment || null,
      os: null,
      osVersion: null,
      ip: null,
      port: null,
      address: address || null,
      altitude: toNumber(joinCell(row.values.altitude, "")),
      status: alarms ? describeAlarms(alarms) : null,
      isViolation: false,
      signalTags: events || null,
      distanceToZoneM:
        hasZoneRef && hasGeo ? haversineKm({ lat, lon }, { lat: zone.lat, lon: zone.lon }) * 1000 : null,
    });
  }

  if (rows.length > 0 && missingGeo > 0) {
    warnings.push(`${missingGeo} posicionamento(s) sem latitude/longitude legível no PDF.`);
  }
  if (columns && rows.length === 0) {
    warnings.push("Tabela de \"Posicionamentos\" encontrada, mas nenhuma linha de dados foi lida.");
  }
  const ids = new Set(records.map((r) => r.accountNumber).filter(Boolean));
  if (ids.size > 1 || legend.length > 1) {
    warnings.push(
      `O relatório traz ${Math.max(ids.size, legend.length)} monitorados; todos foram carregados no mesmo caso.`
    );
  }

  const person = legend[0] || {};
  const meta = {
    name: person.name || null,
    monitoredId: records.find((r) => r.accountNumber)?.accountNumber || null,
    sex: person.sex || null,
    cpf: person.cpf || null,
    sigep: person.sigep || null,
    equipment: person.equipment || null,
    periodRaw: params.periodRaw,
    totalRecordsRaw: String(records.length),
    zone,
    legal: params.legal,
  };

  return { records: sortRecordsByDate(records), meta, warnings };
}

// --- Cabeçalhos ---

const POSITION_HEADERS = [
  // [chave, prefixo normalizado do texto do cabeçalho]
  ["name", "nome"],
  ["monitoredId", "idmonitor"],
  ["date", "datadoposiciona"],
  ["lat", "latitud"],
  ["lon", "longit"],
  ["address", "logradouro"],
  ["altitude", "altitu"],
  ["alarms", "alarmes"],
  ["events", "eventos"],
];

function detectPositionsHeader(items) {
  const found = {};
  for (const it of items) {
    const norm = normalizeHeaderKey(it.str);
    // "Nome"/"CPF" também aparecem na tabela de Legenda: fica valendo o
    // título que está na mesma linha de "Logradouro" (resolvido abaixo).
    for (const [key, prefix] of POSITION_HEADERS) {
      if (norm.startsWith(prefix)) (found[key] ||= []).push(it);
    }
  }
  const logradouro = found.address?.[0];
  if (!logradouro || !found.events || !found.date) return null;
  const near = (list) =>
    (list || []).filter((it) => Math.abs(it.y - logradouro.y) <= 6).sort((a, b) => a.x - b.x)[0];
  const h = {};
  for (const [key] of POSITION_HEADERS) h[key] = near(found[key]);
  if (!h.date || !h.lat || !h.lon || !h.events) return null;

  // Limites entre colunas. Os dados ficam alinhados à esquerda e os títulos
  // centralizados, então os limites são derivados dos títulos com folga.
  const columns = [
    { key: "name", from: -Infinity },
    { key: "monitoredId", from: (h.monitoredId?.x ?? h.date.x - 48) - 8 },
    { key: "date", from: h.date.x - 8 },
    { key: "lat", from: h.lat.x - 6 },
    { key: "lon", from: h.lon.x - 5 },
    // endereços longos começam logo depois da longitude (~x+28)
    { key: "address", from: h.lon.x + 18 },
    { key: "altitude", from: (h.altitude?.x ?? h.alarms.x - 32) - 6 },
    { key: "alarms", from: h.alarms.x - 8 },
    { key: "events", from: (h.alarms.x + h.events.x) / 2 },
  ];
  const headerYs = Object.values(h).filter(Boolean).map((it) => it.y);
  return { columns, bottomY: Math.min(...headerYs) };
}

function topOfTableWithoutHeader(items) {
  // Abaixo do "Gerado por SAC24 em ..." do topo da página.
  const gen = items.find((it) => /^gerado por/i.test(it.str.trim()));
  return gen ? gen.y - 6 : Infinity;
}

// Quando duas células vizinhas ficam na mesma altura, o pdf.js às vezes as
// entrega como um único texto (ex.: "27/10/2026 13:11:59 -25.516"). Separa a
// data do que vem depois e posiciona o resto no início da coluna seguinte.
const MERGED_DATE_RE = /^(\d{2}\/\d{2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?)\s+(\S.*)$/;

function splitMergedItems(items, columns) {
  const latCol = columns.find((c) => c.key === "lat");
  const out = [];
  for (const it of items) {
    const m = MERGED_DATE_RE.exec(it.str.trim());
    if (m && columnOf(it.x, columns) === "date" && latCol) {
      out.push({ ...it, str: m[1] });
      out.push({ ...it, str: m[2], x: latCol.from + 6 });
    } else {
      out.push(it);
    }
  }
  return out;
}

function columnOf(x, columns) {
  let key = null;
  for (const c of columns) {
    if (x >= c.from) key = c.key;
    else break;
  }
  return key;
}

// --- Linhas da tabela ---

function buildCoordCells(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const cells = [];
  let current = null;
  for (const it of sorted) {
    const s = it.str.trim();
    if (current && DIGITS_RE.test(s) && current.lastY - it.y < 10 && !s.startsWith("-")) {
      current.value += s;
      current.lastY = it.y;
      current.ySum += it.y;
      current.n++;
    } else if (COORD_START_RE.test(s)) {
      current = { value: s, lastY: it.y, ySum: it.y, n: 1, topY: it.y };
      cells.push(current);
    }
  }
  return cells.map((c) => ({
    value: c.value.replace(",", "."),
    y: c.ySum / c.n,
    topY: c.topY,
    bottomY: c.lastY,
  }));
}

/** Casamento guloso pela menor distância; devolve as células que sobraram. */
function matchCellsToAnchors(cells, anchors, key) {
  const pairs = [];
  cells.forEach((c, ci) =>
    anchors.forEach((a, ai) => {
      const d = Math.abs(c.y - a.y);
      if (d <= MAX_ROW_DY) pairs.push({ d, ci, ai });
    })
  );
  pairs.sort((p, q) => p.d - q.d);
  const usedCells = new Set();
  for (const { ci, ai } of pairs) {
    if (usedCells.has(ci) || anchors[ai][key] != null) continue;
    anchors[ai][key] = cells[ci].value;
    usedCells.add(ci);
  }
  return cells.filter((_, ci) => !usedCells.has(ci));
}

function nearestAnchor(anchors, y) {
  let best = null;
  for (const a of anchors) if (!best || Math.abs(a.y - y) < Math.abs(best.y - y)) best = a;
  return best;
}

/**
 * Junta os fragmentos de uma célula (de cima para baixo). Com sep "text",
 * usa espaço entre linhas, exceto quando a quebra caiu no meio de uma
 * palavra (próxima linha começa em minúscula: "B" + "razil").
 */
function joinCell(parts, sep) {
  if (!parts || parts.length === 0) return "";
  const strs = [...parts].sort((a, b) => b.y - a.y).map((p) => p.str);
  if (sep !== "text") return strs.join(sep).trim();
  let out = strs[0];
  for (let i = 1; i < strs.length; i++) {
    const midWord = /[A-Za-zÀ-ÿ]$/.test(out) && /^[a-zà-ÿ]/.test(strs[i]);
    out += (midWord ? "" : " ") + strs[i];
  }
  return out.trim();
}

// --- Página de parâmetros e legenda ---

function parseParams(pages) {
  const zone = { address: null, cep: null, type: null, lat: null, lon: null, radiusM: null, label: null };
  const legal = {
    processNumber: null,
    movRef: null,
    reportGenerator: "SAC24",
    issuedAt: null,
    generatedByUserId: null,
    signedBy: null,
  };
  let periodRaw = null;

  const firstPage = (pages[0] || []).map((it) => it.str).join(" ");
  const allHead = pages.slice(0, 3).flat().map((it) => it.str);

  const pm = /Par[âa]metros utilizados:(.*)/i.exec(firstPage);
  if (pm) {
    const parts = pm[1].split("|").map((s) => s.trim());
    let start = null;
    let end = null;
    for (const part of parts) {
      const m = /^([^:]+):\s*(.*)$/.exec(part);
      if (!m) continue;
      const label = normalizeHeaderKey(m[1]);
      const value = m[2].trim();
      if (label === "endereco") zone.address = value;
      else if (label === "datainicial") start = value;
      else if (label === "datafinal") end = value;
      else if (label === "latitude") zone.lat = toNumber(value);
      else if (label === "longitude") zone.lon = toNumber(value);
      else if (label === "raio") zone.radiusM = toNumber(value);
    }
    if (start || end) periodRaw = `${start || "?"} a ${end || "?"}`;
    const cep = /\b(\d{5}-\d{3})\b/.exec(zone.address || "");
    if (cep) zone.cep = cep[1];
  }
  if (zone.lat != null) {
    zone.label = "Área consultada";
    zone.type = "Raio da consulta do relatório (não é zona de exclusão)";
  }

  for (const s of allHead) {
    const proc = /Processo:\s*([\d.\-]+)/.exec(s);
    if (proc && !legal.processNumber) legal.processNumber = proc[1];
    const mov = /Ref\.\s*mov\.\s*([\d.]+)/i.exec(s);
    if (mov && !legal.movRef) legal.movRef = mov[1];
    const signed = /Assinado digitalmente por\s+([^:]+)/i.exec(s);
    if (signed && !legal.signedBy) legal.signedBy = signed[1].trim();
    const gen = /Gerado por SAC24 em\s+(.+)$/i.exec(s.trim());
    if (gen && !legal.issuedAt) legal.issuedAt = gen[1].trim();
  }

  return { zone, legal, periodRaw };
}

function parseLegend(pages) {
  for (const raw of pages) {
    const items = raw.filter((it) => it.str && it.str.trim() !== "");
    const head = items.find((it) => normalizeHeaderKey(it.str) === "prontuariosigep");
    if (!head) continue;
    const headerRow = items.filter((it) => Math.abs(it.y - head.y) <= 3);
    const col = (prefix) => headerRow.find((it) => normalizeHeaderKey(it.str).startsWith(prefix));
    const hdr = {
      name: col("nome"),
      sex: col("sexo"),
      cpf: col("cpf"),
      sigep: head,
      equipment: col("equipamento"),
    };
    const posTitle = items.find((it) => normalizeHeaderKey(it.str) === "posicionamentos");
    const bottom = posTitle ? posTitle.y : -Infinity;
    const rowItems = items.filter((it) => it.y < head.y - 3 && it.y > bottom);
    const ys = [...new Set(rowItems.map((it) => Math.round(it.y)))].sort((a, b) => b - a);
    const people = [];
    for (const y of ys) {
      const line = rowItems.filter((it) => Math.abs(it.y - y) <= 3);
      const pick = (h) => {
        if (!h) return null;
        // célula cujo centro está mais perto do centro do título
        let best = null;
        for (const it of line) {
          const d = Math.abs(it.x - h.x);
          if (!best || d < best.d) best = { d, it };
        }
        return best && best.d < 60 ? best.it.str.trim() : null;
      };
      const person = {
        name: pick(hdr.name),
        sex: pick(hdr.sex),
        cpf: pick(hdr.cpf),
        sigep: pick(hdr.sigep),
        equipment: pick(hdr.equipment),
        monitoredId: null,
      };
      if (person.name || person.cpf) people.push(person);
    }
    if (people.length) return dedupePeople(people);
  }
  return [];
}

function dedupePeople(people) {
  const seen = new Set();
  return people.filter((p) => {
    const k = `${p.name}|${p.cpf}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Alarmes ---

// Os códigos de alarme do SAC24 (ex.: "uMov") são mantidos como vieram,
// sem tradução, para não atribuir a eles um significado não documentado.
function describeAlarms(alarms) {
  return alarms
    .split(/[,;]+/)
    .map((a) => a.trim())
    .filter(Boolean)
    .join(", ");
}

// --- Conversões ---

function parseBrDateTime(str) {
  const m = DATE_RE.exec((str || "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss = "00"] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T${hh.padStart(2, "0")}:${mi}:${ss}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
