/*
 * M2_LOG
 * Copyright (c) 2026 OA Hsiao
 * SPDX-License-Identifier: MIT
 *
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

// Static feature guards that run on every PR (no Electron, no DOM, no install).
// Catches the regressions that are easy to miss: i18n key drift, a data-i18n
// reference with no string, a broken highlight regex, or a duplicate element id.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

test('i18n: en.json and zh.json expose the same key set', () => {
  const en = Object.keys(readJson('src/renderer/i18n/en.json'));
  const zh = Object.keys(readJson('src/renderer/i18n/zh.json'));
  const missingZh = en.filter((k) => !zh.includes(k));
  const missingEn = zh.filter((k) => !en.includes(k));
  assert.deepStrictEqual(missingZh, [], `keys missing from zh.json: ${missingZh.join(', ')}`);
  assert.deepStrictEqual(missingEn, [], `keys missing from en.json: ${missingEn.join(', ')}`);
});

test('i18n: every data-i18n* key used in index.html exists in en.json', () => {
  const html = read('src/renderer/index.html');
  const en = readJson('src/renderer/i18n/en.json');
  const keys = new Set();
  const re = /data-i18n(?:-ph|-title)?="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) keys.add(m[1]);
  assert.ok(keys.size > 0, 'no data-i18n attributes found in index.html');
  const missing = [...keys].filter((k) => !(k in en));
  assert.deepStrictEqual(missing, [], `used in index.html but missing from en.json: ${missing.join(', ')}`);
});

test('highlight: every rule file is valid JSON and its patterns compile', () => {
  const dir = path.join(ROOT, 'highlight');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'no highlight JSON files found');
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const rules = Array.isArray(data) ? data : data && data.rules;
    assert.ok(Array.isArray(rules), `${f}: expected an array of rules (or { rules: [...] })`);
    for (const r of rules) {
      assert.ok(r && typeof r.level === 'string' && r.level, `${f}: a rule is missing 'level'`);
      assert.ok(typeof r.pattern === 'string' && r.pattern, `${f}: a rule is missing 'pattern'`);
      assert.doesNotThrow(() => new RegExp(r.pattern), `${f}: rule '${r.name || r.level}' has an invalid regex`);
    }
  }
});

test('index.html has no duplicate element ids', () => {
  const html = read('src/renderer/index.html');
  const ids = [];
  const re = /\sid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  assert.deepStrictEqual(dups, [], `duplicate ids in index.html: ${dups.join(', ')}`);
});
