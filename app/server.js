'use strict';
const http = require('http');

// Мінімальний zero-downtime сервіс для ДЗ #28. Без залежностей — лише node:http.
// Три відповідальності (спека): /healthz поки живий; /readyz лише коли справді готовий;
// на SIGTERM — спершу /readyz червоний, витримати дренаж, ЛИШЕ потім закрити сокет.
const PORT = Number(process.env.PORT || 8080);
const REV = process.env.REV || 'dev';
// Прогрів ~4с (як у реального сервісу з міграціями/пулом БД). Без нього вимір був би порожнім:
// под стартує швидше, ніж встигає «не бути готовим», і зламаний профіль теж показав би нуль збоїв.
const WARMUP_MS = Number(process.env.WARMUP_MS || 4000);
// Дренаж на SIGTERM. terminationGracePeriodSeconds у Deployment МАЄ бути більшим за це число,
// інакше SIGKILL прилетить посеред дренажу (exit 137, обірвані з'єднання).
const DRAIN_MS = Number(process.env.DRAIN_MS || 5000);

let ready = false; // /readyz зелений лише після прогріву
let shuttingDown = false; // на SIGTERM одразу червоніємо

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];

  // LIVENESS: «чи треба мене вбити». Поки процес живий — 200, НЕЗАЛЕЖНО від readiness.
  // Якби liveness залежала від готовності, тимчасово не готовий под рестартувало б назавжди.
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('alive\n');
    return;
  }

  // READINESS: «чи можна мені слати трафік». 200 лише коли прогрілись І не вимикаємось.
  if (path === '/readyz') {
    const ok = ready && !shuttingDown;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'text/plain' });
    res.end(ok ? 'ready\n' : 'not-ready\n');
    return;
  }

  // Робочий трафік (його і міряє генератор навантаження під час викочування).
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`ok rev=${REV}\n`);
});

// Слухаємо одразу (щоб проби могли достукатись), але readyz зелений лише ПІСЛЯ прогріву —
// саме це моделює «готовий не миттєво» й робить вимір викочування непорожнім.
server.listen(PORT, () => {
  console.log(`listening on :${PORT} rev=${REV}; warmup ${WARMUP_MS}ms`);
  setTimeout(() => {
    ready = true;
    console.log('warmup done -> readyz green');
  }, WARMUP_MS);
});

// SIGTERM. ПОРЯДОК не косметика:
//   1) readyz -> червоний: балансувальник/endpoints перестають слати НОВИЙ трафік;
//   2) ВИТРИМАТИ дренаж: in-flight запити добігаються, видалення з endpoints встигає розійтись;
//   3) ЛИШЕ потім server.close(). close() одразу = відмова новим з'єднанням, поки LB ще шле трафік.
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: readyz red, draining ${DRAIN_MS}ms`);
  setTimeout(() => {
    server.close(() => {
      console.log('socket closed, exiting 0');
      process.exit(0);
    });
  }, DRAIN_MS);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
