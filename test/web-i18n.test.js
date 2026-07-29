import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readProjectFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function collectMessageKeys(source) {
  return new Set(
    [...source.matchAll(/^\s*"([^"]+)":/gmu)].map((match) => match[1]),
  );
}

test("web English and Chinese translations have complete key parity", () => {
  const source = readProjectFile("web/i18n.js");
  const englishStart = source.indexOf("en: Object.freeze({");
  const chineseStart = source.indexOf("zh: Object.freeze({");
  const english = collectMessageKeys(source.slice(englishStart, chineseStart));
  const chinese = collectMessageKeys(source.slice(chineseStart));

  assert.deepEqual([...english].sort(), [...chinese].sort());
});

test("every web translation reference exists in both languages", () => {
  const source = readProjectFile("web/i18n.js");
  const html = readProjectFile("web/index.html");
  const main = readProjectFile("web/main.js");
  const englishStart = source.indexOf("en: Object.freeze({");
  const chineseStart = source.indexOf("zh: Object.freeze({");
  const english = collectMessageKeys(source.slice(englishStart, chineseStart));
  const chinese = collectMessageKeys(source.slice(chineseStart));
  const referenced = new Set([
    ...[...html.matchAll(
      /data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/gu,
    )].map((match) => match[1]),
    ...[...main.matchAll(/\bt\("([^"]+)"/gu)].map((match) => match[1]),
  ]);

  referenced.forEach((key) => {
    assert.ok(english.has(key), `Missing English translation: ${key}`);
    assert.ok(chinese.has(key), `Missing Chinese translation: ${key}`);
  });
});
