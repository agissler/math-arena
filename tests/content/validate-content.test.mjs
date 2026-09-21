import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateRepository } from '../../scripts/validate-content.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('tous les contenus du dépôt respectent les règles', () => {
  assert.deepEqual(validateRepository(ROOT), []);
});
