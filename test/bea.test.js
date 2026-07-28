import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PARAMETERS,
  aggregateByAreas,
  aggregateByYear,
  chunkValues,
  collectAreaFips,
  buildNipaRequestParameters,
  buildRequestParameters,
  expandNipaYearSelection,
  filterRecordsForTable,
  mapCountryGdpRecords,
  mapStateRecords,
  normalizeCodes,
  parseBeaPayload,
  sanitizeFilename,
} from "../src/bea.js";

test("uses CAGDP1 as the default regional GDP table", () => {
  assert.equal(DEFAULT_PARAMETERS.TABLENAME, "CAGDP1");
});

test("uses CAINC1 line code 2 and filters population records from 2001 onward", () => {
  const parameters = buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: "01001",
    tableName: "CAINC1",
    lineCode: "3",
    year: "ALL",
  });
  const records = filterRecordsForTable([
    { TimePeriod: "2000", DataValue: "1" },
    { TimePeriod: "2001", DataValue: "2" },
    { TimePeriod: "2024", DataValue: "3" },
  ], parameters.TABLENAME);

  assert.equal(parameters.DATASETNAME, "REGIONAL");
  assert.equal(parameters.TABLENAME, "CAINC1");
  assert.equal(parameters.LINECODE, "2");
  assert.equal(parameters.YEAR, "ALL");
  assert.equal(parameters.USERID, DEFAULT_PARAMETERS.USERID);
  assert.deepEqual(records.map((record) => record.TimePeriod), ["2001", "2024"]);
});

test("uses the requested state tables, line codes, and all available years", () => {
  const gdp = buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: "STATE",
    tableName: "SAGDP1",
    lineCode: "1",
    year: "ALL",
  });
  const population = buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: "STATE",
    tableName: "SAINC1",
    lineCode: "99",
    year: "ALL",
  });

  assert.equal(gdp.GEOFIPS, "STATE");
  assert.equal(gdp.TABLENAME, "SAGDP1");
  assert.equal(gdp.LINECODE, "1");
  assert.equal(gdp.YEAR, "ALL");
  assert.equal(population.TABLENAME, "SAINC1");
  assert.equal(population.LINECODE, "2");
  assert.equal(population.YEAR, "ALL");
});

test("passes BEA year shortcuts and individual years through unchanged", () => {
  const latestFive = buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: "01000",
    tableName: "SAGDP1",
    lineCode: "3",
    year: "LAST5",
  });
  const singleYear = buildRequestParameters({
    datasetName: "REGIONAL",
    geoFips: "01001",
    tableName: "CAGDP1",
    lineCode: "3",
    year: "2024",
  });

  assert.equal(latestFive.YEAR, "LAST5");
  assert.equal(singleYear.YEAR, "2024");
});

test("builds official NIPA requests without a ShowMillions or geography parameter", () => {
  const parameters = buildNipaRequestParameters({
    tableName: "T80105",
    frequency: "Q",
    year: "LAST5",
    firstYear: 1947,
    lastYear: 2026,
  });

  assert.deepEqual(parameters, {
    METHOD: "GETDATA",
    DATASETNAME: "NIPA",
    TABLENAME: "T80105",
    FREQUENCY: "Q",
    YEAR: "2022,2023,2024,2025,2026",
    RESULTFORMAT: "JSON",
    USERID: DEFAULT_PARAMETERS.USERID,
  });
  assert.equal("SHOWMILLIONS" in parameters, false);
  assert.equal("GEOFIPS" in parameters, false);
  assert.equal(expandNipaYearSelection("2025", 1947, 2026), "2025");
});

test("maps only NIPA GDP line 1 for annual and raw quarterly results", () => {
  const rows = mapCountryGdpRecords([
    {
      LineNumber: "1",
      LineDescription: "Gross domestic product",
      TimePeriod: "2025Q1",
      DataValue: "7,354,051",
    },
    {
      LineNumber: "2",
      LineDescription: "Personal consumption expenditures",
      TimePeriod: "2025Q1",
      DataValue: "9,999",
    },
    {
      LineNumber: "1",
      LineDescription: "Gross domestic product",
      TimePeriod: "2025Q2",
      DataValue: "7,640,866",
    },
  ]);

  assert.deepEqual(
    rows.map(({ areaName, areaType, year, total, calculated }) => ({
      areaName,
      areaType,
      year,
      total,
      calculated,
    })),
    [
      {
        areaName: "United States",
        areaType: "country",
        year: "2025Q1",
        total: 7354051,
        calculated: false,
      },
      {
        areaName: "United States",
        areaType: "country",
        year: "2025Q2",
        total: 7640866,
        calculated: false,
      },
    ],
  );
});

