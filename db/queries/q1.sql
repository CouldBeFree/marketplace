SELECT id, buyer_id, status, total, created_at
FROM orders
WHERE buyer_id = 4242
  AND created_at >= now() - interval '90 days'
ORDER BY created_at DESC;
