import test from "node:test";
import assert from "node:assert/strict";
import { buildAreaCountyRows, buildAreaYearMatrix } from "../src/excel.js";

test("exports areas as rows and years as columns without area codes", () => {
  const matrix = buildAreaYearMatrix([
    { areaName: "Akron, OH", year: "2024", total: 30, status: "ok" },
    { areaName: "Abilene, TX", year: "2023", total: 10, status: "ok" },
    { areaName: "Abilene, TX", year: "2024", total: null, status: "missing" },
    { areaName: "Akron, OH", year: "2023", total: 20, status: "ok" },
  ], "Metropolitan Statistical Area");

  assert.deepEqual(matrix.rows, [
    ["Metro area type", "Metropolitan Statistical Area"],
    ["Gross domestic product (thousands of dollars)"],
    ["Year", "2023", "2024"],
    ["Abilene, TX", 10, "No data"],
    ["Akron, OH", 20, 30],
  ]);
});

test("exports state rows with a state-level heading", () => {
  const matrix = buildAreaYearMatrix([
    { areaName: "Alabama", year: "2023", total: 10, status: "ok" },
    { areaName: "Alabama", year: "2024", total: 12, status: "ok" },
  ], "State", "Current-dollar GDP (millions of dollars)", "Geographic level");

  assert.deepEqual(matrix.rows, [
    ["Geographic level", "State"],
    ["Current-dollar GDP (millions of dollars)"],
    ["Year", "2023", "2024"],
    ["Alabama", 10, 12],
  ]);
});

test("exports country quarterly periods in chronological columns", () => {
  const matrix = buildAreaYearMatrix([
    { areaName: "United States", areaType: "country", year: "2025Q3", total: 600, status: "ok" },
    { areaName: "United States", areaType: "country", year: "2025Q1", total: 100, status: "ok" },
    { areaName: "United States", areaType: "country", year: "2025Q2", total: 300, status: "ok" },
  ], "Country", "Current-dollar GDP (millions of dollars)", "Geographic level");

  assert.deepEqual(matrix.years, ["2025Q1", "2025Q2", "2025Q3"]);
  assert.deepEqual(matrix.rows.at(-1), ["United States", 100, 300, 600]);
});

test("exports every selected MSA and CSA county by year with NoteRef merge status", () => {
  const rows = buildAreaCountyRows([
    { GeoFips: "01001", GeoName: "Autauga, AL", TimePeriod: "2023", DataValue: "1,200", NoteRef: "*" },
    { GeoFips: "01003", GeoName: "Baldwin, AL", TimePeriod: "2023", DataValue: "0", NoteRef: "(D)" },
  ], [
    { type: "msa", code: "10000", name: "Example MSA", fips: ["01001", "01003"] },
    { type: "csa", code: "100", name: "Example CSA", fips: ["01001", "01003"] },
  ], ["2023", "2024"]);

  assert.deepEqual(rows, [
    ["Metro area type", "Metro area name", "Metro area code", "County GeoFips", "County name", "Year", "DataValue", "NoteRef", "Aggregation status"],
    ["CSA", "Example CSA", "100", "01001", "Autauga, AL", "2023", 1200, "*", "Included"],
    ["CSA", "Example CSA", "100", "01001", "Autauga, AL", "2024", "", "", "No BEA data"],
    ["CSA", "Example CSA", "100", "01003", "Baldwin, AL", "2023", 0, "(D)", "Excluded"],
    ["CSA", "Example CSA", "100", "01003", "Baldwin, AL", "2024", "", "", "No BEA data"],
    ["MSA", "Example MSA", "10000", "01001", "Autauga, AL", "2023", 1200, "*", "Included"],
    ["MSA", "Example MSA", "10000", "01001", "Autauga, AL", "2024", "", "", "No BEA data"],
    ["MSA", "Example MSA", "10000", "01003", "Baldwin, AL", "2023", 0, "(D)", "Excluded"],
    ["MSA", "Example MSA", "10000", "01003", "Baldwin, AL", "2024", "", "", "No BEA data"],
  ]);
});

test("does not add county rows for an unrecognized imported area", () => {
  assert.deepEqual(buildAreaCountyRows([], [
    { type: "imported", code: "", name: "Imported data", fips: ["01001"] },
  ], ["2023"]), []);
});
