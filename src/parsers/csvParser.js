// Depende do global `Papa`, carregado via <script> a partir de lib/papaparse/papaparse.min.js
import { recordsFromCsvRows, sortRecordsByDate } from "./normalize.js";

export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    if (typeof Papa === "undefined") {
      reject(new Error("PapaParse não carregado."));
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => {
        try {
          const records = sortRecordsByDate(recordsFromCsvRows(results.data));
          const errors = (results.errors || []).map((e) => `Linha ${e.row}: ${e.message}`);
          resolve({ records, warnings: errors });
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => reject(err),
    });
  });
}
