// ─── OIDC-гейт (ДЗ #32, критерій 6 ⭐⭐) ────────────────────────────────────────────────────────
// ЦЕЙ САМИЙ код працює і в CI, і в demo:oidc. Він НЕ знає, локально його запустили чи ні — усе
// приходить ПАРАМЕТРАМИ: звідки брати публічні ключі (jwks-url АБО issuer для автовиявлення),
// файл політики довіри і сам токен. Тому «зелений локально» = «зелений у пайплайні».
//
// Що робить:
//   1) бере набір публічних ключів провайдера (JWKS) — з URL, з issuer (через
//      /.well-known/openid-configuration → jwks_uri) або з локального файла;
//   2) ПЕРЕВІРЯЄ RS256-підпис токена цим ключем (claims БЕЗ перевіреного підпису — не докази);
//   3) лише якщо підпис валідний — звіряє iss/aud/sub із policy.json;
//   4) друкує iss/aud/sub і прапорці, але НІКОЛИ не друкує сам токен.
//
// Вердикт — із ДАНИХ, не надрукований: gate=pass ⇔ (sig-verified=1 ∧ policy-allow=1), і лише тоді exit 0.

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const b64urlToBuf = (s) => Buffer.from(s, 'base64url');
const b64urlJson = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));

async function loadJwks(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`JWKS fetch ${source}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, 'utf8'));
}

async function discoverJwksUri(issuer) {
  const url = issuer.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openid-configuration ${url}: HTTP ${res.status}`);
  const cfg = await res.json();
  if (!cfg.jwks_uri) throw new Error('openid-configuration без jwks_uri');
  return cfg.jwks_uri;
}

// Перевірка RS256 (RSASSA-PKCS1-v1_5 + SHA-256). За наявності kid пробуємо ключ із тим самим kid;
// інакше — усі RSA-ключі набору. Повертає true, лише якщо ЯКИЙСЬ ключ набору справді підписав токен.
function verifyRs256(token, jwks) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [h, p, s] = parts;
  let header;
  try {
    header = b64urlJson(h);
  } catch {
    return false;
  }
  if (header.alg !== 'RS256') return false; // alg:none та підміну алгоритму відсікаємо тут
  const keys = (jwks.keys || []).filter(
    (k) => k.kty === 'RSA' && (!header.kid || !k.kid || k.kid === header.kid),
  );
  const signed = Buffer.from(`${h}.${p}`);
  const sig = b64urlToBuf(s);
  for (const jwk of keys) {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if (cryptoVerify('RSA-SHA256', signed, key, sig)) return true;
    } catch {
      /* ключ не підійшов — пробуємо наступний */
    }
  }
  return false;
}

const audMatches = (aud, want) => (Array.isArray(aud) ? aud.includes(want) : aud === want);

function subMatches(sub, policy) {
  if (Array.isArray(policy.subjects) && policy.subjects.includes(sub)) return true;
  if (policy.subjectPattern && new RegExp(policy.subjectPattern).test(sub)) return true;
  return false;
}

/**
 * Єдина точка логіки гейта (її ж викликає demo:oidc).
 * @param {{jwksSource?:string, issuer?:string, jwks?:object, policy:object, token:string}} opts
 * @returns {Promise<{iss:string,aud:string,sub:string,sigVerified:boolean,policyAllow:boolean,gate:'pass'|'fail'}>}
 */
export async function runGate({ jwksSource, issuer, jwks: jwksObj, policy, token }) {
  let jwks = jwksObj;
  if (!jwks) {
    if (jwksSource) jwks = await loadJwks(jwksSource);
    else if (issuer) jwks = await loadJwks(await discoverJwksUri(issuer));
    else throw new Error('треба jwks, jwksSource або issuer');
  }

  const sigVerified = verifyRs256(token, jwks);

  // Claims читаємо ДЛЯ ЗВІТУ, але довіряємо їм лише за валідного підпису.
  let claims = {};
  try {
    claims = b64urlJson(String(token).split('.')[1] || '');
  } catch {
    /* понівечений payload — лишаємо порожні claims */
  }
  const iss = claims.iss ?? '';
  const aud = claims.aud ?? '';
  const sub = claims.sub ?? '';

  // Непідписаним claims не віримо → policy-allow=0 навіть якщо значення «правильні».
  const policyAllow =
    sigVerified &&
    iss === policy.issuer &&
    audMatches(aud, policy.audience) &&
    subMatches(sub, policy);

  return {
    iss,
    aud: Array.isArray(aud) ? aud.join(',') : aud,
    sub,
    sigVerified,
    policyAllow,
    gate: sigVerified && policyAllow ? 'pass' : 'fail',
  };
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
  if (!a.policy) throw new Error('потрібен --policy <file>');
  const policy = JSON.parse(await readFile(a.policy, 'utf8'));

  let token = a.token || process.env.ACTIONS_ID_TOKEN || '';
  if (!token && a['token-file']) token = (await readFile(a['token-file'], 'utf8')).trim();
  if (!token) {
    console.error('oidc-gate: немає токена (--token / --token-file / $ACTIONS_ID_TOKEN)');
    process.exit(2);
  }

  const r = await runGate({ jwksSource: a.jwks, issuer: a.issuer, policy, token });
  console.log(`oidc-iss=${r.iss}`);
  console.log(`oidc-aud=${r.aud}`);
  console.log(`oidc-sub=${r.sub}`);
  console.log(`sig-verified=${r.sigVerified ? 1 : 0}`);
  console.log(`policy-allow=${r.policyAllow ? 1 : 0}`);
  console.log(`gate=${r.gate}`);
  process.exit(r.gate === 'pass' ? 0 : 1);
}

// Запускаємо main лише коли файл викликано як CLI (а не імпортовано демо/CI).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error('oidc-gate:', e instanceof Error ? e.message : e);
    process.exit(2);
  });
}
