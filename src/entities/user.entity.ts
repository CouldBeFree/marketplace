import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Check,
} from 'typeorm';
import { Product } from './product.entity';
import { Order } from './order.entity';

// users: id bigint IDENTITY PK, email UNIQUE, full_name, balance, created_at timestamptz
@Entity('users')
@Check('CHK_users_balance', '"balance" >= 0')
export class User {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string; // bigint → рядок у JS

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text', name: 'full_name' })
  fullName: string;

  // баланс покупця; списання при checkout — атомарний UPDATE ... WHERE balance >= $sum
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  balance: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // продавець → його товари (RESTRICT з боку Product захищає історію)
  @OneToMany(() => Product, (product) => product.seller)
  products: Product[];

  // покупець → його замовлення (RESTRICT з боку Order)
  @OneToMany(() => Order, (order) => order.buyer)
  orders: Order[];
}
