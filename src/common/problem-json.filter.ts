import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = 500;
    let title = 'Internal Server Error';
    let detail = 'Unexpected error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      title = exception.constructor.name.replace(/Exception$/, '') || 'Error';
      const body = exception.getResponse();
      const raw =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>).message ?? exception.message);
      detail = Array.isArray(raw) ? raw.join('; ') : String(raw);
    } else if (exception && typeof exception === 'object') {
      const e = exception as { status?: number; statusCode?: number; name?: string; message?: string };
      status = e.status ?? e.statusCode ?? 500;
      title = e.name ?? title;
      detail = e.message ?? detail;
    }

    if (res.headersSent) return;

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title,
        status,
        detail,
        instance: req.originalUrl,
      });
  }
}
