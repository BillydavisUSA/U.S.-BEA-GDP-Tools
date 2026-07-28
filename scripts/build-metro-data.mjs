import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const inputPath = path.join(projectRoot, "data", "list1_2023.xlsx");
const outputPath = path.join(projectRoot, "src", "data", "metro-areas.json");

if (!fs.existsSync(inputPath)) {
  throw new Error(`Source workbook not found: ${inputPath}`);
}

const workbook = XLSX.read(fs.readFileSync(inputPath));
const worksheet = workbook.Sheets["List 1"] ?? workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(worksheet, {
  header: 1,
  raw: false,
  defval: "",
});

const headerIndex = rows.findIndex((row) => row[0] === "CBSA Code");
if (headerIndex < 0) throw new Error("CBSA header row was not found in the workbook.");

const headers = rows[headerIndex].map((value) => String(value).trim());
const columns = Object.fromEntries(headers.map((header, index) => [header, index]));
const requiredColumns = [
  "CBSA Code",
  "CSA Code",
  "CBSA Title",
  "Metropolitan/Micropolitan Statistical Area",
  "CSA Title",
  "FIPS State Code",
  "FIPS County Code",
];

requiredColumns.forEach((header) => {
  if (!(header in columns)) throw new Error(`Required column is missing: ${header}`);
});

const dataRows = rows.slice(headerIndex + 1);
const msaGroups = new Map();
const csaGroups = new Map();

function text(row, header) {
  return String(row[columns[header]] ?? "").trim();
}

function toFips(row) {
  const stateCode = text(row, "FIPS State Code");
  const countyCode = text(row, "FIPS County Code");
  if (!/^\d{1,2}$/u.test(stateCode) || !/^\d{1,3}$/u.test(countyCode)) return "";
  return `${stateCode.padStart(2, "0")}${countyCode.padStart(3, "0")}`;
}

function addToGroup(groups, key, initial, fips) {
  if (!groups.has(key)) groups.set(key, { ...initial, fips: new Set() });
  const group = groups.get(key);
  if (!group.code && initial.code) {
    group.code = initial.code;
    group.id = initial.id;
  }
  group.fips.add(fips);
}

dataRows.forEach((row) => {
  const fips = toFips(row);
  if (!fips) return;

  const areaType = text(row, "Metropolitan/Micropolitan Statistical Area");
  const cbsaCode = text(row, "CBSA Code");
  const cbsaTitle = text(row, "CBSA Title");

  if (areaType === "Metropolitan Statistical Area" && cbsaCode && cbsaTitle) {
    addToGroup(
      msaGroups,
      cbsaCode,
      { id: `msa-${cbsaCode}`, type: "msa", code: cbsaCode, name: cbsaTitle },
      fips,
    );
  }

  const csaTitle = text(row, "CSA Title");
  if (csaTitle) {
    const csaCode = text(row, "CSA Code");
    const titleKey = csaTitle.toLocaleLowerCase("en-US");
    addToGroup(
      csaGroups,
      titleKey,
      { id: `csa-${csaCode || titleKey}`, type: "csa", code: csaCode, name: csaTitle },
      fips,
    );
  }
});

function serializeGroup(group) {
  return {
    id: group.id,
    type: group.type,
    code: group.code,
    name: group.name,
    fips: [...group.fips].sort(),
  };
}

const areas = [...msaGroups.values(), ...csaGroups.values()]
  .map(serializeGroup)
  .sort((a, b) => a.name.localeCompare(b.name, "en-US") || a.type.localeCompare(b.type));

const payload = {
  source: "U.S. Census Bureau / OMB July 2023 delineations",
  counts: {
    msa: msaGroups.size,
    csa: csaGroups.size,
    total: areas.length,
  },
  areas,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  `Generated ${path.relative(projectRoot, outputPath)} with ${msaGroups.size} MSA and ${csaGroups.size} CSA areas.`,
);
