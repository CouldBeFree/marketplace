#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { envSchema } from '../src/config/env.schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(root, '.env.example');

const schemaKeys = Object.keys(envSchema.shape).sort();

const exampleKeys = readFileSync(examplePath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('=')[0].trim())
  .filter(Boolean)
  .sort();

const missing = schemaKeys.filter((k) => !exampleKeys.includes(k));
const extra = exampleKeys.filter((k) => !schemaKeys.includes(k));

if (missing.length || extra.length) {
  console.error('❌ .env.example розсинхронізований зі схемою env:');
  if (missing.length) {
    console.error(`  Є у схемі, немає у .env.example: ${missing.join(', ')}`);
  }
  if (extra.length) {
    console.error(`  Є у .env.example, немає у схемі:  ${extra.join(', ')}`);
  }
  process.exit(1);
}

console.log(
  `✅ .env.example синхронний зі схемою (${schemaKeys.length} змінних: ${schemaKeys.join(', ')})`,
);
