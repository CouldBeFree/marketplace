import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { loadJwtKeys, JWT_ALG } from './keys';
import { TokenService } from './token.service';
import { DenylistService } from './denylist.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const keys = loadJwtKeys(
          config.get('JWT_PRIVATE_KEY', { infer: true }),
          config.get('JWT_PUBLIC_KEY', { infer: true }),
          config.get('JWT_KID', { infer: true }),
        );
        return {
          // ES256 чекає privateKey/publicKey, не secret. Типи @nestjs/jwt відстають (string|Buffer),
          // але jsonwebtoken@9 у рантаймі приймає KeyObject — рекомендований спосіб; тому каст.
          privateKey: keys.privateKey as unknown as string,
          publicKey: keys.publicKey as unknown as string,
          signOptions: { algorithm: JWT_ALG },
          // ЯВНИЙ allowlist алгоритмів у верифікації (RFC 8725 §3.1) — на рівні модуля + ще раз
          // у TokenService.verifyAccess. Без нього можлива algorithm-confusion атака.
          verifyOptions: { algorithms: [JWT_ALG] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [TokenService, DenylistService, AuthService, JwtAuthGuard, RolesGuard],
  // Гарди + TokenService/DenylistService експортуємо, щоб OrdersModule/ProductsModule могли
  // вішати @UseGuards(JwtAuthGuard/RolesGuard) на свої ресурси.
  exports: [TokenService, DenylistService, AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
