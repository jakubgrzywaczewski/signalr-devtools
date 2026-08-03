import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCES = ['contentScript.js', 'background.js', 'sessionFormat.js'];

function source(file) {
  return readFileSync(path.resolve(file), 'utf8');
}

function setValues(contents, name) {
  const declaration = contents.match(
    new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`),
  );
  if (!declaration) {
    throw new Error(`Missing ${name} declaration`);
  }
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function numericConstant(contents, name) {
  const declaration = contents.match(new RegExp(`const ${name} = ([\\d_]+);`));
  if (!declaration) {
    throw new Error(`Missing ${name} declaration`);
  }
  return Number(declaration[1].replaceAll('_', ''));
}

describe('captured-message validation contract', () => {
  it('keeps bounded strings and allowed enum values aligned across trust boundaries', () => {
    const contents = SOURCES.map(source);

    for (const name of ['ALLOWED_TRANSPORTS', 'ALLOWED_DIRECTIONS', 'ALLOWED_LIFECYCLE_EVENTS']) {
      const [expected, ...copies] = contents.map((entry) => setValues(entry, name));
      for (const copy of copies) {
        expect(copy).toEqual(expected);
      }
    }

    const [expectedLimit, ...limitCopies] = contents.map((entry) =>
      numericConstant(entry, 'MAX_STRING_LENGTH'),
    );
    for (const limit of limitCopies) {
      expect(limit).toBe(expectedLimit);
    }
  });

  it('documents every duplicated validation boundary', () => {
    for (const file of SOURCES) {
      expect(source(file)).toContain('Keep this validation contract in sync');
    }
  });
});
