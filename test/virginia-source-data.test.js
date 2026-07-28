import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as XLSX from "xlsx";
import {
  VIRGINIA_BEA_COMBINATION_AREAS,
  VIRGINIA_BEA_REPLACED_FIPS,
} from "../scripts/virginia-bea-geofips.mjs";

function loadVirginiaRows() {
  const workbook = XLSX.read(fs.readFileSync("data/list1_2023.xlsx"));
  const worksheet = workbook.Sheets["List 1"] ?? workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const headerIndex = rows.findIndex((row) => row[0] === "CBSA Code");
  const headers = rows[headerIndex].map((value) => String(value).trim());
  const columns = Object.fromEntries(headers.map((header, index) => [header, index]));

  return rows.slice(headerIndex + 1)
    .filter((row) => String(row[columns["FIPS State Code"]]).padStart(2, "0") === "51")
    .map((row) => ({
      name: String(row[columns["County/County Equivalent"]]),
      fips: `51${String(row[columns["FIPS County Code"]]).padStart(3, "0")}`,
    }));
}

test("normalizes Virginia county and city rows to BEA combination GeoFIPS", () => {
  const rows = loadVirginiaRows();
  const workbookFips = new Set(rows.map((row) => row.fips));

  VIRGINIA_BEA_REPLACED_FIPS.forEach((fips) => {
    assert.equal(workbookFips.has(fips), false, `${fips} remains in list1_2023.xlsx`);
  });

  const expectedCombinationAreas = [
    "51901", "51907", "51911", "51918", "51919", "51921", "51929", "51931",
    "51933", "51939", "51941", "51942", "51944", "51947", "51951", "51953",
    "51958",
  ];
  assert.deepEqual(
    rows.filter((row) => row.fips.startsWith("519")).map((row) => row.fips).sort(),
    expectedCombinationAreas,
  );

  const combinationNames = new Map(
    VIRGINIA_BEA_COMBINATION_AREAS.map((area) => [area.fips, area.name]),
  );
  rows.filter((row) => row.fips.startsWith("519")).forEach((row) => {
    assert.equal(row.name, combinationNames.get(row.fips));
  });
});

test("retains the BEA standalone Virginia independent cities used by metro areas", () => {
  const workbookFips = new Set(loadVirginiaRows().map((row) => row.fips));
  [
    "51510", "51550", "51650", "51700", "51710",
    "51740", "51760", "51770", "51800", "51810",
  ].forEach((fips) => assert.ok(workbookFips.has(fips), `${fips} should remain standalone`));
});
