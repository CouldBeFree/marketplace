/** @type {import('jest').Config} */
module.exports = {
  // ts-jest компілює TS із нашим tsconfig (декоратори + emitDecoratorMetadata),
  // esbuild-трансформери метадані декораторів не емітять — тому саме ts-jest.
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/test/**/*.(test|spec).ts'],

  // Один testcontainers-Postgres на прогін jest: піднімається з коду, міграції
  // накочуються у setup, контейнер зупиняється у teardown.
  globalSetup: '<rootDir>/test/integration/testkit/global-setup.ts',
  globalTeardown: '<rootDir>/test/integration/testkit/global-teardown.ts',

  // Виставити DB_URL із testcontainer ДО завантаження AppModule (ConfigModule валідить
  // env на forRoot(), тобто на import) — інакше E2E/provider падають без локального .env.
  setupFiles: ['<rootDir>/test/setup-env.ts'],

  // Фіксований репортер: інакше Jest 30 у частині середовищ (detectAgent) вмикає
  // компактний 'agent'-репортер без PASS/назв/✓ — і решту критеріїв ніхто не побачить.
  reporters: ['default'],

  // Кожен jest-воркер множить testcontainers → тримаємо один воркер.
  maxWorkers: 1,

  // Контейнери стартують небистро — даємо тестам достатній таймаут.
  testTimeout: 120000,
};
