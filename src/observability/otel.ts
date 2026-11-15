import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// OTel ініціалізуємо ДО створення HTTP-сервера (http-інструментування має встигнути пропатчити
// node:http) — інакше автоінструментуванню нема що патчити. Демо кличуть startOtel() першою дією,
// а застосунок імпортують ДИНАМІЧНО після неї. Пропагатор за замовчуванням — W3C Trace Context,
// тож вхідний traceparent продовжується: серверний спан дістає trace-id із заголовка.

let sdk: NodeSDK | undefined;
let memory: InMemorySpanExporter | undefined;
let processor: SpanProcessor | undefined;

export function startOtel(opts: { inMemory?: boolean; serviceName?: string } = {}): void {
  if (sdk) return;
  if (opts.inMemory) {
    // Демо: in-memory + SimpleSpanProcessor (негайний експорт) — детерміновано, без мережі й беку.
    memory = new InMemorySpanExporter();
    processor = new SimpleSpanProcessor(memory);
  } else {
    // Прод: OTLP-експортер у колектор (адреса зі сховища #11), батчевий процесор.
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const exporter = new OTLPTraceExporter(
      endpoint ? { url: `${endpoint.replace(/\/$/, '')}/v1/traces` } : {},
    );
    processor = new BatchSpanProcessor(exporter);
  }
  sdk = new NodeSDK({
    resource: new Resource({ 'service.name': opts.serviceName ?? 'marketplace-obs' }),
    spanProcessors: [processor],
    // ЯВНИЙ W3C-пропагатор: http-інструментування витягує вхідний traceparent саме ним, тож
    // серверний спан продовжує той самий trace-id (без цього він починав би новий трейс).
    textMapPropagator: new W3CTraceContextPropagator(),
    // requireParentforOutgoingSpans: вихідний HTTP-клієнт БЕЗ батьківського спана не
    // інструментується — інакше у демо клієнтський запит перезаписував би ручний traceparent
    // своїм, і сервер продовжував би трейс клієнта, а не заголовок. У проді це коректно: вихідні
    // спани лишаються лише в контексті вхідного запиту.
    instrumentations: [new HttpInstrumentation({ requireParentforOutgoingSpans: true })],
  });
  sdk.start();
}

export function getFinishedSpans(): ReadableSpan[] {
  return memory ? memory.getFinishedSpans() : [];
}

export function resetSpans(): void {
  memory?.reset();
}

// Батчевий експортер шле спани не одразу — forceFlush ПЕРЕД читанням (інакше spans=0). У демо з
// SimpleSpanProcessor це no-op, але тримаємо виклик для симетрії з прод-режимом.
export async function forceFlush(): Promise<void> {
  await processor?.forceFlush();
}

export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
  sdk = undefined;
  memory = undefined;
  processor = undefined;
}
