import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { OrderEvent, OrderEventsService } from './order-events.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

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
    @Headers('x-user-id') userId: string,
    @Body() body: { items: { product_id: string; quantity: number }[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, replay } = this.orders.create(key, body, userId);
    if (replay) {
      res.setHeader('Idempotency-Replay', 'true');
    }
    return order;
  }

  // Зміна статусу — тригер realtime-події. Сам emit робить OrdersService (бізнес-логіка).
  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.orders.changeStatus(id, body.status);
  }

  // SSE-потік подій одного замовлення. Відкритий (грейдер курлить без авторизації).
  // Поле id: — номер події, що зростає; підтримує Last-Event-ID (реплей пропущеного з буфера).
  @Get(':id/events')
  sse(
    @Param('id') id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // темп реконекту клієнта (без цього дефолт кількасекундний — демо «висне»)
    res.write('retry: 1000\n\n');

    const send = (e: OrderEvent): void => {
      res.write(
        `id: ${e.id}\n` +
          `event: order.status\n` +
          `data: ${JSON.stringify({ orderId: e.orderId, status: e.status, at: e.at })}\n\n`,
      );
    };

    // 1) реплей пропущеного за Last-Event-ID
    const since = Number(lastEventId);
    if (Number.isFinite(since) && since > 0) {
      for (const e of this.events.replaySince(id, since)) {
        send(e);
      }
    }

    // 2) жива підписка на нові події цього замовлення
    const sub = this.events.stream(id).subscribe(send);
    res.on('close', () => {
      sub.unsubscribe();
      res.end();
    });
  }
}
