import 'reflect-metadata';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Verifier, VerifierOptions } from '@pact-foundation/pact';
import { AppModule } from '../../src/app.module';
import { attachPreInit, attachPostInit } from '../../src/http/configure-app';
import { testDbUrl } from '../integration/testkit/db';

const PROVIDER = 'marketplace-api';
// версія провайдера — та сама, що потім тегнемо prod для can-i-deploy
const PROVIDER_VERSION = process.env.PROVIDER_VERSION ?? '1.0.0';
const PORT = Number(process.env.PROVIDER_PORT ?? 3999);

// Provider verification: піднімаємо СПРАВЖНІЙ застосунок і верифаєр Pact прогонить
// проти нього всі interactions контракту. Адреса/токен брокера — ЛИШЕ з process.env
// (локально приїжджають обгорткою зі сховища ДЗ #11, у CI — з secrets GitHub).
describe('contract: provider verification (marketplace-api)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.DB_URL = testDbUrl();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    attachPreInit(app);
    await app.init();
    attachPostInit(app);
    await app.listen(PORT);
  });

  afterAll(async () => {
    await app.close();
  });

  it('реальний застосунок задовольняє всі interactions контракту', async () => {
    const brokerUrl = process.env.PACT_BROKER_URL;

    const opts: VerifierOptions = {
      provider: PROVIDER,
      providerBaseUrl: `http://127.0.0.1:${PORT}`,
      providerVersion: PROVIDER_VERSION,
      // stateHandlers сідять потрібний стан під кожен provider state.
      // prod_1 завжди є в in-memory ProductsService → стан уже виконано.
      stateHandlers: {
        // prod_1 завжди є в in-memory ProductsService → стан уже виконано (no-op)
        'product prod_1 exists': async (): Promise<void> => undefined,
      },
    };

    if (brokerUrl) {
      // шлях через брокер: тягнемо контракт і ПУБЛІКУЄМО результат верифікації
      opts.pactBrokerUrl = brokerUrl;
      // токен виставляємо ЛИШЕ коли він є (локальний compose-брокер — без авторизації)
      if (process.env.PACT_BROKER_TOKEN) {
        opts.pactBrokerToken = process.env.PACT_BROKER_TOKEN;
      }
      opts.publishVerificationResult = true;
      opts.consumerVersionSelectors = [{ latest: true }];
    } else {
      // локальний шлях: верифікуємо проти згенерованого файла-контракту
      opts.pactUrls = [
        path.resolve(process.cwd(), 'pacts', 'marketplace-web-marketplace-api.json'),
      ];
    }

    await new Verifier(opts).verifyProvider();
  });
});
