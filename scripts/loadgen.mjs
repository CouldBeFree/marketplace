// Генератор навантаження для demo:rollout. Б'є по URL із заданою конкурентністю і ПИШЕ код
// КОЖНОЇ відповіді у файл (0 = з'єднання не встановилось/обірвалось — еквівалент curl-коду 000).
// agent:false — свіже TCP-з'єднання на кожен запит: kube-proxy маршрутизує його в ПОТОЧНО здоровий
// под, тож коректний профіль (readyz-червоний + дренаж) не роняє жодного запиту. Keep-alive-пул
// навпаки лишив би з'єднання, прибите до пода, що завершується.
// Запуск: node scripts/loadgen.mjs <url> <concurrency> <out>. Працює до SIGTERM — тоді флашить.
import http from 'http';
import fs from 'fs';

const target = new URL(process.argv[2] || 'http://localhost:30080/');
const concurrency = Number(process.argv[3] || 20);
const out = process.argv[4] || '/tmp/hw28-codes.txt';

const codes = [];
let running = true;

function once() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: target.hostname, port: target.port, path: target.pathname, agent: false, timeout: 5000 },
      (res) => {
        res.resume(); // дочитати тіло, щоб з'єднання коректно завершилось
        res.on('end', () => resolve(res.statusCode || 0));
      },
    );
    req.on('error', () => resolve(0));
    req.on('timeout', () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function worker() {
  while (running) {
    codes.push(await once());
  }
}

function flushAndExit() {
  running = false;
  setTimeout(() => {
    fs.writeFileSync(out, codes.length ? codes.join('\n') + '\n' : '');
    process.exit(0);
  }, 250);
}
process.on('SIGTERM', flushAndExit);
process.on('SIGINT', flushAndExit);

for (let i = 0; i < concurrency; i++) void worker();
