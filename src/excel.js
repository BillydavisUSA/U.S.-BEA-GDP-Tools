import { normalizeGeoFips, parseDataValue } from "./bea.js";

function compareYears(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return String(a).localeCompare(String(b), "en-US", { numeric: true });
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "en-US", { numeric: true });
}

/** Build the horizontal area-by-year layout used by the exported workbook. */
export function buildAreaYearMatrix(
  rows,
  typeLabel,
  metricLabel = "Gross domestic product (thousands of dollars)",
  typeHeading = "Metro area type",
) {
  const years = [...new Set(rows.map((row) => String(row.year)))].sort(compareYears);
  const areaNames = [...new Set(rows.map((row) => row.areaName))]
    .sort((a, b) => a.localeCompare(b, "en-US"));
  const values = new Map();

  rows.forEach((row) => {
    values.set(
      `${row.areaName}\u0000${row.year}`,
      row.status === "ok" ? row.total : "No data",
    );
  });

  return {
    years,
    rows: [
      [typeHeading, typeLabel],
      [metricLabel],
      ["Year", ...years],
      ...areaNames.map((areaName) => [
        areaName,
        ...years.map((year) => values.get(`${areaName}\u0000${year}`) ?? "No data"),
      ]),
    ],
  };
}

/** Build detailed county rows for MSA/CSA or web-only city aggregates. */
export function buildAreaCountyRows(
  records,
  areas,
  periods = [],
  { scopeLabel = "Metro area" } = {},
) {
  const aggregateAreas = areas.filter((area) => (
    area?.type === "msa" || area?.type === "csa" || area?.type === "city"
  ));
  if (aggregateAreas.length === 0) return [];

  const recordIndex = new Map();
  const countyNames = new Map();
  records.forEach((record) => {
    const fips = normalizeGeoFips(record?.GeoFips);
    const year = String(record?.TimePeriod ?? "").trim();
    if (!/^\d{5}$/u.test(fips) || !year) return;
    recordIndex.set(`${fips}\u0000${year}`, record);
    const countyName = String(record?.GeoName ?? "").trim();
    if (countyName && !countyNames.has(fips)) countyNames.set(fips, countyName);
  });

  const years = [...new Set([
    ...periods.map((period) => String(period).trim()).filter(Boolean),
    ...records.map((record) => String(record?.TimePeriod ?? "").trim()).filter(Boolean),
  ])].sort(compareYears);

  const rows = [];
  [...aggregateAreas]
    .sort((a, b) => compareText(a.type, b.type) || compareText(a.name, b.name))
    .forEach((area) => {
      [...new Set((area.fips ?? []).map(normalizeGeoFips))]
        .sort(compareText)
        .forEach((fips) => {
          years.forEach((year) => {
            const record = recordIndex.get(`${fips}\u0000${year}`);
            const noteRef = String(record?.NoteRef ?? "").trim();
            const parsedValue = record ? parseDataValue(record.DataValue) : null;
            const rawValue = String(record?.DataValue ?? "").trim();
            const value = parsedValue ?? rawValue;
            const status = !record
              ? "No BEA data"
              : parsedValue === null
                ? "Invalid data"
                : parsedValue === 0 ? "Excluded" : "Included";

            rows.push([
              area.type.toUpperCase(),
              area.name,
              area.code ?? "",
              fips,
              String(record?.GeoName ?? countyNames.get(fips) ?? "").trim(),
              year,
              value,
              noteRef,
              status,
            ]);
          });
        });
    });

  return [
    [`${scopeLabel} type`, `${scopeLabel} name`, `${scopeLabel} code`, "County GeoFips", "County name", "Year", "DataValue", "NoteRef", "Aggregation status"],
    ...rows,
  ];
}
