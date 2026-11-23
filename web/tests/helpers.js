// Shared helpers for the JavaScript tests.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Load a fixture written by tools/make_fixtures.py (web/tests/fixtures/<name>.json.gz). */
export function fixture(name) {
  const file = path.join(HERE, 'fixtures', `${name}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
}

/** Read a JSON file from web/static/data/. */
export function staticData(name) {
  return JSON.parse(readFileSync(path.join(HERE, '..', 'static', 'data', name), 'utf8'));
}
