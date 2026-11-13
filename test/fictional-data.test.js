'use strict';
// Guard against real identifiers creeping back in: every email address in the repository must use
// the reserved .example domain (RFC 2606), except the documented template placeholder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache', 'cache']);
const ALLOWED = new Set(['customername@company.com', 'noreply@anthropic.com']);

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.endsWith('.egg-info')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(js|json|jsonl|py|md|toml|yml|txt)$/.test(e.name)) yield p;
  }
}

test('every email address in the repo is fictional (.example)', () => {
  const bad = [];
  for (const f of files(ROOT)) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g)) {
      const addr = m[0].toLowerCase();
      if (addr.endsWith('.example') || ALLOWED.has(addr)) continue;
      bad.push(`${path.relative(ROOT, f)}: ${addr}`);
    }
  }
  assert.deepEqual(bad, []);
});
