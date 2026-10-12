import 'reflect-metadata';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../../../src/entities/user.entity';
import { Product } from '../../../src/entities/product.entity';
import { Order } from '../../../src/entities/order.entity';
import { OrderItem } from '../../../src/entities/order-item.entity';
import { Task } from '../../../src/entities/task.entity';
import { Init1789199398268 } from '../../../src/migrations/1789199398268-Init';
import { Concurrency1789201579857 } from '../../../src/migrations/1789201579857-Concurrency';

// Jest globalSetup: піднімає ОДИН postgres:16-alpine контейнер із КОДУ, накочує на
// нього наші справжні міграції (ДЗ #13–14) і віддає connection URI тестам через
// process.env + файл (воркери читають з файла). Контейнер зупиняє global-teardown.
module.exports = async (): Promise<void> => {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const url = container.getConnectionUri();

  const ds = new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
    entities: [User, Product, Order, OrderItem, Task],
    migrations: [Init1789199398268, Concurrency1789201579857],
  });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();

  (globalThis as unknown as { __PG_CONTAINER__?: unknown }).__PG_CONTAINER__ = container;
  process.env.TEST_DATABASE_URL = url;
  fs.writeFileSync(path.join(__dirname, '.db-url'), url);

  // eslint-disable-next-line no-console
  console.log(`[testkit] postgres:16-alpine піднято, міграції накочено`);
};
