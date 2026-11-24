// ─── demo:gates (ДЗ #32, критерій 4 ⭐) ─────────────────────────────────────────────────────────
// Доводить, що КОЖЕН із чотирьох quality-гейтів справді вирішує: падає на зламаному вводі й
// проходить на коректному. Для кожного гейта запускаємо дві гілки й друкуємо exit-код:
//   <step>-ok      має бути 0
//   <step>-broken  має бути ≠0
// demo:gates=pass лише якщо ВСІ вісім умов виконано. Так «обидва боки» кожного гейта — машинно видно.
//
// Гейти:
//   types         — tsc --noEmit --strict (типи)
//   contract      — scripts/contract-gate.mjs (ламаючі зміни OpenAPI)
//   architecture  — dependency-cruiser (заборонені імпорти/цикли)
//   image         — scripts/scan.mjs на фіксованому trivy-звіті (поріг SCAN_MAX)

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function run({ cmd, args, env }) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...(env || {}) },
    encoding: 'utf8',
  });
  // status=null буває, коли процес убито сигналом; трактуємо як ненульовий.
  return r.status == null ? 1 : r.status;
}

const steps = [
  {
    name: 'types',
    ok: { cmd: 'npx', args: ['tsc', '--noEmit', '--strict', '--skipLibCheck', 'demo/gates/types-ok.ts'] },
    broken: { cmd: 'npx', args: ['tsc', '--noEmit', '--strict', '--skipLibCheck', 'demo/gates/types-broken.ts'] },
  },
  {
    name: 'contract',
    ok: {
      cmd: 'node',
      args: ['scripts/contract-gate.mjs', '--base', 'demo/gates/contract-base.json', '--head', 'demo/gates/contract-head-ok.json'],
    },
    broken: {
      cmd: 'node',
      args: ['scripts/contract-gate.mjs', '--base', 'demo/gates/contract-base.json', '--head', 'demo/gates/contract-head-broken.json'],
    },
  },
  {
    name: 'architecture',
    ok: { cmd: 'npx', args: ['depcruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'err', 'demo/gates/arch/ok'] },
    broken: { cmd: 'npx', args: ['depcruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'err', 'demo/gates/arch/broken'] },
  },
  {
    name: 'image',
    ok: { cmd: 'node', args: ['scripts/scan.mjs'], env: { SCAN_REPORT: 'demo/gates/scan-report.sample.json', SCAN_MAX: '99999' } },
    broken: { cmd: 'node', args: ['scripts/scan.mjs'], env: { SCAN_REPORT: 'demo/gates/scan-report.sample.json', SCAN_MAX: '-1' } },
  },
];

let allPass = true;
for (const s of steps) {
  const okCode = run(s.ok);
  const brokenCode = run(s.broken);
  const good = okCode === 0 && brokenCode !== 0;
  allPass = allPass && good;
  console.log(`${s.name}-ok=${okCode}`);
  console.log(`${s.name}-broken=${brokenCode}`);
}

console.log(`demo:gates=${allPass ? 'pass' : 'fail'}`);
process.exit(allPass ? 0 : 1);
