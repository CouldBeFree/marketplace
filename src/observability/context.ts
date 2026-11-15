import { AsyncLocalStorage } from 'async_hooks';

// Корелятори запиту живуть у КОНТЕКСТІ (AsyncLocalStorage), а не в аргументах функцій: жодна
// функція не приймає req заради логування. userId (#24), tenant, idempotencyKey (#22) — тут.
// trace_id сюди НЕ кладемо: він береться з активного спана OTel у mixin логера (інакше корелятор
// був би власний, і критерій trace-matches-* не пройшов би).
export interface RequestContext {
  userId?: string;
  tenant?: string;
  idempotencyKey?: string;
}

export const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function currentContext(): RequestContext {
  return als.getStore() ?? {};
}
