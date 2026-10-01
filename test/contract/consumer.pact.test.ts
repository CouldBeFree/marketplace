import * as path from 'path';
import request from 'supertest';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';

const { like } = MatchersV3;

// Consumer-тест (уявний фронтенд marketplace-web) описує контракт на ендпойнт зі
// спеки ДЗ #9: GET /products/{id}. Генерує pacts/marketplace-web-marketplace-api.json
// із provider state. Матчери like() — щоб контракт не ламався від конкретних значень.
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
});
