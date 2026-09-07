SELECT id, buyer_id, total, created_at
FROM orders
WHERE status = 'pending'
ORDER BY created_at
LIMIT 50;
