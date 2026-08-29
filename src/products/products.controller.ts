import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

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
}
