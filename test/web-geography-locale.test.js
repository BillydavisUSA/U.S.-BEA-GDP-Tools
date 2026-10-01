import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { buildAreaCountyRows, buildAreaYearMatrix } from "../src/excel.js";
import { buildGeographyCountyRows } from "../web/geography-tools.js";

const rootFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const fixtures = [
  { id: "state-36", type: "state", code: "36", name: "New York", nameZh: "纽约州", fips: ["36000"] },
  { id: "msa-35620", type: "msa", code: "35620", name: "New York-Newark-Jersey City, NY-NJ", nameZh: "纽约-纽瓦克-泽西市", fips: ["36061"] },
  { id: "city-new-york", type: "city", name: "New York", nameZh: "纽约", fips: ["36061"] },
  { id: "bay-area-san-francisco", type: "bay-area", name: "San Francisco Bay Area", nameZh: "旧金山湾区", fips: ["06075"] },
];

function makeElement() {
  return {
    hidden: true, value: "", textContent: "", options: [], dataset: {}, children: [],
    setAttribute() {}, addEventListener() {}, focus() {}, scrollIntoView() {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelector() { return makeElement(); },
  };
}

function loadPage() {
  const nodes = new Map();
  const document = {
    documentElement: {},
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, makeElement());
      return nodes.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return makeElement(); },
  };
  let workbook;
  const sandbox = {
    document,
    window: { navigator: { language: "en-US" }, localStorage: { getItem() {}, setItem() {} }, clearTimeout() {}, setTimeout() {} },
    metroDataset: { areas: fixtures.filter((area) => area.type === "msa") },
    stateDataset: { areas: fixtures.filter((area) => area.type === "state") },
    citySource: { cities: fixtures.filter((area) => area.type === "city") },
    bayAreaSource: { bayAreas: fixtures.filter((area) => area.type === "bay-area") },
    createCustomAreas: (areas) => areas,
    buildAreaYearMatrix, buildAreaCountyRows, buildGeographyCountyRows,
    isAggregatedGeographyLevel: (level) => ["metro", "city", "bay-area"].includes(level),
    sanitizeFilename: (value) => value,
    XLSXMock: {
      utils: {
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        aoa_to_sheet: (rows) => ({ rows: structuredClone(rows) }),
        book_append_sheet(book, sheet, name) { book.SheetNames.push(name); book.Sheets[name] = sheet; },
        encode_col: (index) => String.fromCharCode(65 + index),
      },
      writeFile(book) { workbook = book; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(rootFile("web/i18n.js").replace("export function createI18n", "function createI18n"), sandbox);
  const source = rootFile("web/main.js")
    .replace(/^import [\s\S]*?;\r?\n/gmu, "")
    .replaceAll("import.meta.env", "({})")
    .replace('await import("xlsx")', "await Promise.resolve(XLSXMock)")
    .split('elements.form.addEventListener("submit"')[0];
  vm.runInContext(`${source}\nthis.page = { state, elements, i18n, getAreaName, getAreaDetail, buildResultAreas, renderSearchResults, renderPreview, applyLanguage, exportExcel };`, sandbox);
  return { ...sandbox.page, getWorkbook: () => workbook };
}

function setupResult(page, area, level) {
  page.state.status = "success";
  page.state.resultLevel = level;
  page.state.resultAreas = [area];
  page.state.aggregated = [
    { areaId: area.id, areaName: area.name, areaType: area.type, year: "2024", total: 123.5, status: "ok" },
    { areaId: area.id, areaName: area.name, areaType: area.type, year: "2023", total: null, status: "missing" },
  ];
  page.state.parameters = { TABLENAME: level === "state" ? "SAGDP1" : "CAGDP1", LINECODE: "3" };
  page.state.records = [{ GeoFips: area.fips[0], GeoName: "Official county name, US", TimePeriod: "2024", DataValue: "123.5" }];
  page.elements.filename.value = "locale-test";
}

test("state result identities retain the selected Chinese name after the BEA response", () => {
  const page = loadPage();
  const areas = page.buildResultAreas([{ areaId: "state-36000", areaCode: "36", areaName: "New York" }], [fixtures[0]], "state");
  assert.equal(areas[0].id, "state-36000");
  page.i18n.setLanguage("zh");
  assert.equal(page.getAreaName(areas[0]), "纽约州");
  page.i18n.setLanguage("en");
  assert.equal(page.getAreaName(areas[0]), "New York");
});

test("both language names find the same geography and custom details expose no internal identifier", () => {
  const page = loadPage();
  for (const area of fixtures) {
    page.elements.geographyLevel.value = area.type === "msa" ? "metro" : area.type;
    for (const language of ["zh", "en"]) {
      page.i18n.setLanguage(language);
      for (const query of [area.name, area.nameZh]) {
        page.elements.areaSearch.value = query;
        page.renderSearchResults();
        const result = page.elements.searchResults.children[0];
        assert.equal(result.children[0].children[0].textContent, language === "zh" ? area.nameZh : area.name);
        assert.doesNotMatch(result.children[0].children[1].textContent, /undefined|99100/u);
      }
    }
  }
});

test("preview and workbook use the current language without changing BEA values or county names", async () => {
  const page = loadPage();
  for (const area of fixtures) {
    const level = area.type === "msa" ? "metro" : area.type;
    setupResult(page, area, level);
    for (const language of ["zh", "en"]) {
      page.i18n.setLanguage(language);
      page.renderPreview();
      const expectedName = language === "zh" ? area.nameZh : area.name;
      assert.equal(page.elements.resultBody.children[0].children[0].textContent, expectedName);
      await page.exportExcel();
      assert.equal(page.state.status, "success", page.state.errorMessage);
      const book = page.getWorkbook();
      const resultSheet = book.Sheets[book.SheetNames[0]];
      assert.equal(resultSheet.rows[2][0], language === "zh" ? "年份" : "Year");
      assert.deepEqual(resultSheet.rows[3], [expectedName, language === "zh" ? "无数据" : "No data", 123.5]);
      assert.equal(page.state.aggregated[0].areaName, area.name);
      assert.equal(page.state.records[0].GeoName, "Official county name, US");
      if (level !== "state") {
        const detail = book.Sheets[book.SheetNames[1]];
        const columns = level === "metro" ? 9 : 8;
        assert.ok(detail.rows.every((row) => row.length === columns));
        assert.equal(detail.rows[1][1], expectedName);
        assert.ok(detail.rows.some((row) => row.includes("Official county name, US")));
        assert.equal(detail["!autofilter"].ref, `A1:${columns === 9 ? "I" : "H"}${detail.rows.length}`);
      }
    }
  }
});

test("the country keeps localized result and export names", async () => {
  const page = loadPage();
  const area = { id: "country-us", type: "country", name: "United States", fips: [] };
  setupResult(page, area, "country");
  page.i18n.setLanguage("zh");
  await page.exportExcel();
  const workbook = page.getWorkbook();
  assert.equal(workbook.SheetNames[0], "国家");
  assert.equal(workbook.Sheets["国家"].rows[3][0], "美国");
});

test("changing language relabels the selected search text without reopening the suggestion list", () => {
  const page = loadPage();
  const area = fixtures[0];
  page.elements.geographyLevel.value = "state";
  page.state.selectionMode = "single";
  page.state.selectedAreas = [area];
  page.elements.areaSearch.value = area.name;
  page.elements.searchResults.hidden = true;
  page.applyLanguage("zh");
  assert.equal(page.elements.areaSearch.value, "纽约州");
  assert.equal(page.elements.selectionName.textContent, "纽约州");
  assert.equal(page.elements.searchResults.hidden, true);
  page.elements.areaSearch.value = "new";
  page.applyLanguage("en");
  assert.equal(page.elements.areaSearch.value, "new");
  assert.equal(page.elements.selectionName.textContent, "New York");
});
