import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

// ── Валідація конфігу — ПЕРША дія програми (критерій 5) ──────────────────────────────────────
// Без секрету зі сховища #11 розгортання ЗОБОВ'ЯЗАНЕ впасти й НАЗВАТИ змінну — ще до будь-якого
// звернення до кластера. Жодного дефолту (?? "changeme"): дефолт зробив би критерій зеленим на
// зламаному рішенні. Секрет приходить з оточення через scripts/with-secrets.sh.
const dbPassword = process.env.APP_DB_PASSWORD;
if (!dbPassword) {
  throw new Error('APP_DB_PASSWORD is required (зі сховища #11, через scripts/with-secrets.sh)');
}

const cfg = new pulumi.Config();
const namespace = cfg.get('namespace') ?? 'hw28';
const image = cfg.get('image') ?? 'hw28-app:v1';
const replicas = cfg.getNumber('replicas') ?? 2;
const rev = cfg.get('rev') ?? process.env.REV ?? 'r1';

const appName = 'zero-downtime';
const labels = { app: appName };
const DRAIN_SECONDS = 5;
const GRACE_SECONDS = 15; // > дренаж (5с): інакше SIGKILL прилетить посеред дренажу (exit 137)

const ns = new k8s.core.v1.Namespace('ns', { metadata: { name: namespace } });
const nsName = ns.metadata.name;

// Secret: data з BASE64 (не stringData — те поле лише для запису, API його не віддає, і pulumi
// бачив би diff на кожному up; з base64-data `up` двічі поспіль дає unchanged).
const secret = new k8s.core.v1.Secret(
  'app-secret',
  {
    metadata: { namespace: nsName, name: `${appName}-secret` },
    data: { 'db-password': Buffer.from(dbPassword).toString('base64') },
  },
  { parent: ns },
);

const deployment = new k8s.apps.v1.Deployment(
  'app',
  {
    metadata: { namespace: nsName, name: appName, labels },
    spec: {
      // spec.replicas лишається попри HPA: у kind без metrics-server HPA нічого не масштабує.
      // У бойовому кластері це конфлікт володіння полем replicas (див. README).
      replicas,
      selector: { matchLabels: labels },
      // Стратегія НУЛЯ: maxUnavailable:0 не дає зняти старий под, поки новий не сказав «готовий».
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      template: {
        // rev в анотації pod-шаблону: його зміна міняє шаблон → запускає викочування. (demo:rollout
        // тригерить викочування через kubectl rollout restart, що теж міняє шаблон.)
        metadata: { labels, annotations: { 'hw28/rev': rev } },
        spec: {
          terminationGracePeriodSeconds: GRACE_SECONDS,
          securityContext: { runAsNonRoot: true, runAsUser: 65532 },
          containers: [
            {
              name: appName,
              image,
              imagePullPolicy: 'IfNotPresent', // образ у kind через kind load, не з реєстру
              ports: [{ containerPort: 8080 }],
              env: [
                { name: 'REV', value: rev },
                { name: 'DRAIN_MS', value: String(DRAIN_SECONDS * 1000) },
                // Секрет — ПОСИЛАННЯМ (secretKeyRef); значення в маніфесті Deployment немає.
                {
                  name: 'APP_DB_PASSWORD',
                  valueFrom: { secretKeyRef: { name: secret.metadata.name, key: 'db-password' } },
                },
              ],
              // readiness ≠ liveness і на РІЗНІ шляхи. readiness з коротким періодом — щоб новий
              // под швидко визнали готовим. liveness на /healthz, НЕ на /readyz: інакше тимчасово
              // не готовий под рестартувало б назавжди.
              readinessProbe: {
                httpGet: { path: '/readyz', port: 8080 },
                initialDelaySeconds: 1,
                periodSeconds: 2,
                timeoutSeconds: 1,
                failureThreshold: 3,
              },
              livenessProbe: {
                httpGet: { path: '/healthz', port: 8080 },
                initialDelaySeconds: 10,
                periodSeconds: 5,
                timeoutSeconds: 1,
                failureThreshold: 3,
              },
            },
          ],
        },
      },
    },
  },
  { parent: ns },
);

// Service NodePort: генератор навантаження б'є http://localhost:30080 (kind extraPortMappings).
new k8s.core.v1.Service(
  'app-svc',
  {
    metadata: { namespace: nsName, name: appName, labels },
    spec: {
      type: 'NodePort',
      selector: labels,
      ports: [{ port: 80, targetPort: 8080, nodePort: 30080 }],
    },
  },
  { parent: ns },
);

// PDB: minAvailable < replicas (1 < 2) → disruptionsAllowed=1 → evict-1=201, evict-2=429.
// minAvailable == replicas блокувало б будь-який drain вузла (а не «максимально захищало»).
const pdb = new k8s.policy.v1.PodDisruptionBudget(
  'app-pdb',
  {
    metadata: { namespace: nsName, name: appName },
    spec: { minAvailable: 1, selector: { matchLabels: labels } },
  },
  { parent: ns },
);

// HPA маніфестом: autoscaling/v2, min≥2, метрика CPU. У kind без metrics-server показує
// cpu:<unknown>/70% і нічого не масштабує — це очікувано (див. README).
const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  'app-hpa',
  {
    metadata: { namespace: nsName, name: appName },
    spec: {
      scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name },
      minReplicas: 2,
      maxReplicas: 5,
      metrics: [
        {
          type: 'Resource',
          resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
        },
      ],
    },
  },
  { parent: ns },
);

export const namespaceOut = nsName;
export const deploymentOut = deployment.metadata.name;
export const pdbOut = pdb.metadata.name;
export const hpaOut = hpa.metadata.name;
export const secretOut = secret.metadata.name;
export const nodePort = 30080;
