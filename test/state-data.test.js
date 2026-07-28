import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const stateData = JSON.parse(fs.readFileSync("src/data/states.json", "utf8"));

test("provides the 50 states and District of Columbia for state search", () => {
  assert.equal(stateData.areas.length, 51);
  assert.equal(stateData.areas[0].name, "Alabama");
  assert.equal(
    stateData.areas.find((area) => area.name === "District of Columbia")?.fips[0],
    "11000",
  );
  assert.equal(stateData.areas.at(-1).name, "Wyoming");
});

test("uses unique two-digit state codes and five-digit BEA state GeoFips", () => {
  const codes = new Set();
  const fips = new Set();

  stateData.areas.forEach((area) => {
    assert.match(area.code, /^\d{2}$/u);
    assert.match(area.fips[0], /^\d{2}000$/u);
    codes.add(area.code);
    fips.add(area.fips[0]);
  });

  assert.equal(codes.size, stateData.areas.length);
  assert.equal(fips.size, stateData.areas.length);
});
