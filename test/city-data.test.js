import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const cityData = JSON.parse(fs.readFileSync("src/data/city-areas.json", "utf8"));

test("contains all 143 user-provided city definitions", () => {
  assert.deepEqual(cityData.counts, { city: 143, total: 143 });
  assert.equal(cityData.areas.length, 143);
  assert.match(cityData.source, /美国城市geofips\.xlsx · Sheet1/u);
});

test("stores stable city identifiers, bilingual names, and unique county GeoFIPS", () => {
  const ids = new Set();
  const codes = new Set();
  const names = new Set();

  cityData.areas.forEach((area) => {
    assert.equal(area.type, "city");
    assert.match(area.id, /^city-\d{3}$/u);
    assert.match(area.code, /^\d{3}$/u);
    assert.ok(area.name.trim());
    assert.ok(area.nameZh.trim());
    assert.ok(area.fips.length > 0);
    assert.equal(new Set(area.fips).size, area.fips.length);
    area.fips.forEach((fips) => assert.match(fips, /^\d{5}$/u));

    assert.equal(ids.has(area.id), false, `Duplicate city id: ${area.id}`);
    assert.equal(codes.has(area.code), false, `Duplicate city code: ${area.code}`);
    assert.equal(names.has(area.name), false, `Duplicate city name: ${area.name}`);
    ids.add(area.id);
    codes.add(area.code);
    names.add(area.name);
  });
});

test("preserves the New York city county mapping from the workbook", () => {
  const newYork = cityData.areas.find((area) => area.name === "New York");
  assert.ok(newYork);
  assert.equal(newYork.nameZh, "纽约");
  assert.deepEqual(newYork.fips, [
    "34003",
    "34017",
    "34031",
    "36005",
    "36047",
    "36061",
    "36079",
    "36081",
    "36085",
    "36087",
    "36119",
  ]);
});

test("uses the corrected Dayton county mapping", () => {
  const dayton = cityData.areas.find((area) => area.name === "Dayton");
  assert.ok(dayton);
  assert.equal(dayton.nameZh, "代顿");
  assert.deepEqual(dayton.fips, ["39057", "39109", "39113"]);
});

test("uses the corrected Chicago, Miami, and Richmond county mappings", () => {
  const expectedMappings = new Map([
    ["Chicago", ["17031", "17043", "17063", "17111", "17197"]],
    ["Miami", ["12086"]],
    ["Richmond", ["51760", "51041", "51087"]],
  ]);

  expectedMappings.forEach((expectedFips, name) => {
    const area = cityData.areas.find((candidate) => candidate.name === name);
    assert.ok(area, `Missing city definition: ${name}`);
    assert.deepEqual(area.fips, expectedFips);
  });
});
