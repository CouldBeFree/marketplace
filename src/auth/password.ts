import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// Хешування пароля через scrypt (node:crypto) — без зовнішніх залежностей (bcrypt/argon).
// Формат рядка: scrypt$<saltHex>$<hashHex>. Сіль — на кожен пароль своя.
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

// Порівняння — constant-time (timingSafeEqual), щоб не текла інформація через час відповіді.
export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
