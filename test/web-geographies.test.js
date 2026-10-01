import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  aggregateByAreasWithCoverage,
  buildGeographyCountyRows,
  createCustomAreas,
  getAreaFipsForPeriod,
  isAggregatedGeographyLevel,
} from "../web/geography-tools.js";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

const citySource = readJson("web/data/bea-us-city-geofips.json");
const bayAreaSource = readJson("web/data/bea-us-bay-area-geofips.json");
const cities = createCustomAreas(citySource.cities, "city");
const bayAreas = createCustomAreas(bayAreaSource.bayAreas, "bay-area");

test("web geography levels include 267 cities and 8 bay areas", () => {
  assert.equal(cities.length, 267);
  assert.equal(bayAreas.length, 8);
  assert.equal(new Set(cities.map((area) => area.id)).size, cities.length);
  assert.equal(new Set(bayAreas.map((area) => area.id)).size, bayAreas.length);
  assert.ok(cities.every((area) => area.type === "city" && /^city-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(area.id)));
  assert.ok(bayAreas.every((area) => (
    area.type === "bay-area" && /^bay-area-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(area.id)
  )));
  assert.equal(cities.reduce((total, area) => total + area.fips.length, 0), 491);
  assert.equal(new Set(cities.flatMap((area) => area.fips)).size, 486);
  assert.ok([...cities, ...bayAreas].every((area) => (
    area.fips.length > 0 && area.fips.length === new Set(area.fips).size
  )));
});

test("web custom geography data retains reviewed normalization rules", () => {
  const petersburg = cities.find((area) => area.id === "city-petersburg");
  const kissimmee = cities.find((area) => area.id === "city-kissimmee");
  const sanFrancisco = bayAreas.find((area) => area.id === "bay-area-san-francisco-bay-area");
  assert.deepEqual(petersburg.fips, ["51918", "51941"]);
  assert.equal(kissimmee.name, "Kissimmee");
  assert.equal(sanFrancisco.name, "San Francisco Bay Area");
  assert.equal(sanFrancisco.nameZh, "旧金山大湾区");
  assert.equal(isAggregatedGeographyLevel("metro"), true);
  assert.equal(isAggregatedGeographyLevel("city"), true);
  assert.equal(isAggregatedGeographyLevel("bay-area"), true);
  assert.equal(isAggregatedGeographyLevel("state"), false);
});

test("Connecticut coverage selects the correct GeoFips for each year", () => {
  const newYorkBay = bayAreas.find((area) => area.id === "bay-area-new-york-bay-area");
  const newLondon = cities.find((area) => area.id === "city-new-london");
  const oldFips = getAreaFipsForPeriod(newYorkBay, "2023");
  const currentFips = getAreaFipsForPeriod(newYorkBay, "2024");
  assert.ok(oldFips.includes("09001"));
  assert.ok(!oldFips.includes("09120"));
  assert.ok(!oldFips.includes("09190"));
  assert.ok(!currentFips.includes("09001"));
  assert.ok(currentFips.includes("09120"));
  assert.ok(currentFips.includes("09190"));
  assert.deepEqual(getAreaFipsForPeriod(newLondon, "2023"), ["09011"]);
  assert.deepEqual(getAreaFipsForPeriod(newLondon, "2024"), ["09180"]);
});

test("bay-area aggregation and county detail honor year-specific coverage", () => {
  const newYorkBay = bayAreas.find((area) => area.id === "bay-area-new-york-bay-area");
  const records = [
    { GeoFips: "09001", GeoName: "Fairfield", TimePeriod: "2023", DataValue: "10" },
    { GeoFips: "09120", GeoName: "Greater Bridgeport", TimePeriod: "2023", DataValue: "100" },
    { GeoFips: "09190", GeoName: "Western Connecticut", TimePeriod: "2023", DataValue: "200" },
    { GeoFips: "34003", GeoName: "Bergen", TimePeriod: "2023", DataValue: "1" },
    { GeoFips: "09001", GeoName: "Fairfield", TimePeriod: "2024", DataValue: "10" },
    { GeoFips: "09120", GeoName: "Greater Bridgeport", TimePeriod: "2024", DataValue: "100" },
    { GeoFips: "09190", GeoName: "Western Connecticut", TimePeriod: "2024", DataValue: "200" },
    { GeoFips: "34003", GeoName: "Bergen", TimePeriod: "2024", DataValue: "1" },
  ];
  const rows = aggregateByAreasWithCoverage(records, [newYorkBay], ["2023", "2024"]);
  assert.deepEqual(rows.map((row) => [row.year, row.total]), [
    ["2023", 11],
    ["2024", 301],
  ]);

  const detail = buildGeographyCountyRows(records, [newYorkBay], ["2023", "2024"]);
  assert.ok(detail.some((row) => row[2] === "09001" && row[4] === "2023"));
  assert.ok(!detail.some((row) => row[2] === "09001" && row[4] === "2024"));
  assert.ok(!detail.some((row) => row[2] === "09120" && row[4] === "2023"));
  assert.ok(detail.some((row) => row[2] === "09120" && row[4] === "2024"));
});

test("web page exposes metro, city, bay-area, state, and country levels", () => {
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.deepEqual(
    [...html.matchAll(/<option value="([^"]+)" data-i18n="scope\./gu)]
      .map((match) => match[1]),
    ["metro", "city", "bay-area", "state", "country"],
  );
});

test("custom geographies expose readable IDs and bilingual names without private metadata", () => {
  const allowedSourceFields = new Set(["id", "nameZh", "nameEn", "area", "geoFips", "coverage"]);
  for (const item of [...citySource.cities, ...bayAreaSource.bayAreas]) {
    assert.match(item.id, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
    assert.match(item.nameZh, /[\u3400-\u9fff]/u);
    for (const field of Object.keys(item)) assert.ok(allowedSourceFields.has(field), field);
  }
  for (const area of [...cities, ...bayAreas]) assert.equal(Object.hasOwn(area, "code"), false);
  const rows = buildGeographyCountyRows([], [cities[0]], ["2024"]);
  assert.equal(rows[0].length, 8);
  assert.deepEqual(rows[0].slice(0, 4), ["Geography type", "Geography name", "County GeoFips", "County name"]);
  assert.ok(rows.every((row) => row.length === 8));
  assert.ok(rows.slice(1).every((row) => /^\d{5}$/u.test(row[2])));
});

test("custom geography IDs reject duplicates and non-slug values", () => {
  const valid = citySource.cities[0];
  assert.throws(() => createCustomAreas([valid, valid], "city"), /duplicate ID/u);
  for (const id of ["", "12345", "New York", "new_york", "../../city"]) {
    assert.throws(() => createCustomAreas([{ ...valid, id }], "city"), /invalid or duplicate ID/u);
  }
});
