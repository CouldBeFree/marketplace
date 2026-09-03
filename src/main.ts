import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import express, { NextFunction, Request, Response } from 'express';
import { middleware as openApiValidator } from 'express-openapi-validator';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppModule } from './app.module';
import { Env } from './config/env.schema';
import { resolveFromRoot } from './config/paths';
import { ProblemJsonFilter } from './common/problem-json.filter';

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
  const instance = app.getHttpAdapter().getInstance();

  instance.use(express.json());

  instance.use(
    openApiValidator({
      apiSpec: join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^\/health/,
    }),
  );

  app.useGlobalFilters(new ProblemJsonFilter());

  await app.init();
  instance.use((err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    const status = err?.status ?? err?.statusCode ?? 500;
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: err?.name || (status === 500 ? 'Internal Server Error' : 'Error'),
        status,
        detail: err?.message || 'Unexpected error',
        instance: req.originalUrl,
      });
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`Marketplace API (Nest) on http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
