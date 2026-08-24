#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseQuotedValue(rawValue, lineNumber) {
  const quote = rawValue[0];
  let value = '';
  let index = 1;
  let closed = false;

  while (index < rawValue.length) {
    const character = rawValue[index];
    if (character === quote) {
      closed = true;
      index += 1;
      break;
    }

    if (quote === '"' && character === '\\' && index + 1 < rawValue.length) {
      const escaped = rawValue[index + 1];
      const replacements = {
        n: '\n',
        r: '\r',
        t: '\t',
        '"': '"',
        '\\': '\\',
      };
      if (Object.hasOwn(replacements, escaped)) {
        value += replacements[escaped];
      } else {
        value += `\\${escaped}`;
      }
      index += 2;
      continue;
    }

    value += character;
    index += 1;
  }

  if (!closed) {
    throw new Error(`Unterminated quoted value on line ${lineNumber}`);
  }

  const remainder = rawValue.slice(index).trim();
  if (remainder && !remainder.startsWith('#')) {
    throw new Error(`Unexpected content after quoted value on line ${lineNumber}`);
  }

  return value;
}

export function parseEnvText(contents) {
  if (contents.includes('\0')) {
    throw new Error('Environment file contains a NUL byte');
  }

  const values = new Map();
  const lines = contents.replace(/^\uFEFF/, '').split(/\n/);

  lines.forEach((originalLine, index) => {
    let line = originalLine.replace(/\r$/, '').trim();
    const lineNumber = index + 1;

    if (!line || line.startsWith('#')) return;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();

    const equalsIndex = line.indexOf('=');
    if (equalsIndex < 1) {
      throw new Error(`Invalid environment assignment on line ${lineNumber}`);
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment key on line ${lineNumber}`);
    }

    const rawValue = line.slice(equalsIndex + 1).trim();
    let value;
    if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      value = parseQuotedValue(rawValue, lineNumber);
    } else {
      const commentIndex = rawValue.indexOf('#');
      value = (commentIndex === -1 ? rawValue : rawValue.slice(0, commentIndex)).trim();
    }

    values.set(key, value);
  });

  return values;
}

export function readEnvValue(filePath, key) {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw new Error('Invalid requested environment key');
  }

  const values = parseEnvText(readFileSync(filePath, 'utf8'));
  if (!values.has(key)) {
    throw new Error(`Required environment key is missing: ${key}`);
  }
  return values.get(key);
}

const isMainModule = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const [, , filePath, key] = process.argv;
  if (!filePath || !key) {
    console.error('Usage: read-env-value.mjs /path/to/env-file KEY');
    process.exit(2);
  }

  try {
    process.stdout.write(readEnvValue(filePath, key));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
