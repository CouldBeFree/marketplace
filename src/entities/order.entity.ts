import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
  Check,
} from 'typeorm';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';

// orders: id bigint IDENTITY PK, buyer_id FK→users, status, shipping_name,
//         total numeric(12,2), created_at
@Entity('orders')
@Check('CHK_orders_total', '"total" >= 0')
@Check(
  'CHK_orders_status',
  `"status" IN ('pending','paid','shipped','completed','cancelled')`,
)
// composite: замовлення покупця за період (q1); DESC додам у міграції руками
@Index('orders_buyer_created_idx', ['buyerId', 'createdAt'])
// partial: черга у статусі pending (q2) — індекс лише по pending-рядках
@Index('orders_pending_created_idx', ['createdAt'], {
  where: `status = 'pending'`,
})
export class Order {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'bigint', name: 'buyer_id' })
  buyerId: string;

  // buyer_id → users.id: покупця не видалити, поки є його замовлення → RESTRICT
  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'buyer_id' })
  buyer: User;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'text', name: 'shipping_name' })
  shippingName: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  total: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // замовлення → його позиції; діти йдуть за батьком (CASCADE з боку OrderItem)
  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];
}
