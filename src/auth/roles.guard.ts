import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ROLES_KEY } from './roles.decorator';
import { AccessClaims, Role } from './token.service';

// АВТОРИЗАЦІЯ рівня РОЛІ («чи можна йому це?»): криптографією не перевіряється. Токен уже
// валідний (JwtAuthGuard пройшов), але ролі бракує → 403 (НЕ 401). Роль беремо з токена-кешу.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true; // ролі не вимагаються

    const req = ctx.switchToHttp().getRequest<Request & { user?: AccessClaims }>();
    const role = req.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        `role '${role ?? 'none'}' not permitted; requires one of: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
