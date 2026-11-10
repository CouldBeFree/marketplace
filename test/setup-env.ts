import { generateKeyPairSync, randomBytes } from 'crypto';
import { testDbUrl } from './integration/testkit/db';

// @nestjs/config валідить env у момент forRoot() — тобто коли вантажиться AppModule
// (на import у E2E/provider-тесті), ще ДО beforeAll. Тому DB_URL треба виставити тут,
// у setupFiles (вони виконуються після globalSetup, але до завантаження тест-модулів).
// Для integration/consumer-suite AppModule не вантажиться — DB_URL їм не потрібен.
try {
  if (!process.env.DB_URL) {
    process.env.DB_URL = testDbUrl();
  }
} catch {
  // .db-url ще не створено (suite без testcontainer) — тут DB_URL не потрібен
}

// ДЗ #24: ті самі міркування — JWT-ключі мають бути в env ДО завантаження AppModule. Тести у
// сховище не ходять, тож генеруємо ЕФЕМЕРНУ пару ES256 на прогін (не чіпаємо реальні dev-ключі).
if (!process.env.JWT_PRIVATE_KEY) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY = Buffer.from(privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');
  process.env.JWT_KID = 'test';
  process.env.REFRESH_TOKEN_PEPPER = randomBytes(32).toString('base64url');
}
