import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.orders.list(limit === undefined ? undefined : Number(limit), cursor);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.get(id);
  }

  @Post()
  @HttpCode(201)
  create(
    @Headers('idempotency-key') key: string,
    @Body() body: { items: { product_id: string; quantity: number }[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, replay } = this.orders.create(key, body);
    if (replay) {
      res.setHeader('Idempotency-Replay', 'true');
    }
    return order;
  }
}
