import { createPrivateKey, createPublicKey, createHash, KeyObject } from 'crypto';

// Асиметричний підпис: ES256 (OWASP радить ES256/PS256/EdDSA; RS256 позначений «Not
// recommended»). ES256 — малі ключі (P-256), і верифікатор має ЛИШЕ публічний ключ:
// він фізично не може виписати валідний токен (на відміну від HS256, де верифікатор = підписувач).
export const JWT_ALG = 'ES256' as const;

function pemFromBase64(b64: string): string {
  // Ключ приїжджає base64-ом (багаторядковий PEM в export виживає не скрізь — класична
  // нагорода за це DECODER routines::unsupported на першому ж підписі).
  return Buffer.from(b64, 'base64').toString('utf8');
}

export interface JwtKeys {
  privateKey: KeyObject;
  publicKey: KeyObject;
  kid: string;
  fingerprint: string;
}

// base64 → PEM → KeyObject (так радить @nestjs/jwt — KeyObject, не PEM-рядок). Невалідний
// ключ кидає ТУТ, на старті (fail-fast з ясною причиною), а не на першому підписі.
export function loadJwtKeys(privB64: string, pubB64: string, kid: string): JwtKeys {
  const privateKey = createPrivateKey(pemFromBase64(privB64));
  const publicKey = createPublicKey(pemFromBase64(pubB64));
  return { privateKey, publicKey, kid, fingerprint: fingerprintOf(publicKey) };
}

// Відбиток ключа = SHA-256 від DER публічного ключа, перші 16 hex-символів (прийом із ДЗ #11):
// у лог/README іде відбиток, не сам ключ — доказ, що dev і prod оточення різні.
export function fingerprintOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}
