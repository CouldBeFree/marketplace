import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import { middleware as openApiValidator } from 'express-openapi-validator';
import { join } from 'path';
import { AppModule } from './app.module';
import { ProblemJsonFilter } from './common/problem-json.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const instance = app.getHttpAdapter().getInstance();

  instance.use(express.json());

  instance.use(
    openApiValidator({
      apiSpec: join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
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

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Marketplace API (Nest) on http://localhost:${port}`);
}

bootstrap();
