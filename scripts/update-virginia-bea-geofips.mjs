import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import {
  VIRGINIA_BEA_COMBINATION_AREAS,
  VIRGINIA_BEA_COMBINATION_BY_FIPS,
} from "./virginia-bea-geofips.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const workbookPath = path.join(projectRoot, "data", "list1_2023.xlsx");
const csvPath = process.argv[2] ? path.resolve(process.argv[2]) : "";

if (!fs.existsSync(workbookPath)) {
  throw new Error(`Source workbook not found: ${workbookPath}`);
}
if (!csvPath || !fs.existsSync(csvPath)) {
  throw new Error(
    "Pass the BEA Virginia county CSV path, for example: "
      + "node scripts/update-virginia-bea-geofips.mjs C:\\path\\to\\Table.csv",
  );
}

const csvText = fs.readFileSync(csvPath, "utf8");
const csvCodes = new Map();
csvText.split(/\r?\n/u).forEach((line) => {
  const match = line.match(/^(\d{5}),"?(.*?)"?,[^,]*$/u);
  if (match) csvCodes.set(match[1], match[2].replace(/\*$/u, "").trim());
});

const missingCsvAreas = VIRGINIA_BEA_COMBINATION_AREAS.filter(
  (area) => !csvCodes.has(area.fips),
);
if (missingCsvAreas.length) {
  throw new Error(
    `The BEA CSV is missing Virginia combination GeoFIPS: ${
      missingCsvAreas.map((area) => area.fips).join(", ")
    }`,
  );
}

const workbook = XLSX.read(fs.readFileSync(workbookPath), { cellStyles: true });
const sheetName = workbook.Sheets["List 1"] ? "List 1" : workbook.SheetNames[0];
const originalSheet = workbook.Sheets[sheetName];
const rows = XLSX.utils.sheet_to_json(originalSheet, {
  header: 1,
  raw: false,
  defval: "",
});

const headerIndex = rows.findIndex((row) => row[0] === "CBSA Code");
if (headerIndex < 0) throw new Error("CBSA header row was not found in the workbook.");

const headers = rows[headerIndex].map((value) => String(value).trim());
const columns = Object.fromEntries(headers.map((header, index) => [header, index]));
const countyNameColumn = columns["County/County Equivalent"];
const stateCodeColumn = columns["FIPS State Code"];
const countyCodeColumn = columns["FIPS County Code"];

if ([countyNameColumn, stateCodeColumn, countyCodeColumn].some((value) => value == null)) {
  throw new Error("The workbook does not contain the expected county and FIPS columns.");
}

let updatedRows = 0;
const normalizedRows = rows.map((row, rowIndex) => {
  const copy = [...row];
  if (rowIndex <= headerIndex) return copy;

  const stateCode = String(copy[stateCodeColumn] ?? "").padStart(2, "0");
  const countyCode = String(copy[countyCodeColumn] ?? "").padStart(3, "0");
  const area = VIRGINIA_BEA_COMBINATION_BY_FIPS.get(`${stateCode}${countyCode}`);
  if (!area) return copy;

  copy[countyNameColumn] = area.name;
  copy[stateCodeColumn] = "51";
  copy[countyCodeColumn] = area.fips.slice(2);
  updatedRows += 1;
  return copy;
});

const dedupeColumns = headers
  .map((_, index) => index)
  .filter((index) => index !== countyNameColumn && index !== countyCodeColumn);
const seen = new Set();
let removedRows = 0;
const outputRows = normalizedRows.filter((row, rowIndex) => {
  if (rowIndex <= headerIndex) return true;
  const stateCode = String(row[stateCodeColumn] ?? "").padStart(2, "0");
  const countyCode = String(row[countyCodeColumn] ?? "").padStart(3, "0");
  if (!VIRGINIA_BEA_COMBINATION_BY_FIPS.has(`${stateCode}${countyCode}`)) return true;

  const key = [
    ...dedupeColumns.map((index) => String(row[index] ?? "")),
    `${stateCode}${countyCode}`,
  ].join("\u001f");
  if (seen.has(key)) {
    removedRows += 1;
    return false;
  }
  seen.add(key);
  return true;
});

const outputSheet = XLSX.utils.aoa_to_sheet(outputRows);
outputSheet["!merges"] = originalSheet["!merges"];
outputSheet["!cols"] = (originalSheet["!cols"] ?? []).slice(0, headers.length);
outputSheet["!rows"] = (originalSheet["!rows"] ?? []).slice(0, outputRows.length);
if (originalSheet["!autofilter"]) outputSheet["!autofilter"] = originalSheet["!autofilter"];
workbook.Sheets[sheetName] = outputSheet;

const temporaryPath = `${workbookPath}.tmp`;
const outputBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
fs.writeFileSync(temporaryPath, outputBuffer);

const verificationWorkbook = XLSX.read(fs.readFileSync(temporaryPath));
const verificationRows = XLSX.utils.sheet_to_json(verificationWorkbook.Sheets[sheetName], {
  header: 1,
  raw: false,
  defval: "",
});
if (verificationRows.length !== outputRows.length) {
  fs.rmSync(temporaryPath, { force: true });
  throw new Error("Workbook verification failed after writing the Virginia GeoFIPS update.");
}

fs.renameSync(temporaryPath, workbookPath);
console.log(
  `Updated ${path.relative(projectRoot, workbookPath)}: `
    + `${updatedRows} Virginia rows normalized and ${removedRows} duplicate rows removed.`,
);
