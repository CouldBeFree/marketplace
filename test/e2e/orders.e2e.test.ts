import 'reflect-metadata';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { attachPreInit, attachPostInit } from '../../src/http/configure-app';
import { TokenService } from '../../src/auth/token.service';
import { testDbUrl } from '../integration/testkit/db';

// E2E проти ПОВНОГО Nest (без підмін провайдерів), із тим самим конфігом, що й прод
// (attachPreInit/attachPostInit). БД приходить через env від testcontainer.
describe('E2E orders (supertest, повний Nest)', () => {
  let app: NestExpressApplication;
  let auth: string; // Bearer-токен покупця sub='1' (ДЗ #24: ендпойнти замовлень тепер захищені)

  beforeAll(async () => {
    process.env.DB_URL = testDbUrl(); // connection URI від testcontainer (globalSetup)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    attachPreInit(app);
    await app.init();
    attachPostInit(app);
    // мінтимо токен тим самим ключем, що й застосунок (ефемерний, із setup-env)
    auth = `Bearer ${app.get(TokenService).signAccess('1', 'buyer', randomUUID()).token}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('happy path: створити замовлення → прочитати його (власник)', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/orders')
      .set('Authorization', auth)
      .set('Idempotency-Key', 'e2e-happy-1')
      .send({ items: [{ product_id: 'prod_1', quantity: 2 }] })
      .expect(201);
    expect(created.body.id).toBeDefined();

    const read = await request(server)
      .get(`/orders/${created.body.id}`)
      .set('Authorization', auth)
      .expect(200);
    expect(read.body.id).toBe(created.body.id);
    expect(read.body.total_cents).toBe(created.body.total_cents);
  });

  it('негатив: GET неіснуючого замовлення → 404 (під валідним токеном)', async () => {
    await request(app.getHttpServer())
      .get('/orders/order_missing')
      .set('Authorization', auth)
      .expect(404);
  });

  it('негатив: POST без Idempotency-Key → 400 (валідатор спеки спрацьовує до гарда)', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', auth)
      .send({ items: [{ product_id: 'prod_1', quantity: 1 }] })
      .expect(400);
  });

  it('негатив: POST замовлення без токена → 401', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-noauth-1')
      .send({ items: [{ product_id: 'prod_1', quantity: 1 }] })
      .expect(401);
  });
});