test("calculates Q1, Q1+Q2, and Q1+Q2+Q3 while omitting Q4", () => {
  const rows = mapCountryGdpRecords([
    { LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2025Q1", DataValue: "100" },
    { LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2025Q2", DataValue: "200" },
    { LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2025Q3", DataValue: "300" },
    { LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2025Q4", DataValue: "400" },
  ], { cumulativeQuarterly: true });

  assert.deepEqual(
    rows.map(({ year, total, calculated, status }) => ({ year, total, calculated, status })),
    [
      { year: "2025Q1", total: 100, calculated: true, status: "ok" },
      { year: "2025Q2", total: 300, calculated: true, status: "ok" },
      { year: "2025Q3", total: 600, calculated: true, status: "ok" },
    ],
  );
});

test("does not produce a partial cumulative value when a preceding quarter is missing", () => {
  const rows = mapCountryGdpRecords([
    { LineNumber: "1", LineDescription: "Gross domestic product", TimePeriod: "2025Q2", DataValue: "200" },
  ], { cumulativeQuarterly: true });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].year, "2025Q2");
  assert.equal(rows[0].total, null);
  assert.equal(rows[0].status, "missing");
});

test("maps state DataValue records directly without county aggregation", () => {
  const rows = mapStateRecords([
    { GeoFips: "00000", GeoName: "United States", TimePeriod: "2024", DataValue: "100" },
    { GeoFips: "01000", GeoName: "Alabama", TimePeriod: "2024", DataValue: "3,000" },
    { GeoFips: "02000", GeoName: "Alaska", TimePeriod: "2024", DataValue: "0" },
    { GeoFips: "01001", GeoName: "Autauga, AL", TimePeriod: "2024", DataValue: "20" },
  ]);

  assert.deepEqual(
    rows.map(({ areaName, areaType, year, total, status }) => ({
      areaName,
      areaType,
      year,
      total,
      status,
    })),
    [
      { areaName: "Alabama", areaType: "state", year: "2024", total: 3000, status: "ok" },
      { areaName: "Alaska", areaType: "state", year: "2024", total: 0, status: "ok" },
    ],
  );
});

test("filters BEA regional summary rows against the selected states allowlist", () => {
  const rows = mapStateRecords([
    { GeoFips: "01000", GeoName: "Alabama", TimePeriod: "2024", DataValue: "3000" },
    { GeoFips: "02000", GeoName: "Alaska", TimePeriod: "2024", DataValue: "4000" },
    { GeoFips: "91000", GeoName: "New England", TimePeriod: "2024", DataValue: "5000" },
    { GeoFips: "97000", GeoName: "Rocky Mountain", TimePeriod: "2024", DataValue: "6000" },
  ], ["01000", "02000"]);

  assert.deepEqual(rows.map((row) => row.areaName), ["Alabama", "Alaska"]);
});

test("normalizes comma, Chinese comma, spaces and newlines", () => {
  assert.equal(normalizeCodes("13013\n13035\uFF0C 13045,13013"), "13013,13035,13045");
});

test("aggregates complete values by year and keeps chronological order", () => {
  const result = aggregateByYear([
    { TimePeriod: "2003", DataValue: "1,200", NoteRef: "" },
    { TimePeriod: "2002", DataValue: "100", NoteRef: "" },
    { TimePeriod: "2002", DataValue: "250", NoteRef: "" },
  ]);

  assert.deepEqual(
    result.map(({ year, total, status }) => ({ year, total, status })),
    [
      { year: "2002", total: 350, status: "ok" },
      { year: "2003", total: 1200, status: "ok" },
    ],
  );
});

test("skips zero-value county records and sums the remaining counties", () => {
  const [result] = aggregateByYear([
    { TimePeriod: "2002", DataValue: "100", NoteRef: "" },
    { TimePeriod: "2002", DataValue: "0", NoteRef: "(D)" },
    { TimePeriod: "2002", DataValue: "250", NoteRef: "" },
  ]);

  assert.equal(result.total, 350);
  assert.equal(result.status, "ok");
  assert.equal(result.zeroCount, 1);
  assert.deepEqual(result.noteRefs, ["(D)"]);
});

test("includes a non-zero DataValue even when it has NoteRef", () => {
  const [result] = aggregateByYear([
    { TimePeriod: "2024", DataValue: "33,929,754", NoteRef: "*" },
    { TimePeriod: "2024", DataValue: "76,343,680", NoteRef: "*" },
  ]);

  assert.equal(result.total, 110273434);
  assert.equal(result.status, "ok");
  assert.equal(result.zeroCount, 0);
  assert.deepEqual(result.noteRefs, ["*"]);
});

test("marks a year as missing when all county DataValue values are zero", () => {
  const [result] = aggregateByYear([
    { TimePeriod: "2002", DataValue: "0", NoteRef: "(D)" },
    { TimePeriod: "2002", DataValue: "0", NoteRef: "(NA)" },
  ]);

  assert.equal(result.total, null);
  assert.equal(result.status, "missing");
  assert.equal(result.missingReason, "zero");
  assert.equal(result.zeroCount, 2);
});

test("applies the zero-value rule independently to each MSA and CSA", () => {
  const areas = [
    { id: "msa-a", type: "msa", code: "1", name: "Area A", fips: ["01001", "01003"] },
    { id: "csa-b", type: "csa", code: "2", name: "Area B", fips: ["01003"] },
  ];
  const records = [
    { GeoFips: "01001", TimePeriod: "2023", DataValue: "100", NoteRef: "" },
    { GeoFips: "01003", TimePeriod: "2023", DataValue: "0", NoteRef: "(D)" },
  ];

  const [msa, csa] = aggregateByAreas(records, areas);
  assert.equal(msa.total, 100);
  assert.equal(msa.status, "ok");
  assert.equal(csa.total, null);
  assert.equal(csa.status, "missing");
  assert.equal(csa.missingReason, "zero");
});

test("builds five-digit GeoFips batches and aggregates overlapping areas separately", () => {
  const areas = [
    { id: "msa-a", type: "msa", code: "1", name: "Area A", fips: ["1001", "01003"] },
    { id: "csa-b", type: "csa", code: "2", name: "Area B", fips: ["01003"] },
  ];
  const records = [
    { GeoFips: "01001", TimePeriod: "2023", DataValue: "10", NoteRef: "" },
    { GeoFips: "01003", TimePeriod: "2023", DataValue: "20", NoteRef: "" },
  ];

  assert.deepEqual(collectAreaFips(areas), ["01001", "01003"]);
  assert.deepEqual(chunkValues([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(
    aggregateByAreas(records, areas).map(({ areaName, year, total }) => ({ areaName, year, total })),
    [
      { areaName: "Area A", year: "2023", total: 30 },
      { areaName: "Area B", year: "2023", total: 20 },
    ],
  );
});

test("keeps an area with no BEA records as explicit no-data rows", () => {
  const result = aggregateByAreas(
    [{ GeoFips: "01001", TimePeriod: "2024", DataValue: "10", NoteRef: "" }],
    [{ id: "msa-pr", type: "msa", code: "x", name: "Unsupported Area", fips: ["72001"] }],
    ["2023", "2024"],
  );

  assert.equal(result.length, 2);
  assert.equal(result[0].status, "missing");
  assert.equal(result[0].missingReason, "no-record");
  assert.equal(result[1].total, null);
});

test("parses a BEA payload and request parameter list", () => {
  const parsed = parseBeaPayload({
    BEAAPI: {
      Request: {
        RequestParam: [
          { ParameterName: "METHOD", ParameterValue: "GETDATA" },
          { ParameterName: "GEOFIPS", ParameterValue: "13013,13035" },
        ],
      },
      Results: {
        UnitOfMeasure: "Thousands of dollars",
        Data: [{ TimePeriod: "2024", DataValue: "10" }],
      },
    },
  });

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.request.METHOD, "GETDATA");
  assert.equal(parsed.request.GEOFIPS, "13013,13035");
  assert.equal(parsed.meta.unit, "Thousands of dollars");
});

test("sanitizes an Excel filename", () => {
  assert.equal(sanitizeFilename(' GDP:Georgia?.xlsx '), "GDP_Georgia_");
});
