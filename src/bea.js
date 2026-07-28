export const BEA_ENDPOINT = "https://apps.bea.gov/api/data/";

export const DEFAULT_PARAMETERS = Object.freeze({
  METHOD: "GETDATA",
  DATASETNAME: "REGIONAL",
  LINECODE: "3",
  TABLENAME: "CAGDP1",
  YEAR: "ALL",
  RESULTFORMAT: "JSON",
  USERID: "0124AA93-2482-4874-AAA1-C3F074F20A98",
});

export const TABLE_RULES = Object.freeze({
  CAGDP1: Object.freeze({
    defaultLineCode: "3",
    lineCodes: Object.freeze(["1", "3"]),
    minimumYear: null,
  }),
  CAINC1: Object.freeze({
    defaultLineCode: "2",
    lineCodes: Object.freeze(["2"]),
    minimumYear: 2001,
  }),
  SAGDP1: Object.freeze({
    defaultLineCode: "3",
    lineCodes: Object.freeze(["1", "3"]),
    minimumYear: null,
  }),
  SAINC1: Object.freeze({
    defaultLineCode: "2",
    lineCodes: Object.freeze(["2"]),
    minimumYear: null,
  }),
});

const PARAMETER_ALIASES = Object.freeze({
  METHOD: "METHOD",
  DATASETNAME: "DATASETNAME",
  FREQUENCY: "FREQUENCY",
  GEOFIPS: "GEOFIPS",
  LINECODE: "LINECODE",
  TABLENAME: "TABLENAME",
  YEAR: "YEAR",
  RESULTFORMAT: "RESULTFORMAT",
  USERID: "USERID",
});

/**
 * Accept comma/newline/whitespace separated geography codes and turn them into
 * the comma-delimited form required by BEA. Duplicate codes are removed while
 * their first-seen order is retained.
 */
export function normalizeCodes(value) {
  const codes = String(value ?? "")
    .split(/[,;\uFF0C\uFF1B\s]+/u)
    .map((code) => code.trim())
    .filter(Boolean);

  return [...new Set(codes)].join(",");
}

export function getCodeList(value) {
  const normalized = normalizeCodes(value);
  return normalized ? normalized.split(",") : [];
}

export function normalizeGeoFips(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/gu, "");
  return /^\d{1,5}$/u.test(normalized) ? normalized.padStart(5, "0") : normalized;
}

export function collectAreaFips(areas) {
  const fips = new Set();
  areas.forEach((area) => {
    (area?.fips ?? []).forEach((code) => {
      const normalized = normalizeGeoFips(code);
      if (/^\d{5}$/u.test(normalized)) fips.add(normalized);
    });
  });
  return [...fips].sort();
}

export function chunkValues(values, size = 75) {
  const safeSize = Math.max(1, Math.floor(size));
  const chunks = [];
  for (let index = 0; index < values.length; index += safeSize) {
    chunks.push(values.slice(index, index + safeSize));
  }
  return chunks;
}

export function validateCodes(value) {
  const codes = getCodeList(value);
  if (codes.length === 0) {
    return { valid: false, message: "Enter at least one geography code.", codes };
  }

  const invalid = codes.filter((code) => !/^[A-Za-z0-9_-]+$/u.test(code));
  if (invalid.length > 0) {
    return {
      valid: false,
      message: `Unrecognized geography codes: ${invalid.slice(0, 3).join(", ")}`,
      codes,
    };
  }

  return { valid: true, message: "", codes };
}

