import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './entities/user.entity';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';

// Підключення приходить ВИКЛЮЧНО з оточення (process.env.DB_URL), яке наповнює
// scripts/with-secrets.sh зі сховища ДЗ #11 (або грейдер через SKIP_VAULT=1).
// Жодного зашитого хоста/пароля тут немає.
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DB_URL,
  synchronize: false, // схему створюють міграції, не автосинк
  logging: false,
  entities: [User, Product, Order, OrderItem],
  migrations: [__dirname + '/migrations/*.js'], // скомпільовані міграції з dist/
});

