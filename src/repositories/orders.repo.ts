import { Queryable } from './users.repo';

export interface NewOrder {
  buyerId: string;
  status: string;
  shippingName: string;
  totalCents: number;
}

export interface NewOrderItem {
  orderId: string;
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

export interface SellerRevenue {
  seller_id: string;
  revenue_cents: string; // SUM(bigint) приходить рядком
}

export class OrdersRepo {
  constructor(private readonly db: Queryable) {}

  async create(o: NewOrder): Promise<{ id: string }> {
    const { rows } = await this.db.query(
      `INSERT INTO orders (buyer_id, status, shipping_name, total_cents)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [o.buyerId, o.status, o.shippingName, o.totalCents],
    );
    return rows[0];
  }

  // FK order_items.product_id → products: неіснуючий товар дасть 23503.
  async addItem(i: NewOrderItem): Promise<void> {
    await this.db.query(
      `INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents)
       VALUES ($1, $2, $3, $4)`,
      [i.orderId, i.productId, i.quantity, i.unitPriceCents],
    );
  }

  // SQL-поведінка, якої мок не має: виторг по продавцях — JOIN + GROUP BY.
  async revenueBySeller(): Promise<SellerRevenue[]> {
    const { rows } = await this.db.query(
      `SELECT p.seller_id,
              SUM(oi.unit_price_cents * oi.quantity)::bigint AS revenue_cents
       FROM order_items oi
       JOIN products p ON p.id = oi.product_id
       JOIN orders   o ON o.id = oi.order_id
       WHERE o.status <> 'cancelled'
       GROUP BY p.seller_id
       ORDER BY revenue_cents DESC`,
    );
    return rows;
  }
}
