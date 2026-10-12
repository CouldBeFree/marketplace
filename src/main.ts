import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { AppModule } from './app.module';
import { Env } from './config/env.schema';
import { resolveFromRoot } from './config/paths';
import { attachPreInit, attachPostInit } from './http/configure-app';

async function assertPasswordFileReadable(config: ConfigService<Env, true>) {
  const passwordFile = resolveFromRoot(config.get('DB_PASSWORD_FILE', { infer: true }));
  let secret: string;
  try {
    secret = (await readFile(passwordFile, 'utf8')).trim();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`DB_PASSWORD_FILE не читається (${passwordFile}): ${reason}`);
  }
  if (!secret) {
    throw new Error(`DB_PASSWORD_FILE порожній (${passwordFile})`);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService) as ConfigService<Env, true>;
  await assertPasswordFileReadable(config);

  attachPreInit(app);
  await app.init();
  attachPostInit(app);

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`Marketplace API (Nest) on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
