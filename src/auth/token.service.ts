import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Env } from '../config/env.schema';
import { JWT_ALG } from './keys';

export type Role = 'buyer' | 'seller' | 'admin';

export interface AccessClaims {
  sub: string; // user id
  role: Role; // КЕШ ролі (джерело правди — БД); живе до exp цього токена
  fam: string; // family_id — щоб logout відкликав усю сімʼю, маючи лише access-токен
  jti: string; // ідентифікатор токена — ключ денилиста
  iat: number;
  exp: number;
}

// Короткий строк життя access (орієнтир 5–15 хв): ціна відкликання — часті рефреші (RFC 7009 §3).
export const ACCESS_TTL_SEC = 600; // 10 хв

@Injectable()
export class TokenService {
  private readonly kid: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.kid = config.get('JWT_KID', { infer: true });
  }

  // Підпис access: sub/jti/kid/exp у заголовку+тілі; алгоритм — явно ES256.
  signAccess(sub: string, role: Role, fam: string): { token: string; jti: string; exp: number } {
    const jti = randomUUID();
    const token = this.jwt.sign(
      { role, fam },
      { subject: sub, jwtid: jti, keyid: this.kid, algorithm: JWT_ALG, expiresIn: ACCESS_TTL_SEC },
    );
    const payload = this.jwt.decode(token) as { exp: number };
    return { token, jti, exp: payload.exp };
  }

  // Верифікація з ЯВНИМ allowlist алгоритмів — єдиний надійний запобіжник від algorithm
  // confusion (RFC 8725 §3.1): без нього атака підміняє alg на none/HS256 з публічним ключем
  // як «секретом». Будь-яка невдача (протух/зіпсований/підмінений підпис) → 401.
  verifyAccess(token: string): AccessClaims {
    try {
      return this.jwt.verify<AccessClaims>(token, { algorithms: [JWT_ALG] });
    } catch {
      throw new UnauthorizedException('invalid or expired access token');
    }
  }
}
