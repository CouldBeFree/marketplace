import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Order } from '../common/models';
import { paginate } from '../common/pagination';
import { ProductsService } from '../products/products.service';
import { OrderEventsService } from './order-events.service';

interface OrderCreateBody {
  items: { product_id: string; quantity: number }[];
}

interface IdempotencyRecord {
  bodyKey: string;
  status: number;
  response: Order;
}

@Injectable()
export class OrdersService {
  private readonly orders: Order[] = [];
  private seq = 0;
  private readonly idempotencyStore = new Map<string, IdempotencyRecord>();
  // власник замовлення (внутрішньо, НЕ у HTTP-відповіді — щоб не ламати контракт спеки)
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly products: ProductsService,
    private readonly events: OrderEventsService,
  ) {}

  list(limit?: number, cursor?: string) {
    return paginate(this.orders, limit, cursor);
  }

  get(id: string): Order {
    const order = this.orders.find((o) => o.id === id);
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  create(
    key: string,
    body: OrderCreateBody,
    ownerId: string,
  ): { order: Order; replay: boolean } {
    const bodyKey = JSON.stringify(body);
    const saved = this.idempotencyStore.get(key);
    if (saved) {
      if (saved.bodyKey === bodyKey) {
        return { order: saved.response, replay: true };
      }
      throw new UnprocessableEntityException(
        `Idempotency-Key '${key}' was already used with a different request body`,
      );
    }

    const items = body.items.map((line) => {
      const product = this.products.find(line.product_id);
      if (!product) {
        throw new UnprocessableEntityException(`Product ${line.product_id} not found`);
      }
      return {
        product_id: product.id,
        quantity: line.quantity,
        unit_price_cents: product.price_cents,
      };
    });

    const total_cents = items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0);
    const currency = this.products.find(items[0].product_id)!.currency;

    const order: Order = {
      id: `order_${++this.seq}`,
      status: 'created',
      items,
      total_cents,
      currency,
      created_at: new Date().toISOString(),
    };

    this.orders.push(order);
    this.owners.set(order.id, ownerId || 'anonymous');
    this.idempotencyStore.set(key, { bodyKey, status: 201, response: order });
    return { order, replay: false };
  }

  ownerOf(id: string): string | undefined {
    return this.owners.get(id);
  }

  // Зміна статусу → emit у шину (WS/SSE). Emit іде ЗВІДСИ (бізнес-логіка), не з контролера.
  changeStatus(id: string, status: string): Order {
    const order = this.get(id); // кидає 404, якщо немає
    order.status = status;
    this.events.publish(id, status);
    return order;
  }
}
