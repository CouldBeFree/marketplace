import { SetMetadata } from '@nestjs/common';
import { Role } from './token.service';

export const ROLES_KEY = 'roles';

// @Roles('seller','admin') на хендлері → RolesGuard вимагає одну з цих ролей (інакше 403).
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
