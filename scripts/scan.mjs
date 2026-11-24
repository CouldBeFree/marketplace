// Ворота сканера з ОБЧИСЛЮВАНИМ порогом (критерій 4). Беремо JSON-звіт trivy, РАХУЄМО знахідки
// заданої важливості й порівнюємо з SCAN_MAX. Вердикт — із ДАНИХ, не надрукований: той самий
// скрипт із SCAN_MAX=-1 дає gate=fail (exit≠0), із SCAN_MAX=99999 — gate=pass (exit 0).
// Пороги -1/99999 обрані навмисно, щоб критерій не залежав від к-сті CVE (база оновлюється щодоби).
import { execSync } from 'child_process';

const image = process.env.SCAN_IMAGE || 'hw28-app:v1';
const severity = process.env.SCAN_SEVERITY || 'CRITICAL,HIGH';
const max = Number(process.env.SCAN_MAX ?? '0');

let found = 0;
try {
  const out = execSync(
    `trivy image --quiet --scanners vuln --format json --severity ${severity} ${image}`,
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  const report = JSON.parse(out);
  for (const r of report.Results || []) {
    for (const _ of r.Vulnerabilities || []) found++;
  }
} catch (err) {
  console.error('scan: trivy не відпрацював:', err instanceof Error ? err.message : err);
  process.exit(2);
}

const gate = found <= max ? 'pass' : 'fail';
console.log(`image=${image}`);
console.log(`severity=${severity.replace(/,/g, '+')}`);
console.log(`found=${found}`);
console.log(`max-allowed=${max}`);
console.log(`gate=${gate}`);
process.exit(gate === 'pass' ? 0 : 1);
