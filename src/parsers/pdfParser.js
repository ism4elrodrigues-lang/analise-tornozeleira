// Reconstrói uma tabela a partir de um PDF com texto selecionável (não-escaneado).
//
// Estratégia: agrupa os itens de texto em linhas pela coordenada Y; na primeira
// linha em que reconhecemos várias colunas do schema (FIELDS) pelos aliases,
// fixamos a posição X de cada coluna. Para as linhas seguintes, cada item de
// texto é atribuído à coluna cujo X inicial é o maior valor <= X do item — isso
// preserva células vazias (ex.: latitude/longitude ausentes) sem desalinhar as
// colunas seguintes, o que uma extração puramente sequencial de texto não faz.
//
// Limitação conhecida: assume PDF gerado a partir da mesma tabela (uma célula
// de cabeçalho por coluna, alinhamento à esquerda). PDFs escaneados (imagem)
// não têm texto selecionável e não são suportados aqui.

import * as pdfjsLib from "../../lib/pdfjs/pdf.min.mjs";
import { matchField } from "./fieldSchema.js";
import { recordFromKeyedValues, sortRecordsByDate } from "./normalize.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "lib/pdfjs/pdf.worker.min.mjs"
);

const Y_TOLERANCE = 2.5;
const HEADER_MIN_MATCHES = 4;

export async function parsePdfFile(file) {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;

  let columns = null;
  const rawRecords = [];
  const warnings = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const lines = groupItemsIntoLines(content.items);

    for (const line of lines) {
      const headerCols = tryDetectHeader(line);
      if (headerCols) {
        columns = headerCols;
        continue;
      }
      if (!columns) continue;
      const valuesByKey = assignItemsToColumns(line, columns);
      if (Object.keys(valuesByKey).length === 0) continue;
      rawRecords.push(recordFromKeyedValues(valuesByKey));
    }
  }

  if (!columns) {
    warnings.push(
      "Não foi possível localizar o cabeçalho da tabela no PDF automaticamente. " +
        "Verifique se o PDF tem texto selecionável (não é uma imagem escaneada) ou tente carregar como CSV."
    );
  } else if (rawRecords.length === 0) {
    warnings.push("Cabeçalho da tabela encontrado, mas nenhuma linha de dados foi lida.");
  }

  return { records: sortRecordsByDate(rawRecords), warnings };
}

function groupItemsIntoLines(items) {
  const sorted = items
    .filter((i) => i.str && i.str.trim() !== "")
    .sort((a, b) => b.transform[5] - a.transform[5]);

  const lines = [];
  for (const item of sorted) {
    const y = item.transform[5];
    let line = lines.find((l) => Math.abs(l.y - y) <= Y_TOLERANCE);
    if (!line) {
      line = { y, items: [] };
      lines.push(line);
    }
    line.items.push(item);
  }
  for (const line of lines) line.items.sort((a, b) => a.transform[4] - b.transform[4]);
  return lines;
}

function tryDetectHeader(line) {
  const matches = [];
  for (const item of line.items) {
    const field = matchField(item.str);
    if (field && !matches.some((m) => m.field.key === field.key)) {
      matches.push({ x: item.transform[4], field });
    }
  }
  if (matches.length < HEADER_MIN_MATCHES) return null;
  return matches.sort((a, b) => a.x - b.x);
}

function assignItemsToColumns(line, columns) {
  const valuesByKey = {};
  for (const item of line.items) {
    const x = item.transform[4];
    let col = columns[0];
    for (const c of columns) {
      if (c.x - 3 <= x) col = c;
      else break;
    }
    const key = col.field.key;
    valuesByKey[key] = valuesByKey[key] ? `${valuesByKey[key]} ${item.str}` : item.str;
  }
  return valuesByKey;
}
