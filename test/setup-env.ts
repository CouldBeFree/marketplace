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
