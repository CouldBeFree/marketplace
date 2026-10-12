import { OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';

interface JoinAck {
  ok: boolean;
  room?: string;
  error?: string;
}

// WebSocket-gateway (socket.io). Клієнт автентифікується handshake.auth.userId,
// після join потрапляє в кімнату orders:<id> ЛИШЕ якщо він власник замовлення.
@WebSocketGateway({ cors: { origin: '*' } })
export class OrdersGateway implements OnModuleInit {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  // Одна шина → кожну подію маршрутизуємо ТІЛЬКИ в кімнату orders:<id> (server.to),
  // а не всім. Клієнти, що не в кімнаті, події не чують.
  onModuleInit(): void {
    this.events.all().subscribe((e) => {
      this.server.to(`orders:${e.orderId}`).emit('order.status', {
        orderId: e.orderId,
        id: e.id,
        status: e.status,
        at: e.at,
      });
    });
  }

  @SubscribeMessage('join')
  join(
    @MessageBody() payload: { orderId: string },
    @ConnectedSocket() client: Socket,
  ): JoinAck {
    const orderId = payload?.orderId;
    const userId = client.handshake.auth?.userId as string | undefined;

    if (!userId) {
      return { ok: false, error: 'anonymous not allowed' };
    }
    if (!orderId || this.orders.ownerOf(orderId) !== userId) {
      return { ok: false, error: 'not your order' };
    }

    client.join(`orders:${orderId}`);
    return { ok: true, room: `orders:${orderId}` };
  }
}