export function sanitizeFilename(value) {
  const withoutExtension = String(value ?? "")
    .trim()
    .replace(/\.xlsx$/iu, "")
    .replace(/[\\/:*?"<>|]/gu, "_")
    .replace(/[.\s]+$/gu, "")
    .slice(0, 120);

  return withoutExtension || "BEA_Gross_Domestic_Product";
}

export function buildRequestParameters(input) {
  const tableName = String(input.tableName || DEFAULT_PARAMETERS.TABLENAME).toUpperCase();
  const tableRule = TABLE_RULES[tableName];
  const requestedLineCode = String(input.lineCode || DEFAULT_PARAMETERS.LINECODE);
  const lineCode = tableRule?.lineCodes.includes(requestedLineCode)
    ? requestedLineCode
    : tableRule?.defaultLineCode ?? requestedLineCode;

  return {
    METHOD: DEFAULT_PARAMETERS.METHOD,
    DATASETNAME: input.datasetName || DEFAULT_PARAMETERS.DATASETNAME,
    GEOFIPS: normalizeCodes(input.geoFips),
    LINECODE: lineCode,
    TABLENAME: tableName,
    YEAR: input.year || DEFAULT_PARAMETERS.YEAR,
    RESULTFORMAT: DEFAULT_PARAMETERS.RESULTFORMAT,
    USERID: input.userId || DEFAULT_PARAMETERS.USERID,
  };
}

export function expandNipaYearSelection(value, firstYear, lastYear) {
  const selection = String(value || "ALL").toUpperCase();
  if (!["LAST5", "LAST10"].includes(selection)) return selection;

  const count = selection === "LAST5" ? 5 : 10;
  const first = Number(firstYear);
  const last = Number(lastYear);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) return "ALL";

  const start = Math.max(first, last - count + 1);
  return Array.from({ length: last - start + 1 }, (_, index) => String(start + index)).join(",");
}

/**
 * Build an official NIPA request. Frequency controls annual/quarterly data;
 * ShowMillions is intentionally omitted because it is not a NIPA parameter.
 */
export function buildNipaRequestParameters(input) {
  const frequency = String(input.frequency || "A").toUpperCase() === "Q" ? "Q" : "A";
  const tableName = String(input.tableName || "T10105").toUpperCase();

  return {
    METHOD: DEFAULT_PARAMETERS.METHOD,
    DATASETNAME: "NIPA",
    TABLENAME: tableName,
    FREQUENCY: frequency,
    YEAR: expandNipaYearSelection(input.year, input.firstYear, input.lastYear),
    RESULTFORMAT: DEFAULT_PARAMETERS.RESULTFORMAT,
    USERID: input.userId || DEFAULT_PARAMETERS.USERID,
  };
}

/** Apply the supported year range for a BEA table before aggregation/export. */
export function filterRecordsForTable(records, tableName) {
  const minimumYear = TABLE_RULES[String(tableName ?? "").toUpperCase()]?.minimumYear;
  if (!minimumYear) return [...records];

  return records.filter((record) => {
    const year = Number(String(record?.TimePeriod ?? "").trim());
    return Number.isFinite(year) && year >= minimumYear;
  });
}

export function buildBeaUrl(parameters, endpoint = BEA_ENDPOINT) {
  const query = new URLSearchParams();
  Object.entries(parameters).forEach(([name, value]) => query.set(name, value));
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}${query.toString()}`;
}

function toResultObject(results) {
  if (Array.isArray(results)) {
    return results.find((item) => item && (item.Data || item.Error)) ?? results[0] ?? {};
  }
  return results ?? {};
}

function getErrorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (Array.isArray(error)) return error.map(getErrorMessage).filter(Boolean).join("; ");

  return (
    error.APIErrorDescription ||
    error.ErrorDetail?.Description ||
    error.Description ||
    error.Message ||
    error.message ||
    "The BEA API returned an error."
  );
}

/** Extract request parameters and data records from a BEA API response. */
export function parseBeaPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("The JSON file is empty or invalid.");
  }

  const apiRoot = payload.BEAAPI ?? payload;
  const results = toResultObject(apiRoot.Results ?? apiRoot.results);
  const apiError = results.Error ?? results.error ?? apiRoot.Error ?? apiRoot.error;

  if (apiError) {
    throw new Error(getErrorMessage(apiError));
  }

  const records = results.Data ?? results.data;
  if (!Array.isArray(records)) {
    throw new Error("The BEAAPI.Results.Data array was not found.");
  }

  const requestParams = apiRoot.Request?.RequestParam ?? apiRoot.request?.requestParam ?? [];
  const request = {};
  if (Array.isArray(requestParams)) {
    requestParams.forEach((item) => {
      const rawName = String(item?.ParameterName ?? item?.parameterName ?? "").toUpperCase();
      const name = PARAMETER_ALIASES[rawName];
      if (name) request[name] = String(item?.ParameterValue ?? item?.parameterValue ?? "");
    });
  }

  const firstRecord = records.find((record) => record && typeof record === "object") ?? {};
  const unitMultiplier = Number.parseInt(String(firstRecord.UNIT_MULT ?? ""), 10);
  const inferredUnit = unitMultiplier === 6
    ? "Millions of dollars"
    : Number.isInteger(unitMultiplier)
      ? `10^${unitMultiplier} units`
      : "";

  return {
    records,
    request,
    meta: {
      statistic: results.Statistic ?? firstRecord.LineDescription ?? "BEA measure",
      unit: results.UnitOfMeasure ?? inferredUnit ?? "",
      publicTable: results.PublicTable ?? "",
      productionTime: results.UTCProductionTime ?? "",
    },
  };
}

export function parseDataValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;

  let normalized = String(value).trim().replace(/,/gu, "");
  if (!normalized || /^(?:N\/A|NA|---|\(D\)|\(L\))$/iu.test(normalized)) return null;

  const isParentheticalNegative = /^\([+-]?[\d.]+\)$/u.test(normalized);
  if (isParentheticalNegative) normalized = `-${normalized.slice(1, -1)}`;

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function comparePeriods(a, b) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return String(a).localeCompare(String(b), "en-US", { numeric: true });
}

/**
 * Group BEA rows by TimePeriod and sum non-zero DataValue values. Zero-value
 * county rows are excluded even when they carry NoteRef; non-zero values are
 * included regardless of NoteRef. A period is "No data" only when every county
 * value is zero (or a value cannot be parsed).
 */
export function aggregateByYear(records) {
  const groups = new Map();

  records.forEach((record) => {
    const year = String(record?.TimePeriod ?? "").trim();
    if (!year) return;

    if (!groups.has(year)) {
      groups.set(year, {
        year,
        total: 0,
        recordCount: 0,
        validCount: 0,
        zeroCount: 0,
        invalidCount: 0,
        noteRefs: new Set(),
      });
    }

    const group = groups.get(year);
    const noteRef = String(record?.NoteRef ?? "").trim();
    const value = parseDataValue(record?.DataValue);
    group.recordCount += 1;

    if (value === null) {
      group.invalidCount += 1;
      return;
    }

    if (noteRef) group.noteRefs.add(noteRef);

    if (value === 0) {
      group.zeroCount += 1;
      return;
    }

    group.total += value;
    group.validCount += 1;
  });

  return [...groups.values()]
    .sort((a, b) => comparePeriods(a.year, b.year))
    .map((group) => {
      const hasUsableData = group.validCount > 0;
      const isComplete = hasUsableData && group.invalidCount === 0;
      const allZero = group.recordCount > 0 && group.zeroCount === group.recordCount;

      return {
        ...group,
        total: isComplete ? group.total : null,
        status: isComplete ? "ok" : "missing",
        missingReason: isComplete ? "" : allZero ? "zero" : "invalid",
        noteRefs: [...group.noteRefs],
      };
    });
}

/** Aggregate a shared BEA response independently for every selected MSA/CSA. */
export function aggregateByAreas(records, areas, periods = []) {
  const recordsByFips = new Map();

  records.forEach((record) => {
    const fips = normalizeGeoFips(record?.GeoFips);
    if (!recordsByFips.has(fips)) recordsByFips.set(fips, []);
    recordsByFips.get(fips).push(record);
  });

  const requestedPeriods = [...new Set(periods.map((period) => String(period).trim()).filter(Boolean))]
    .sort(comparePeriods);

  return areas.flatMap((area) => {
    const areaRecords = [];
    const areaFips = new Set((area?.fips ?? []).map(normalizeGeoFips));
    areaFips.forEach((fips) => areaRecords.push(...(recordsByFips.get(fips) ?? [])));

    const aggregated = aggregateByYear(areaRecords);
    const rowsByPeriod = new Map(aggregated.map((row) => [row.year, row]));
    const rows = requestedPeriods.length > 0
      ? requestedPeriods.map((period) => rowsByPeriod.get(period) ?? {
          year: period,
          total: null,
          recordCount: 0,
          validCount: 0,
          zeroCount: 0,
          invalidCount: 1,
          noteRefs: [],
          status: "missing",
          missingReason: "no-record",
        })
      : aggregated;

    return rows.map((row) => ({
        ...row,
        areaId: area.id,
        areaType: area.type,
        areaCode: area.code ?? "",
        areaName: area.name,
      }));
  });
}

/**
 * Convert BEA state records into result rows without county aggregation.
 * When an allowlist is supplied, BEA regional summary rows are excluded.
 */
export function mapStateRecords(records, allowedGeoFips = []) {
  const allowed = new Set(
    allowedGeoFips
      .map(normalizeGeoFips)
      .filter((geoFips) => /^\d{2}000$/u.test(geoFips)),
  );

  return records
    .map((record) => {
      const geoFips = normalizeGeoFips(record?.GeoFips);
      const year = String(record?.TimePeriod ?? "").trim();
      const areaName = String(record?.GeoName ?? "").trim();
      const value = parseDataValue(record?.DataValue);

      if (
        !/^\d{2}000$/u.test(geoFips)
        || geoFips === "00000"
        || (allowed.size > 0 && !allowed.has(geoFips))
        || !year
        || !areaName
      ) {
        return null;
      }

      return {
        areaId: `state-${geoFips}`,
        areaType: "state",
        areaCode: geoFips.slice(0, 2),
        areaName,
        year,
        total: value,
        recordCount: 1,
        validCount: value === null ? 0 : 1,
        zeroCount: value === 0 ? 1 : 0,
        invalidCount: value === null ? 1 : 0,
        noteRefs: String(record?.NoteRef ?? "").trim()
          ? [String(record.NoteRef).trim()]
          : [],
        status: value === null ? "missing" : "ok",
        missingReason: value === null ? "invalid" : "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => (
      a.areaName.localeCompare(b.areaName, "en-US")
      || comparePeriods(a.year, b.year)
    ));
}

function createCountryRow(record, total, overrides = {}) {
  const noteRef = String(record?.NoteRef ?? "").trim();
  const isValid = total !== null;
  return {
    areaId: "country-us",
    areaType: "country",
    areaCode: "US",
    areaName: "United States",
    year: String(record?.TimePeriod ?? "").trim(),
    total,
    recordCount: overrides.recordCount ?? 1,
    validCount: isValid ? overrides.validCount ?? 1 : 0,
    zeroCount: total === 0 ? 1 : 0,
    invalidCount: isValid ? 0 : 1,
    noteRefs: overrides.noteRefs ?? (noteRef ? [noteRef] : []),
    status: isValid ? "ok" : "missing",
    missingReason: isValid ? "" : "invalid",
    calculated: Boolean(overrides.calculated),
  };
}

/**
 * Keep only NIPA GDP line 1. Quarterly cumulative mode returns Q1, Q1+Q2,
 * and Q1+Q2+Q3 for each year; Q4 is deliberately omitted.
 */
export function mapCountryGdpRecords(records, { cumulativeQuarterly = false } = {}) {
  const targetRecords = records
    .filter((record) => (
      String(record?.LineNumber ?? "").trim() === "1"
      && String(record?.LineDescription ?? "").trim() === "Gross domestic product"
      && String(record?.TimePeriod ?? "").trim()
    ))
    .sort((a, b) => comparePeriods(a.TimePeriod, b.TimePeriod));

  if (!cumulativeQuarterly) {
    return targetRecords.map((record) => createCountryRow(
      record,
      parseDataValue(record.DataValue),
    ));
  }

  const recordsByYear = new Map();
  targetRecords.forEach((record) => {
    const match = /^(\d{4})Q([1-4])$/u.exec(String(record.TimePeriod).trim());
    if (!match || match[2] === "4") return;
    if (!recordsByYear.has(match[1])) recordsByYear.set(match[1], new Map());
    recordsByYear.get(match[1]).set(Number(match[2]), record);
  });

  const rows = [];
  [...recordsByYear.entries()]
    .sort(([a], [b]) => comparePeriods(a, b))
    .forEach(([, quarterRecords]) => {
      let runningTotal = 0;
      let complete = true;
      const noteRefs = new Set();

      for (let quarter = 1; quarter <= 3; quarter += 1) {
        const record = quarterRecords.get(quarter);
        if (!record) {
          complete = false;
          continue;
        }

        const value = parseDataValue(record.DataValue);
        const noteRef = String(record.NoteRef ?? "").trim();
        if (noteRef) noteRefs.add(noteRef);
        if (value === null) complete = false;
        else runningTotal += value;

        rows.push(createCountryRow(
          record,
          complete ? runningTotal : null,
          {
            calculated: true,
            recordCount: quarter,
            validCount: complete ? quarter : 0,
            noteRefs: [...noteRefs],
          },
        ));
      }
    });

  return rows;
}

export function applyImportedParameters(current, imported = {}) {
  return {
    datasetName: imported.DATASETNAME || current.datasetName,
    geoFips: imported.GEOFIPS ? normalizeCodes(imported.GEOFIPS) : current.geoFips,
    lineCode: imported.LINECODE || current.lineCode,
    tableName: imported.TABLENAME || current.tableName,
    year: imported.YEAR || current.year,
    userId: imported.USERID || current.userId,
  };
}
