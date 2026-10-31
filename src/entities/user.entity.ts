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

// users: id bigint IDENTITY PK, email UNIQUE, full_name, balance_cents, created_at timestamptz
@Entity('users')
@Check('CHK_users_balance_cents', '"balance_cents" >= 0')
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

  // ДЗ #24: роль — ДЖЕРЕЛО ПРАВДИ для RBAC (у токені вона лише кеш до exp).
  @Column({ type: 'text', default: 'buyer' })
  role: 'buyer' | 'seller' | 'admin';

  // ДЗ #24: scrypt-хеш пароля (node:crypto), не голий пароль. Nullable — сід-юзери без логіну.
  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash: string | null;

  // баланс покупця в копійках; списання при checkout — UPDATE ... WHERE balance_cents >= $sum
  @Column({ type: 'integer', name: 'balance_cents', default: 0 })
  balanceCents: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  // продавець → його товари (RESTRICT з боку Product захищає історію)
  @OneToMany(() => Product, (product) => product.seller)
  products: Product[];

  // покупець → його замовлення (RESTRICT з боку Order)
  @OneToMany(() => Order, (order) => order.buyer)
  orders: Order[];
}
