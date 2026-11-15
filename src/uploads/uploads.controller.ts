import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessClaims } from '../auth/token.service';

// Двокроковий контракт завантаження під гардом ДЗ #24. /uploads та /files — поза REST-контрактом
// openapi.yaml (у ignorePaths), це протокол завантаження, а не ресурс.
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('uploads/intent')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async intent(
    @CurrentUser() user: AccessClaims,
    // filename клієнт може надіслати — ми його ІГНОРУЄМО для ключа (демонстрація key-from-server).
    @Body() body: { contentType?: string; size?: number; filename?: string },
  ) {
    if (!body?.contentType) throw new BadRequestException('contentType required');
    return this.uploads.intent(user.sub, body.contentType, body.size);
  }

  @Post('uploads/commit')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async commit(@CurrentUser() user: AccessClaims, @Body() body: { fileId?: string }) {
    if (!body?.fileId) throw new BadRequestException('fileId required');
    return this.uploads.commit(user.sub, body.fileId);
  }

  // GET /files/:id → 302 на свіжий presigned (сервіс у шляху авторизації, не даних).
  @Get('files/:id')
  @UseGuards(JwtAuthGuard)
  async redirect(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Res() res: Response) {
    const url = await this.uploads.freshGetUrl(user.sub, id);
    res.redirect(302, url);
  }
}
