import {
  aggregateByAreas,
  normalizeGeoFips,
  parseDataValue,
} from "../src/bea.js";

const CUSTOM_AREA_TYPES = Object.freeze(["city", "bay-area"]);
const AGGREGATED_LEVELS = Object.freeze(["metro", ...CUSTOM_AREA_TYPES]);

function comparePeriods(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return String(a).localeCompare(String(b), "en-US", { numeric: true });
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), "en-US", { numeric: true });
}

function normalizeFipsList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeGeoFips)
    .filter((value) => /^\d{5}$/u.test(value)))]
    .sort(compareText);
}

function normalizeCoverage(entries, availableFips) {
  if (!Array.isArray(entries) || entries.length === 0) return Object.freeze([]);
  const available = new Set(availableFips);
  const normalized = entries.map((entry) => {
    const from = Number.parseInt(entry?.from, 10);
    const to = entry?.to == null ? null : Number.parseInt(entry.to, 10);
    const fips = normalizeFipsList(entry?.geoFips ?? entry?.fips);
    if (!Number.isInteger(from) || (to !== null && (!Number.isInteger(to) || to < from))) {
      throw new Error("Custom geography coverage has an invalid year range.");
    }
    if (fips.length === 0 || fips.some((code) => !available.has(code))) {
      throw new Error("Custom geography coverage must use its declared GeoFips codes.");
    }
    return Object.freeze({ from, ...(to === null ? {} : { to }), fips: Object.freeze(fips) });
  }).sort((a, b) => a.from - b.from);

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    if (previous.to == null || normalized[index].from <= previous.to) {
      throw new Error("Custom geography coverage year ranges must not overlap.");
    }
  }
  return Object.freeze(normalized);
}

export function createCustomAreas(entries, type) {
  if (!CUSTOM_AREA_TYPES.includes(type)) {
    throw new Error(`Unsupported custom geography type: ${type}`);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`No ${type} definitions were provided.`);
  }

  const seen = new Set();
  return Object.freeze(entries.map((entry) => {
    const slug = String(entry?.id ?? "").trim();
    const name = String(entry?.nameEn ?? "").trim();
    const nameZh = String(entry?.nameZh ?? "").trim();
    const fips = normalizeFipsList(entry?.geoFips);
    const area = Number(entry?.area);
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(slug) || seen.has(slug)) {
      throw new Error(`Custom geography has an invalid or duplicate ID: ${slug}`);
    }
    if (!name || !nameZh || fips.length === 0 || !Number.isFinite(area) || area <= 0) {
      throw new Error(`Custom geography ${slug} is missing required metadata.`);
    }
    seen.add(slug);
    return Object.freeze({
      id: `${type}-${slug}`,
      type,
      name,
      nameZh,
      area,
      fips: Object.freeze(fips),
      coverage: normalizeCoverage(entry?.coverage, fips),
    });
  }));
}

export function isAggregatedGeographyLevel(level) {
  return AGGREGATED_LEVELS.includes(String(level));
}

export function getAreaFipsForPeriod(area, period) {
  const coverage = Array.isArray(area?.coverage) ? area.coverage : [];
  if (coverage.length === 0) return normalizeFipsList(area?.fips);
  const year = Number.parseInt(String(period ?? "").slice(0, 4), 10);
  if (!Number.isInteger(year)) return [];
  const match = coverage.find((entry) => (
    year >= entry.from && (entry.to == null || year <= entry.to)
  ));
  return match ? normalizeFipsList(match.fips) : [];
}

export function aggregateByAreasWithCoverage(records, areas, periods = []) {
  if (!areas.some((area) => Array.isArray(area?.coverage) && area.coverage.length > 0)) {
    return aggregateByAreas(records, areas, periods);
  }
  const requestedPeriods = [...new Set([
    ...periods,
    ...records.map((record) => record?.TimePeriod),
  ].map((period) => String(period ?? "").trim()).filter(Boolean))].sort(comparePeriods);
  if (requestedPeriods.length === 0) return [];

  const rowsByAreaAndPeriod = new Map();
  requestedPeriods.forEach((period) => {
    const areasForPeriod = areas.map((area) => ({
      ...area,
      fips: getAreaFipsForPeriod(area, period),
    }));
    aggregateByAreas(records, areasForPeriod, [period]).forEach((row) => {
      rowsByAreaAndPeriod.set(`${row.areaId}\u0000${row.year}`, row);
    });
  });

  return areas.flatMap((area) => requestedPeriods
    .map((period) => rowsByAreaAndPeriod.get(`${area.id}\u0000${period}`))
    .filter(Boolean));
}

export function buildGeographyCountyRows(records, areas, periods = []) {
  if (!areas.length) return [];
  const recordIndex = new Map();
  const countyNames = new Map();
  records.forEach((record) => {
    const fips = normalizeGeoFips(record?.GeoFips);
    const period = String(record?.TimePeriod ?? "").trim();
    if (!/^\d{5}$/u.test(fips) || !period) return;
    recordIndex.set(`${fips}\u0000${period}`, record);
    const countyName = String(record?.GeoName ?? "").trim();
    if (countyName && !countyNames.has(fips)) countyNames.set(fips, countyName);
  });

  const requestedPeriods = [...new Set([
    ...periods,
    ...records.map((record) => record?.TimePeriod),
  ].map((period) => String(period ?? "").trim()).filter(Boolean))].sort(comparePeriods);
  const rows = [];
  [...areas]
    .sort((a, b) => compareText(a.type, b.type) || compareText(a.name, b.name))
    .forEach((area) => {
      const allFips = normalizeFipsList(area.fips);
      allFips.forEach((fips) => {
        requestedPeriods.forEach((period) => {
          if (!getAreaFipsForPeriod(area, period).includes(fips)) return;
          const record = recordIndex.get(`${fips}\u0000${period}`);
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
            fips,
            String(record?.GeoName ?? countyNames.get(fips) ?? "").trim(),
            period,
            value,
            noteRef,
            status,
          ]);
        });
      });
    });

  return [
    ["Geography type", "Geography name", "County GeoFips", "County name", "Year", "DataValue", "NoteRef", "Aggregation status"],
    ...rows,
  ];
}
