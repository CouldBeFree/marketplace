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
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdersService } from './orders.service';
import { OrderEvent, OrderEventsService } from './order-events.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AccessClaims } from '../auth/token.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  // Список замовлень — лише автентифікованим, і покупець бачить ЛИШЕ свої (admin — усі).
  // Раніше був без гарда: анонім діставав 200 з чужими замовленнями.
  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @CurrentUser() user: AccessClaims,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.orders.list(limit === undefined ? undefined : Number(limit), cursor, user);
  }

  // RBAC рівня ВЛАСНОСТІ. Це НЕ гард: гард стоїть до завантаження ресурсу й даних про власника
  // не має. Спершу завантажуємо замовлення (404, якщо нема — навіть власнику), ТОДІ звіряємо
  // власника з особою токена. Чуже замовлення під валідним токеном → 403 (НЕ 401). admin — виняток.
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  get(@Param('id') id: string, @CurrentUser() user: AccessClaims) {
    const order = this.orders.get(id); // 404, якщо немає
    if (user.role !== 'admin' && this.orders.ownerOf(id) !== user.sub) {
      throw new ForbiddenException('not your order');
    }
    return order;
  }

  // Створити замовлення може лише автентифікований користувач; власник = особа з ТОКЕНА
  // (раніше довіряли заголовку X-User-Id — будь-хто міг створити від чийого завгодно імені).
  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async create(
    @Headers('idempotency-key') key: string,
    @CurrentUser() user: AccessClaims,
    @Body() body: { items: { product_id: string; quantity: number }[] },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, replay } = await this.orders.create(key, body, user.sub);
    if (replay) {
      res.setHeader('Idempotency-Replay', 'true');
    }
    return order;
  }

  // Зміна статусу — тригер realtime-події. Лише автентифікованим і лише на СВОЄ замовлення
  // (admin — на будь-яке). Раніше без гарда: анонім міняв статус чужого замовлення й діставав 200.
  @Patch(':id/status')
  @UseGuards(JwtAuthGuard)
  changeStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @CurrentUser() user: AccessClaims,
  ) {
    this.orders.get(id); // 404, якщо немає (перевіряємо ДО власності, як у GET /:id)
    if (user.role !== 'admin' && this.orders.ownerOf(id) !== user.sub) {
      throw new ForbiddenException('not your order');
    }
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
