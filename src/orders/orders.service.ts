import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { pool } from '../db';
import { Order } from '../common/models';
import { paginate } from '../common/pagination';
import { ProductsService } from '../products/products.service';
import { OrderEventsService } from './order-events.service';

interface OrderCreateBody {
  items: { product_id: string; quantity: number }[];
}

@Injectable()
export class OrdersService {
  private readonly orders: Order[] = [];
  private seq = 0;
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

  // Ключ ідемпотентності на API-краю (ДЗ #22, рівень 3) — у таблиці idempotency_keys,
  // а НЕ в in-memory Map: сховище переживає рестарт процесу й спільне між інстансами
  // (Map жило рівно стільки, скільки под, і не існувало між двома подами). Ключ ідентифікує
  // НАМІР: той самий ключ + те саме тіло → replay збереженої відповіді; інше тіло → 422.
  async create(
    key: string,
    body: OrderCreateBody,
    ownerId: string,
  ): Promise<{ order: Order; replay: boolean }> {
    const bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    const prev = await pool.query(
      `SELECT body_hash, response FROM idempotency_keys WHERE key = $1`,
      [key],
    );
    if (prev.rowCount && prev.rows[0].response) {
      if (prev.rows[0].body_hash !== bodyHash) {
        throw new UnprocessableEntityException(
          `Idempotency-Key '${key}' was already used with a different request body`,
        );
      }
      return { order: prev.rows[0].response as Order, replay: true };
    }

    // будуємо замовлення ДО запису ключа: якщо товару немає — кидаємо 422 ще до claim,
    // тож невдалий запит не «спалює» ключ (повтор із тим самим ключем лишається дозволеним).
    const order = this.build(body);

    // claim+відповідь одним записом. ON CONFLICT ловить гонку двох однакових ключів:
    // 0 рядків = нас випередили → віддаємо вже збережену відповідь (replay), не дублюючи.
    const ins = await pool.query(
      `INSERT INTO idempotency_keys (key, body_hash, response) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (key) DO NOTHING
       RETURNING key`,
      [key, bodyHash, JSON.stringify(order)],
    );
    if (ins.rowCount === 0) {
      const raced = await pool.query(
        `SELECT body_hash, response FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      if (raced.rows[0]?.body_hash !== bodyHash) {
        throw new UnprocessableEntityException(
          `Idempotency-Key '${key}' was already used with a different request body`,
        );
      }
      return { order: raced.rows[0].response as Order, replay: true };
    }

    this.orders.push(order);
    this.owners.set(order.id, ownerId || 'anonymous');
    return { order, replay: false };
  }

  private build(body: OrderCreateBody): Order {
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

    return {
      id: `order_${++this.seq}`,
      status: 'created',
      items,
      total_cents,
      currency,
      created_at: new Date().toISOString(),
    };
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
