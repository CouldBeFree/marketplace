import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AccessClaims } from './token.service';

// /auth/* — поза REST-контрактом openapi.yaml (як /health): у configure-app ці шляхи в
// ignorePaths, тож express-openapi-validator їх не чіпає (вони не ресурси, а обмін токенами).
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: string; password?: string }) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password required');
    }
    return this.auth.login(body.email, body.password); // { access, refresh }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: { refresh?: string }) {
    if (!body?.refresh) throw new BadRequestException('refresh token required');
    return this.auth.refresh(body.refresh); // нова пара; повтор/відкликано/протух → 401
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AccessClaims) {
    await this.auth.logout(user); // відкликає сімʼю refresh + денилистить jti access
    return { ok: true };
  }

  // Захищений «пінг» для demo:auth: нема/протух/денилист токен → 401; валідний → 200.
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AccessClaims) {
    return { sub: user.sub, role: user.role };
  }
}
