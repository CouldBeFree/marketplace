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

// products: id bigint IDENTITY PK, seller_id FK→users, title, price numeric(12,2), created_at
@Entity('products')
@Check('CHK_products_price', '"price" >= 0')
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

  // гроші — numeric(12,2) (точний тип, не float; TypeORM віддає його рядком)
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: string;

  // залишок на складі; захист від oversell — атомарний UPDATE ... WHERE stock >= $n
  @Column({ type: 'int', default: 0 })
  stock: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
