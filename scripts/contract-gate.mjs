// ─── Гейт контракту: детектор ЛАМАЮЧИХ змін OpenAPI (ДЗ #32) ────────────────────────────────────
// Порівнює base-спеку з head-спекою і шукає зміни, що ламають наявних клієнтів. Вердикт — із ДАНИХ:
//   breaking=0 → pass (exit 0); breaking>0 → fail (exit 1).
//
// Що вважаємо ламаючим (звуження того, на що клієнт уже покладається):
//   • зник шлях;
//   • зникла операція (метод) на шляху;
//   • зник код відповіді на операції;
//   • з'явився новий ОБОВ'ЯЗКОВИЙ параметр (або опційний став обов'язковим).
// Додавання шляху/операції/опційного параметра — сумісне, не ламає.
//
// Специфікації читаємо як JSON (OpenAPI в JSON валідний і не тягне YAML-залежність). У CI
// yaml-спеку спершу перетворюємо: `redocly bundle openapi/openapi.yaml -o spec.json`.

import { readFile } from 'node:fs/promises';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

function indexParams(params) {
  const out = {};
  for (const p of params || []) out[`${p.in}:${p.name}`] = p;
  return out;
}

function breakingChanges(base, head) {
  const out = [];
  const bPaths = base.paths || {};
  const hPaths = head.paths || {};

  for (const path of Object.keys(bPaths)) {
    if (!hPaths[path]) {
      out.push(`removed path ${path}`);
      continue;
    }
    for (const m of METHODS) {
      const bOp = bPaths[path][m];
      if (!bOp) continue;
      const hOp = hPaths[path][m];
      if (!hOp) {
        out.push(`removed operation ${m.toUpperCase()} ${path}`);
        continue;
      }
      // зниклі коди відповідей
      const hResp = new Set(Object.keys(hOp.responses || {}));
      for (const code of Object.keys(bOp.responses || {})) {
        if (!hResp.has(code)) out.push(`removed response ${code} on ${m.toUpperCase()} ${path}`);
      }
      // нові обов'язкові параметри / опційний → обов'язковий
      const bParams = indexParams(bOp.parameters);
      const hParams = indexParams(hOp.parameters);
      for (const key of Object.keys(hParams)) {
        if (hParams[key].required === true && bParams[key]?.required !== true) {
          out.push(`newly required param ${key} on ${m.toUpperCase()} ${path}`);
        }
      }
    }
  }
  return out;
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) a[k.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.base || !a.head) {
    console.error('contract-gate: потрібні --base <spec.json> --head <spec.json>');
    process.exit(2);
  }
  const base = JSON.parse(await readFile(a.base, 'utf8'));
  const head = JSON.parse(await readFile(a.head, 'utf8'));

  const changes = breakingChanges(base, head);
  for (const c of changes) console.log(`breaking-change: ${c}`);
  const gate = changes.length === 0 ? 'pass' : 'fail';
  console.log(`breaking=${changes.length}`);
  console.log(`gate=${gate}`);
  process.exit(gate === 'pass' ? 0 : 1);
}

main().catch((e) => {
  console.error('contract-gate:', e instanceof Error ? e.message : e);
  process.exit(2);
});
