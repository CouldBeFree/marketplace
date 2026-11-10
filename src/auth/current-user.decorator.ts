import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AccessClaims } from './token.service';

// Дістати claims, які JwtAuthGuard поклав у req.user (sub/role/fam/jti/exp).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessClaims => {
    return ctx.switchToHttp().getRequest<Request & { user: AccessClaims }>().user;
  },
);
