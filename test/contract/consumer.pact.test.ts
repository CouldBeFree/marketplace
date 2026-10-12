import * as path from 'path';
import request from 'supertest';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like, eachLike } = MatchersV3;

// Consumer-тест (уявний фронтенд marketplace-web) описує контракт на ДВА ендпойнти зі
// спеки ДЗ #9: GET /products/{id} і POST /orders (створення з Idempotency-Key). Генерує
// pacts/marketplace-web-marketplace-api.json із provider state. Матчери like()/eachLike() —
// щоб контракт перевіряв форму/типи, а не конкретні значення.
const provider = new PactV3({
  consumer: 'marketplace-web',
  provider: 'marketplace-api',
  dir: path.resolve(process.cwd(), 'pacts'),
});

describe('contract: products (consumer)', () => {
  it('GET /products/{id} повертає товар', async () => {
    provider
      .given('product prod_1 exists')
      .uponReceiving('a request for product prod_1')
      .withRequest({ method: 'GET', path: '/products/prod_1' })
      .willRespondWith({
        status: 200,
        body: like({
          id: 'prod_1',
          name: 'Кавоварка',
          price_cents: 2600,
          currency: 'UAH',
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await request(mockServer.url).get('/products/prod_1').expect(200);
      expect(res.body.id).toBe('prod_1');
      expect(typeof res.body.price_cents).toBe('number');
    });
  });

  it('POST /orders створює замовлення (Idempotency-Key)', async () => {
    provider
      .given('product prod_1 exists')
      .uponReceiving('a request to create an order for prod_1')
      .withRequest({
        method: 'POST',
        path: '/orders',
        headers: {
          'Content-Type': 'application/json',
          // required-заголовок зі спеки #9: ідемпотентність створення
          'Idempotency-Key': 'pact-create-1',
        },
        body: { items: [{ product_id: 'prod_1', quantity: 2 }] },
      })
      .willRespondWith({
        status: 201,
        body: like({
          id: 'order_1',
          status: 'created',
          items: eachLike({ product_id: 'prod_1', quantity: 2, unit_price_cents: 2600 }),
          total_cents: 5200,
          currency: 'UAH',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await request(mockServer.url)
        .post('/orders')
        .set('Idempotency-Key', 'pact-create-1')
        .set('Content-Type', 'application/json')
        .send({ items: [{ product_id: 'prod_1', quantity: 2 }] })
        .expect(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('created');
      expect(typeof res.body.total_cents).toBe('number');
    });
  });
});
