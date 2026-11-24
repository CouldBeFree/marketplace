// ─── gate:cost (ДЗ #32, критерій 10) ───────────────────────────────────────────────────────────
// Ворота вартості: план інфраструктури → $ → порівняння з бюджетом. Вердикт — із ДАНИХ:
//   plan-usd ≤ budget-usd → pass (exit 0); інакше fail (exit 1). plan-usd ЗАВЖДИ > 0 (інакше ресурси
//   не витяглись — це баг, і гейт теж fail). Критерій ганяють двічі: COST_BUDGET_USD=0 → fail,
//   COST_BUDGET_USD=999999 → pass, на ТОМУ САМОМУ плані.
//
// Обхід для свідомо дорогих змін — ІМЕНОВАНИЙ лейбл (cost-gate-bypass-label: cost-approved): якщо
// на PR є цей лейбл, гейт пропускає з bypassed=1 (щоб апрув був явним і лишав слід, а не «тихо вимкнув»).
//
// Джерело плану: --plan/$COST_PLAN (pulumi preview --json у CI). Якщо файла нема (локально без pulumi) —
// рахуємо з infra/resources.ts, тобто з ТИХ САМИХ чисел, що їх кластер реально отримує. Та сама
// трансляція (src/mapping.ts) обома шляхами.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractResources, costUsd } from '../src/mapping.ts';
import { podResources } from '../infra/resources.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) a[k.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i];
  }
  return a;
}

// Лейбли PR: JSON-масив (['a','b']) або CSV ("a,b"). У CI передаємо
// --labels '${{ toJSON(github.event.pull_request.labels.*.name) }}'.
function parseLabels(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  }
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

// Синтетичний pulumi-подібний план із infra/resources.ts (локальний фолбек без pulumi).
function syntheticPlan() {
  return {
    steps: [
      {
        op: 'create',
        newState: {
          type: 'kubernetes:apps/v1:Deployment',
          inputs: {
            spec: {
              replicas: podResources.replicas,
              template: {
                spec: {
                  containers: [
                    {
                      name: 'zero-downtime',
                      resources: { requests: podResources.requests, limits: podResources.limits },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));

  const budget = Number(a.budget ?? process.env.COST_BUDGET_USD);
  if (!Number.isFinite(budget)) {
    console.error('cost-gate: потрібен --budget <usd> або $COST_BUDGET_USD');
    process.exit(2);
  }

  const rates = JSON.parse(await readFile(a.rates ?? join(ROOT, 'cost/rates.json'), 'utf8'));

  const planPath = a.plan ?? process.env.COST_PLAN;
  let plan;
  let planSource;
  if (planPath && existsSync(planPath)) {
    plan = JSON.parse(await readFile(planPath, 'utf8'));
    planSource = 'pulumi-plan';
  } else {
    plan = syntheticPlan();
    planSource = 'infra-fallback';
  }

  const res = extractResources(plan);
  const planUsd = costUsd(res, rates);

  const bypassName = a['bypass-label'] ?? 'cost-approved';
  const labels = parseLabels(a.labels ?? process.env.PR_LABELS);
  const bypassed = labels.includes(bypassName);

  let gate;
  if (!(planUsd > 0)) gate = 'fail'; // план має бути додатним; 0 = ресурси не витяглись
  else if (bypassed) gate = 'pass'; // свідомий, іменований обхід
  else gate = planUsd <= budget ? 'pass' : 'fail';

  console.log(`budget-usd=${budget.toFixed(2)}`);
  console.log(`plan-usd=${planUsd.toFixed(2)}`);
  console.log(`cpu-millicores=${res.cpuMillicores}`);
  console.log(`memory-mib=${Math.round(res.memoryMiB)}`);
  console.log(`pods=${res.pods}`);
  console.log(`plan-source=${planSource}`);
  console.log(`cost-gate-bypass-label=${bypassName}`);
  console.log(`bypassed=${bypassed ? 1 : 0}`);
  console.log(`gate=${gate}`);
  process.exit(gate === 'pass' ? 0 : 1);
}

main().catch((e) => {
  console.error('cost-gate:', e instanceof Error ? e.message : e);
  process.exit(2);
});
