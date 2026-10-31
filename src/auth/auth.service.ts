import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PG_POOL } from '../database/database.module';
import { Env } from '../config/env.schema';
import { TokenService, AccessClaims, Role } from './token.service';
import { DenylistService } from './denylist.service';
import { verifyPassword } from './password';
import { newRefreshToken, hashRefresh, REFRESH_TTL_SEC } from './refresh';

export interface TokenPair {
  access: string;
  refresh: string;
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');
  private readonly pepper: string;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tokens: TokenService,
    private readonly denylist: DenylistService,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
  }

  // Логін: звіряємо пароль проти БД (scrypt), заводимо НОВУ сімʼю й видаємо пару.
  async login(email: string, password: string): Promise<TokenPair> {
    const { rows } = await this.pool.query(
      `SELECT id, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('invalid credentials'); // 401
    }
    const fam = randomUUID();
    return this.issuePair(String(user.id), user.role as Role, fam, this.pool);
  }

  // Видача пари + запис нового refresh. Викликають login (нова сімʼя) і rotate (та сама сімʼя,
  // транзакційний client). access — self-contained JWT; refresh — рядок, його хеш у БД.
  private async issuePair(userId: string, role: Role, fam: string, db: Queryable): Promise<TokenPair> {
    const access = this.tokens.signAccess(userId, role, fam).token;
    const refresh = newRefreshToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, fam, hashRefresh(refresh, this.pepper), expiresAt],
    );
    return { access, refresh };
  }

  // Ротація з ДЕТЕКЦІЄЮ ПОВТОРУ — усе в ОДНІЙ транзакції (атомарно, як відкликання+видача в #14):
  //   SELECT ... FOR UPDATE серіалізує паралельні рефреші одного токена (гонка на клієнті не
  //   прочитає used_at=null двічі). Три результати: повтор використаного → відкликати сімʼю (401);
  //   невідомий/відкликаний/протух → 401; інакше — чесна ротація (стара мітка used, нова пара).
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = hashRefresh(refreshToken, this.pepper);
    const client = await this.pool.connect();
    let pair: TokenPair | undefined;
    let reuse: { familyId: string; userId: string } | null = null;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT id, user_id, family_id, used_at, revoked_at, expires_at
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [tokenHash],
      );
      const row = rows[0];

      if (!row) throw new UnauthorizedException('unknown refresh token');
      if (row.revoked_at) throw new UnauthorizedException('refresh token revoked');

      if (row.used_at) {
        // ПОВТОР уже використаного токена = сигнал компрометації. Ротація БЕЗ детекції тут нічого
        // не дала б (злодій рефрешиться першим). Валимо ВСЮ сімʼю — і злодія, і чесного клієнта
        // (RFC 9700 §4.14.2: ротація + детекція повтору; звʼязок через family_id і є те, чим
        // відкликати). Комітимо відкликання, тоді 401.
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = now()
             WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        reuse = { familyId: row.family_id, userId: String(row.user_id) };
      } else if (new Date(row.expires_at).getTime() < Date.now()) {
        throw new UnauthorizedException('refresh token expired');
      } else {
        await client.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
        const { rows: urows } = await client.query(`SELECT role FROM users WHERE id = $1`, [row.user_id]);
        const role = (urows[0]?.role ?? 'buyer') as Role;
        pair = await this.issuePair(String(row.user_id), role, row.family_id, client);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw err; // 401 для невідомого/відкликаного/протухлого — нічого не збережено
    }
    client.release();

    if (reuse) {
      this.logger.warn(
        `reuse detected: family_id=${reuse.familyId} user_id=${reuse.userId} — всю сімʼю відкликано`,
      );
      throw new UnauthorizedException('refresh token reuse detected'); // 401, сімʼю вже відкликано
    }
    return pair!;
  }

  // Логаут — ДВІ дії у РІЗНИХ сховищах (свідомий dual-write, НЕ вдаваний atomic — урок #22):
  //   1) PG (джерело правди, комітиться першим): відкликаємо всю сімʼю refresh — їх не обміняти.
  //   2) Redis-денилист jti access-токена з TTL = залишок exp: self-contained access інакше жив
  //      би до exp. Якщо Redis відпаде після кроку 1 — access помре на exp (≤10 хв), не довше.
  async logout(claims: AccessClaims): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
         WHERE family_id = $1 AND revoked_at IS NULL`,
      [claims.fam],
    );
    await this.denylist.deny(claims.jti, claims.exp);
  }
}
