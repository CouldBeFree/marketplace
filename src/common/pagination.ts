export function paginate<T extends { id: string }>(
  all: T[],
  limit = 20,
  cursor?: string,
): { items: T[]; next_cursor: string | null } {
  const size = Number(limit) || 20;
  let start = 0;
  if (cursor !== undefined && cursor !== '') {
    const lastId = Buffer.from(cursor, 'base64url').toString('utf8');
    const idx = all.findIndex((x) => x.id === lastId);
    start = idx === -1 ? all.length : idx + 1;
  }
  const items = all.slice(start, start + size);
  const hasMore = start + size < all.length;
  const next_cursor = hasMore
    ? Buffer.from(items[items.length - 1].id).toString('base64url')
    : null;
  return { items, next_cursor };
}
