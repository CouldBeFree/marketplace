import {
  Body,
  Controller,
  ForbiddenException,
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

  // SSE-потік подій одного замовлення. Та сама перевірка власності, що й у WS-gateway:
  // клієнт шле X-User-Id і бачить ЛИШЕ свої замовлення (чуже/анонімне → 403 problem+json).
  // Поле id: — номер події, що зростає; підтримує Last-Event-ID (реплей пропущеного з буфера).
  @Get(':id/events')
  sse(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ): void {
    // Кидаємо ДО writeHead → глобальний ProblemJsonFilter віддасть 403 application/problem+json.
    if (!userId || this.orders.ownerOf(id) !== userId) {
      throw new ForbiddenException('not your order');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // темп реконекту клієнта (без цього дефолт кількасекундний — демо «висне»)
    res.write('retry: 1000\n\n');

    const since = Number(lastEventId);
    const hasSince = Number.isFinite(since) && since > 0;
    let lastSentId = hasSince ? since : 0;

    const send = (e: OrderEvent): void => {
      res.write(
        `id: ${e.id}\n` +
          `event: order.status\n` +
          `data: ${JSON.stringify({ orderId: e.orderId, status: e.status, at: e.at })}\n\n`,
      );
      lastSentId = e.id;
    };

    // Жива підписка — ПЕРШОЮ. Поки програємо реплей, нові події не шлемо одразу,
    // а складаємо в чергу — інакше подія між реплеєм і subscribe губилась би.
    let draining = true;
    const queued: OrderEvent[] = [];
    const sub = this.events.stream(id).subscribe((e) => {
      if (draining) {
        queued.push(e);
        return;
      }
      if (e.id > lastSentId) send(e);
    });

    // Реплей пропущеного за Last-Event-ID (історичні події з буфера, у порядку id).
    if (hasSince) {
      for (const e of this.events.replaySince(id, lastSentId)) {
        if (e.id > lastSentId) send(e);
      }
    }

    // Зливаємо події, що надійшли під час реплею; дедуп за id (що вже в буфері — не дублюємо).
    draining = false;
    for (const e of queued) {
      if (e.id > lastSentId) send(e);
    }

    res.on('close', () => {
      sub.unsubscribe();
      res.end();
    });
  }
}
