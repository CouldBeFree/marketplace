import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { currentContext } from './context';

export interface LoggerOptions {
  stream?: pino.DestinationStream; // демо підставляє потік-колектор; прод — stdout
  level?: string;
}

// Шляхи redaction ОПИСАНІ явно (redact не вгадує шляхи): токен Authorization, паролі й тіла
// автентифікації з #24 у лог не потрапляють. Вкладений об'єкт без описаного шляху НЕ ховається —
// тому перелічуємо точно ті місця, куди застосунок кладе чутливе.
const REDACT_PATHS = [
  'authorization',
  'headers.authorization',
  'req.headers.authorization',
  'password',
  'body.password',
  'req.body.password',
];

export function createLogger(opts: LoggerOptions = {}): pino.Logger {
  return pino(
    {
      level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
      // mixin додає корелятори в КОЖЕН рядок: trace_id з АКТИВНОГО СПАНА OTel (не власний uuid!) +
      // userId/tenant/idempotencyKey з AsyncLocalStorage.
      mixin() {
        const out: Record<string, unknown> = { ...currentContext() };
        const span = trace.getActiveSpan();
        if (span) {
          const sc = span.spanContext();
          out.trace_id = sc.traceId;
          out.span_id = sc.spanId;
        }
        return out;
      },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    opts.stream ?? pino.destination({ fd: 1 }), // stdout (НЕ файл); pino-pretty — лише локально
  );
}

// Дочірній логер, що НАЗИВАЄ компонент (шар). Запит проходить ≥3 шари — controller → service →
// repo — з тим самим trace_id.
export function childLayer(logger: pino.Logger, layer: string): pino.Logger {
  return logger.child({ layer });
}
