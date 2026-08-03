import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { normalizeVirginiaBeaFips } from "./virginia-bea-geofips.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const inputArgument = process.argv[2];
const outputPath = path.join(projectRoot, "src", "data", "city-areas.json");

if (!inputArgument) {
  throw new Error("Pass the city GeoFIPS workbook path as the first argument.");
}

const inputPath = path.resolve(inputArgument);
if (!fs.existsSync(inputPath)) {
  throw new Error(`Source workbook not found: ${inputPath}`);
}

const workbook = XLSX.read(fs.readFileSync(inputPath));
const worksheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[worksheetName];
const rows = XLSX.utils.sheet_to_json(worksheet, {
  raw: false,
  defval: "",
});

const requiredColumns = ["name", "nameEn", "geofips"];
const cityFipsOverrides = new Map([
  ["chicago", Object.freeze(["17031", "17043", "17063", "17111", "17197"])],
  ["dayton", Object.freeze(["39057", "39109", "39113"])],
  ["miami", Object.freeze(["12086"])],
  ["richmond", Object.freeze(["51760", "51041", "51087"])],
]);
const availableColumns = new Set(Object.keys(rows[0] ?? {}));
requiredColumns.forEach((column) => {
  if (!availableColumns.has(column)) {
    throw new Error(`Required column is missing: ${column}`);
  }
});

function parseGeoFips(value, rowNumber) {
  const fips = String(value ?? "")
    .split(/[\r\n,;\uFF0C\uFF1B]+/u)
    .map((entry) => entry.replace(/\D/gu, ""))
    .filter(Boolean)
    .map((entry) => entry.padStart(5, "0"));

  const invalid = fips.filter((entry) => !/^\d{5}$/u.test(entry));
  if (invalid.length > 0) {
    throw new Error(`Invalid GeoFIPS in workbook row ${rowNumber}: ${invalid.join(", ")}`);
  }

  return [...new Set(fips.map(normalizeVirginiaBeaFips))].sort();
}

const areas = [];
rows.forEach((row, index) => {
  const rowNumber = index + 2;
  const nameZh = String(row.name ?? "").trim();
  const name = String(row.nameEn ?? "").trim();
  const rawGeoFips = String(row.geofips ?? "").trim();

  if (!nameZh && !name && !rawGeoFips) return;
  if (!nameZh || !name || !rawGeoFips) {
    throw new Error(`Incomplete city definition in workbook row ${rowNumber}.`);
  }

  const parsedFips = parseGeoFips(rawGeoFips, rowNumber);
  const overrideFips = cityFipsOverrides.get(name.toLocaleLowerCase("en-US"));
  const fips = overrideFips ? [...overrideFips] : parsedFips;
  if (fips.length === 0) {
    throw new Error(`No valid GeoFIPS found in workbook row ${rowNumber}.`);
  }

  const code = String(index + 1).padStart(3, "0");
  areas.push({
    id: `city-${code}`,
    type: "city",
    code,
    name,
    nameZh,
    fips,
  });
});

const duplicateNames = areas
  .map((area) => area.name.toLocaleLowerCase("en-US"))
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateNames.length > 0) {
  throw new Error(`Duplicate English city names: ${[...new Set(duplicateNames)].join(", ")}`);
}

areas.sort((a, b) => a.name.localeCompare(b.name, "en-US"));

const payload = {
  source: `User-provided ${path.basename(inputPath)} · ${worksheetName}`,
  counts: {
    city: areas.length,
    total: areas.length,
  },
  areas,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Generated ${path.relative(projectRoot, outputPath)} with ${areas.length} city areas.`,
);
