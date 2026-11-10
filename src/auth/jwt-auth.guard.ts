import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { TokenService, AccessClaims } from './token.service';
import { DenylistService } from './denylist.service';

// АВТЕНТИФІКАЦІЯ («хто це?»): перевіряється криптографією. Нема/протух/зіпсований/підмінений
// токен, або jti у денилисті → 401 (НЕ 403). Успіх → кладемо claims у req.user.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly denylist: DenylistService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AccessClaims }>();
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const claims = this.tokens.verifyAccess(header.slice('Bearer '.length).trim());
    if (await this.denylist.isDenied(claims.jti)) {
      throw new UnauthorizedException('token revoked (logged out)');
    }
    req.user = claims;
    return true;
  }
}
