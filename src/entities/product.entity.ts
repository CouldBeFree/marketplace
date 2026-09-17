import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { User } from './user.entity';

// products: id bigint IDENTITY PK, seller_id FK→users, title, price_cents integer, created_at
@Entity('products')
@Check('CHK_products_price_cents', '"price_cents" >= 0')
@Check('CHK_products_stock', '"stock" >= 0')
export class Product {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'bigint', name: 'seller_id' })
  sellerId: string;

  // seller_id → users.id: продавця не можна видалити, поки в нього є товари → RESTRICT
  @ManyToOne(() => User, (user) => user.products, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'seller_id' })
  seller: User;

  @Column({ type: 'text' })
  title: string;

  // гроші — integer у мінорних одиницях (копійки); не float і не рядок-decimal
  @Column({ type: 'integer', name: 'price_cents' })
  priceCents: number;

  // залишок на складі; захист від oversell — атомарний UPDATE ... WHERE stock >= $n
  @Column({ type: 'int', default: 0 })
  stock: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
