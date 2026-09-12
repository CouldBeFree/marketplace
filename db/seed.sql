INSERT INTO users (email, full_name)
SELECT 'user' || g || '@example.com', 'User ' || g
FROM generate_series(1, 5000) AS g;

INSERT INTO products (seller_id, title, price)
SELECT (1 + floor(random() * 5000))::bigint,
       'Product ' || g,
       (5 + floor(random() * 99500) / 100.0)::numeric(12,2)
FROM generate_series(1, 2000) AS g;

INSERT INTO orders (buyer_id, status, shipping_name, total, created_at)
SELECT b.buyer_id,
       CASE
         WHEN b.r < 0.70 THEN 'completed'
         WHEN b.r < 0.82 THEN 'shipped'
         WHEN b.r < 0.90 THEN 'paid'
         WHEN b.r < 0.97 THEN 'pending'
         ELSE 'cancelled'
       END,
       'Customer ' || b.buyer_id,
       (1 + floor(random() * 500000) / 100.0)::numeric(12,2),
       now() - (random() * interval '365 days')
FROM (
  SELECT (1 + floor(random() * 5000))::bigint AS buyer_id,
         random() AS r
  FROM generate_series(1, 100000)
) AS b;

INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT s.order_id,
       (1 + floor(random() * 2000))::bigint,
       (1 + floor(random() * 5))::int,
       (1 + floor(random() * 50000) / 100.0)::numeric(12,2)
FROM (
  SELECT o AS order_id, (1 + floor(random() * 4))::int AS n
  FROM generate_series(1, 100000) AS o
) AS s
CROSS JOIN LATERAL generate_series(1, s.n) AS item;

VACUUM (ANALYZE);
