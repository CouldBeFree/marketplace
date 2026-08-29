import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Order } from '../common/models';
import { paginate } from '../common/pagination';
import { ProductsService } from '../products/products.service';

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

  constructor(private readonly products: ProductsService) {}

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

  create(key: string, body: OrderCreateBody): { order: Order; replay: boolean } {
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
    this.idempotencyStore.set(key, { bodyKey, status: 201, response: order });
    return { order, replay: false };
  }
}
