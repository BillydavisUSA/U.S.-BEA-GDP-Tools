import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  VIRGINIA_BEA_REPLACED_FIPS,
} from "../scripts/virginia-bea-geofips.mjs";

const metroData = JSON.parse(fs.readFileSync("src/data/metro-areas.json", "utf8"));

test("contains the expected 2023 MSA and CSA groups", () => {
  assert.deepEqual(metroData.counts, { msa: 393, csa: 184, total: 577 });
  assert.equal(metroData.areas.filter((area) => area.type === "msa").length, 393);
  assert.equal(metroData.areas.filter((area) => area.type === "csa").length, 184);
});

test("stores unique five-digit county GeoFips for every area", () => {
  metroData.areas.forEach((area) => {
    assert.ok(area.name);
    assert.ok(area.fips.length > 0);
    assert.equal(new Set(area.fips).size, area.fips.length);
    area.fips.forEach((fips) => assert.match(fips, /^\d{5}$/u));
  });
});

test("groups CSA rows by title and preserves the Abilene composition", () => {
  const area = metroData.areas.find((item) => item.name === "Abilene-Sweetwater, TX");
  assert.equal(area.type, "csa");
  assert.deepEqual(area.fips, ["48059", "48253", "48353", "48441"]);
});

test("preserves the corrected Connecticut county and planning-region ranges", () => {
  const bridgeport = metroData.areas.find((item) => item.code === "14860");
  const hartford = metroData.areas.find((item) => item.code === "25540");
  const connecticutCsa = metroData.areas.find((item) => item.code === "405");

  assert.deepEqual(bridgeport.fips, ["09001", "09120", "09190"]);
  assert.deepEqual(hartford.fips, ["09003", "09007", "09013", "09110", "09130"]);
  assert.deepEqual(connecticutCsa.fips, [
    "09003", "09005", "09007", "09009", "09011", "09013", "09015",
    "09110", "09130", "09140", "09150", "09160", "09170", "09180",
  ]);
});

test("uses BEA Virginia combination GeoFIPS without double-counting member jurisdictions", () => {
  const allAreaFips = new Set(metroData.areas.flatMap((area) => area.fips));
  VIRGINIA_BEA_REPLACED_FIPS.forEach((fips) => {
    assert.equal(allAreaFips.has(fips), false, `${fips} should use its BEA combination GeoFIPS`);
  });

  const washington = metroData.areas.find(
    (area) => area.type === "msa" && area.code === "47900",
  );
  const virginiaBeach = metroData.areas.find(
    (area) => area.type === "msa" && area.code === "47260",
  );
  const roanoke = metroData.areas.find(
    (area) => area.type === "msa" && area.code === "40220",
  );

  assert.ok(washington.fips.includes("51919"));
  assert.ok(washington.fips.includes("51942"));
  assert.ok(washington.fips.includes("51951"));
  assert.ok(washington.fips.includes("51510"));
  assert.ok(virginiaBeach.fips.includes("51931"));
  assert.ok(virginiaBeach.fips.includes("51958"));
  assert.ok(virginiaBeach.fips.includes("51550"));
  assert.ok(roanoke.fips.includes("51944"));
  assert.ok(roanoke.fips.includes("51770"));
});
