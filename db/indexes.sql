CREATE INDEX IF NOT EXISTS orders_buyer_created_idx
  ON orders (buyer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_pending_created_idx
  ON orders (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS orders_shipping_name_lower_idx
  ON orders (lower(shipping_name));
