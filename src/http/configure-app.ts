import express, { NextFunction, Request, Response } from 'express';
import { middleware as openApiValidator } from 'express-openapi-validator';
import { NestExpressApplication } from '@nestjs/platform-express';
import { resolveFromRoot } from '../config/paths';
import { ProblemJsonFilter } from '../common/problem-json.filter';

// Спільна конфігурація HTTP-застосунку — щоб і прод (main.ts), і E2E-тести ганяли
// ОДНАКОВИЙ застосунок (той самий валідатор спеки, той самий error-mapping у problem+json).

// До app.init(): json → валідатор спеки → глобальний filter.
export function attachPreInit(app: NestExpressApplication): void {
  const instance = app.getHttpAdapter().getInstance();
  instance.use(express.json());
  instance.use(
    openApiValidator({
      apiSpec: resolveFromRoot('openapi/openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^\/health/,
    }),
  );
  app.useGlobalFilters(new ProblemJsonFilter());
}

// Після app.init(): express-error-handler останнім (arity-4), ловить next(err) від валідатора.
export function attachPostInit(app: NestExpressApplication): void {
  const instance = app.getHttpAdapter().getInstance();
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
}
