// Єдине джерело правди для РЕСУРСНОГО ЗАПИТУ пода. Імпортують обидва боки, тож вони не розходяться:
//   • infra/index.ts     — кладе ці значення у контейнер Deployment (кластер отримує саме їх);
//   • scripts/cost-gate.mjs — коли pulumi-плану нема локально, рахує вартість із ТИХ САМИХ чисел.
//
// Жодного pulumi-імпорту тут навмисно: файл має лишатись «стрипабельним» (лише типи, що стираються),
// щоб scripts/cost-gate.mjs імпортував його напряму через type-stripping Node 24 — без кроку збірки.
export interface PodResources {
  replicas: number;
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
}

export const podResources: PodResources = {
  replicas: 2,
  // requests — те, що резервує планувальник (за цим рахується і вартість, і HPA-утилізація CPU).
  requests: { cpu: '250m', memory: '256Mi' },
  // limits — стеля; стримує «шумного сусіда», не дає OOM покласти вузол.
  limits: { cpu: '500m', memory: '512Mi' },
};
