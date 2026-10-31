import { createHmac, randomBytes } from 'crypto';

// refresh — НЕПРОЗОРИЙ токен: випадкові 32 байти (base64url), НЕ JWT. Нічого не несе й не
// парситься — лише ідентифікує рядок у таблиці. (access — JWT; refresh — ні, це свідомо.)
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

// У БД лежить HMAC(pepper, token), а НЕ сам токен і НЕ голий SHA-256: «перець» зі сховища
// робить дамп таблиці марним навіть при витоку бази (без перцю зловмисник з дампом хешів міг би
// звіряти вкрадені токени; HMAC без секрету перцю це унеможливлює).
export function hashRefresh(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export const REFRESH_TTL_SEC = 7 * 24 * 3600; // 7 днів
