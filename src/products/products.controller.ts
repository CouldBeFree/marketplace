import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.products.list(limit === undefined ? undefined : Number(limit), cursor);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  // RBAC рівня РОЛІ: запис у каталог — лише продавець/адмін. Покупець із валідним токеном → 403
  // (RolesGuard), анонім → 401 (JwtAuthGuard). Порядок гардів: спершу автентифікація, потім роль.
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  create(@Body() body: { name: string; price_cents: number; currency?: string }) {
    return this.products.create(body);
  }
}
