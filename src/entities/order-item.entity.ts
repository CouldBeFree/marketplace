import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

// order_items: id bigint IDENTITY PK, order_id FK→orders (CASCADE),
//              product_id FK→products (RESTRICT), quantity int, unit_price_cents integer
//
// M:N між orders і products несе дані на зв'язку (кількість, ціна на момент),
// тому це явна join-entity, а не @ManyToMany.
@Entity('order_items')
@Check('CHK_order_items_quantity', '"quantity" > 0')
@Check('CHK_order_items_unit_price_cents', '"unit_price_cents" >= 0')
// індекси на FK-колонки: без них join у report і наївний цикл ідуть seq scan
@Index('order_items_order_id_idx', ['orderId'])
@Index('order_items_product_id_idx', ['productId'])
export class OrderItem {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'bigint', name: 'order_id' })
  orderId: string;

  // order_id → orders.id: позиції належать замовленню й гинуть разом → CASCADE
  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'bigint', name: 'product_id' })
  productId: string;

  // product_id → products.id: товар не видалити, поки він у чиємусь замовленні → RESTRICT
  @ManyToOne(() => Product, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'int' })
  quantity: number;

  // гроші — integer у мінорних одиницях (копійки)
  @Column({ type: 'integer', name: 'unit_price_cents' })
  unitPriceCents: number;
}
