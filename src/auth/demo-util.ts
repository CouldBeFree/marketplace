import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import { AppModule } from '../app.module';
import { PG_POOL } from '../database/database.module';
import { attachPreInit, attachPostInit } from '../http/configure-app';
import { hashPassword } from './password';
import { Role } from './token.service';

export interface DemoUser {
  email: string;
  password: string;
  role: Role;
}

// Піднімає ПОВНИЙ Nest (той самий конфіг, що й прод: attachPreInit/attachPostInit) на своєму
// порту. logger лишаємо на warn/error — щоб видно було лог детекції повтору, але без шуму роутів.
export async function bootApp(port: number): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['warn', 'error'],
  });
  attachPreInit(app);
  await app.init();
  attachPostInit(app);
  await app.listen(port);
  return app;
}

export function poolOf(app: NestExpressApplication): Pool {
  return app.get<Pool>(PG_POOL);
}

// Самоочистка + сід (критерій 7: «сам приводить стан до чистого»). upsert кожного юзера зі
// знаним паролем/роллю + видалення його refresh-токенів — щоб вивід ключ=число не плавав.
export async function cleanAndSeed(pool: Pool, users: DemoUser[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const u of users) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, role, password_hash, balance_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET role = EXCLUDED.role, password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [u.email, u.email.split('@')[0], u.role, hashPassword(u.password), 100_000_000],
    );
    const id = String(rows[0].id);
    ids[u.email] = id;
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [id]);
  }
  return ids;
}

export interface HttpResult {
  status: number;
  json: unknown;
}

export function makeClient(port: number) {
  const base = `http://127.0.0.1:${port}`;
  return async (
    method: string,
    path: string,
    opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<HttpResult> => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  };
}

// tampered: беремо валідний access, підмінюємо payload (role→admin), лишаємо СТАРИЙ підпис.
// Якщо підпис справді перевіряється (а не decode-ається) → 401. Ключ для цього не потрібен.
export function forgeTampered(access: string): string {
  const t = access.split('.');
  const p = JSON.parse(Buffer.from(t[1], 'base64url').toString());
  p.role = 'admin';
  t[1] = Buffer.from(JSON.stringify(p)).toString('base64url');
  return t.join('.');
}

export function printAndExit(results: Record<string, number>, ok: boolean): never {
  for (const [k, v] of Object.entries(results)) console.log(`${k}=${v}`);
  process.exit(ok ? 0 : 1);
}
