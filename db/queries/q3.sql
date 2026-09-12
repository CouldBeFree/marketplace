SELECT id, buyer_id, total, created_at
FROM orders
WHERE lower(shipping_name) = lower('Customer 4242');
