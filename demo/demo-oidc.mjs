// ─── demo:oidc (ДЗ #32, критерій 6 ⭐⭐) ─────────────────────────────────────────────────────────
// Самодостатнє, детерміноване доведення, що OIDC-гейт із scripts/oidc-gate.mjs справді ВИРІШУЄ, а
// не пропускає все підряд. Демо саме собі провайдер:
//   • генерує ДОВІРЕНУ RSA-пару A (її публічний ключ кладе в JWKS) і ЧУЖУ пару B (її в JWKS немає);
//   • підписує три id-токени й ганяє через ТОЙ САМИЙ гейт (import { runGate }), що й CI;
//   • звіряє результат з очікуваною матрицею — будь-яке відхилення = exit 1.
//
// Очікувана матриця (sig-verified, policy-allow):
//   green         → 1 1   (ключ A, iss/aud/sub за політикою)        — лише цей кейс пройшов би деплой
//   foreign-sub   → 1 0   (ключ A, але sub чужий)                   — підпис валідний, політика блокує
//   bad-signature → 0 0   (claims «зелені», але підписано ключем B) — підпис невалідний → claims не докази
//
// Той самий policy.json, що й у CI: зелений sub беремо з policy.subjects[0], тож демо й політика не розходяться.

import { generateKeyPairSync, createPublicKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runGate } from '../scripts/oidc-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function signJwt(header, payload, privateKey) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${h}.${p}`);
  return `${h}.${p}.${b64url(signer.sign(privateKey))}`; // sign() дає RSASSA-PKCS1-v1_5 = RS256
}

const rsa = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

async function main() {
  const policy = JSON.parse(readFileSync(join(ROOT, 'oidc/policy.json'), 'utf8'));

  const A = rsa(); // довірена пара (в JWKS)
  const B = rsa(); // чужа пара (НЕ в JWKS)
  const kid = 'oidc-demo-key';

  // JWKS містить ЛИШЕ публічний ключ A. Публічний ключ B навмисно відсутній.
  const jwkA = createPublicKey(A.publicKey).export({ format: 'jwk' });
  const jwks = { keys: [{ ...jwkA, kid, use: 'sig', alg: 'RS256' }] };

  const header = { alg: 'RS256', typ: 'JWT', kid };
  const now = Math.floor(Date.now() / 1000);
  const base = { iss: policy.issuer, aud: policy.audience, iat: now, exp: now + 300 };
  const greenSub = policy.subjects[0];

  const cases = [
    { name: 'green', token: signJwt(header, { ...base, sub: greenSub }, A.privateKey), want: [1, 1] },
    {
      name: 'foreign-sub',
      token: signJwt(header, { ...base, sub: 'repo:evil/other:ref:refs/heads/main' }, A.privateKey),
      want: [1, 0],
    },
    {
      // claims «зелені», але підписано ЧУЖИМ ключем B → підпис не збирається → claims не докази.
      name: 'bad-signature',
      token: signJwt(header, { ...base, sub: greenSub }, B.privateKey),
      want: [0, 0],
    },
  ];

  let ok = true;
  for (const c of cases) {
    const r = await runGate({ jwks, policy, token: c.token });
    const got = [r.sigVerified ? 1 : 0, r.policyAllow ? 1 : 0];
    const pass = got[0] === c.want[0] && got[1] === c.want[1];
    ok = ok && pass;
    // iss/aud/sub друкуємо (видно, що для bad-signature claims «зелені», та підпис їх не підтвердив);
    // сам токен не друкуємо НІКОЛИ.
    console.log(
      `case=${c.name} sig-verified=${got[0]} policy-allow=${got[1]} ` +
        `oidc-sub=${r.sub} gate=${r.gate} expected=${c.want.join('/')} ${pass ? 'OK' : 'MISMATCH'}`,
    );
  }

  console.log(`demo:oidc=${ok ? 'pass' : 'fail'}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('demo:oidc:', e instanceof Error ? e.message : e);
  process.exit(2);
});
