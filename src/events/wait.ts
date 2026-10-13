// Детерміноване очікування умови замість sleep: опитуємо предикат, поки не true або таймаут.
// Демо спираються на фактичний стан (лічильники доставок, глибина черги), а не на «почекати N мс».
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`waitUntil: таймаут ${timeoutMs}мс${opts.label ? ` (${opts.label})` : ''}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
