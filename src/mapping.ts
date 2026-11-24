// ─── src/mapping.ts — трансляція pulumi-плану в місячну вартість ($) ────────────────────────────
// Серце cost-гейта (ДЗ #32, критерій 10). Вхід — pulumi preview --json (або будь-який JSON, де є
// pod-контролер зі spec.template.spec.containers). Витягуємо resources.requests кожного контейнера,
// множимо на replicas, переводимо у вартість за ДЕКЛАРОВАНИМИ тарифами (cost/rates.json).
//
// Чому порівнюємо ЧИСЛА, а не sha256 файлів: Pulumi додає випадковий суфікс до фізичних імен
// ресурсів → два плани того самого стану дають РІЗНІ файли, але ОДНАКОВУ вартість. Гейт має бути
// стабільним між прогонами, тож він працює з величинами (мілікори, MiB, $), а не з байтами файла.
//
// Лише типи, що стираються (без enum/namespace): файл читається з .mjs через type-stripping без збірки.

export interface CostRates {
  cpuUsdPerVcpuMonth: number;
  memUsdPerGiBMonth: number;
}

export interface PlanResources {
  cpuMillicores: number; // сумарно по всіх подах (× replicas)
  memoryMiB: number; // сумарно по всіх подах (× replicas)
  pods: number;
}

// "250m" → 250; "0.5"/"1" → 500/1000; число n (vCPU) → n*1000. Порожнє → 0.
export function parseCpuToMillicores(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Math.round(v * 1000);
  const s = v.trim();
  if (s.endsWith('m')) return Math.round(Number(s.slice(0, -1)));
  return Math.round(Number(s) * 1000);
}

// Суфікси пам'яті k8s: Ki/Mi/Gi/Ti (2^10) та K/M/G/T (10^3). Повертаємо MiB. Порожнє → 0.
export function parseMemToMiB(v: string | number | undefined): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v / (1024 * 1024); // голі байти
  const s = v.trim();
  const units: Record<string, number> = {
    Ki: 2 ** 10,
    Mi: 2 ** 20,
    Gi: 2 ** 30,
    Ti: 2 ** 40,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
  };
  const m = s.match(/^([0-9.]+)\s*([A-Za-z]+)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const bytes = n * (m[2] ? units[m[2]] ?? 1 : 1);
  return bytes / (1024 * 1024);
}

interface Controller {
  replicas: number;
  containers: Array<{ resources?: { requests?: { cpu?: string | number; memory?: string | number } } }>;
}

// Рекурсивно збираємо будь-які pod-контролери (Deployment/StatefulSet/…): об'єкт зі
// spec.template.spec.containers. replicas беремо з того ж spec (дефолт 1). Працює і на
// pulumi-preview (steps[].newState.inputs), і на голому k8s-маніфесті — форма та сама.
function collectControllers(node: unknown, acc: Controller[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const x of node) collectControllers(x, acc);
    return;
  }
  const obj = node as Record<string, any>;
  const spec = obj.spec;
  if (spec && spec.template && spec.template.spec && Array.isArray(spec.template.spec.containers)) {
    acc.push({
      replicas: typeof spec.replicas === 'number' ? spec.replicas : 1,
      containers: spec.template.spec.containers,
    });
  }
  for (const k of Object.keys(obj)) collectControllers(obj[k], acc);
}

export function extractResources(plan: unknown): PlanResources {
  const controllers: Controller[] = [];
  collectControllers(plan, controllers);

  let cpuMillicores = 0;
  let memoryMiB = 0;
  let pods = 0;
  for (const c of controllers) {
    pods += c.replicas;
    for (const cont of c.containers) {
      const req = cont.resources?.requests ?? {};
      cpuMillicores += parseCpuToMillicores(req.cpu) * c.replicas;
      memoryMiB += parseMemToMiB(req.memory) * c.replicas;
    }
  }
  return { cpuMillicores, memoryMiB, pods };
}

export function costUsd(r: PlanResources, rates: CostRates): number {
  const vcpu = r.cpuMillicores / 1000;
  const gib = r.memoryMiB / 1024;
  const usd = vcpu * rates.cpuUsdPerVcpuMonth + gib * rates.memUsdPerGiBMonth;
  return Math.round(usd * 100) / 100; // до цента
}
