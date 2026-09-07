# Оптимізація запитів — EXPLAIN до / після

Головна таблиця — `orders` (100 000 рядків). Числа зняті на моїй машині
(`EXPLAIN (ANALYZE, BUFFERS)`); значення `random()` у seed щоразу інші, тож
важливий порядок величини, а не конкретні мілісекунди.

Порядок відтворення: `schema.sql` → `seed.sql` → EXPLAIN «до» → `indexes.sql`
→ `ANALYZE` → EXPLAIN «після».

| Запит | До | Після | Прискорення | Індекс |
|---|---|---|---|---|
| q1 | 4.10 мс | 0.11 мс | ~36× | `orders_buyer_created_idx` (composite) |
| q2 | 5.35 мс | 0.25 мс | ~22× | `orders_pending_created_idx` (**partial**) |
| q3 | 15.76 мс | 0.15 мс | ~108× | `orders_shipping_name_lower_idx` (**expression**) |

---

## q1 — замовлення покупця за період (`buyer_id = ? AND created_at >= ?`)

### До

```
                                                QUERY PLAN
----------------------------------------------------------------------------------------------------------
 Sort  (cost=3031.06..3031.07 rows=5 width=39) (actual time=4.076..4.076 rows=5 loops=1)
   Sort Key: created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=1034
   ->  Seq Scan on orders  (cost=0.00..3031.00 rows=5 width=39) (actual time=0.309..4.062 rows=5 loops=1)
         Filter: ((buyer_id = 4242) AND (created_at >= (now() - '90 days'::interval)))
         Rows Removed by Filter: 99995
         Buffers: shared hit=1031
 Planning:
   Buffers: shared hit=100
 Planning Time: 0.221 ms
 Execution Time: 4.097 ms
```

### Після

```
                                                              QUERY PLAN
---------------------------------------------------------------------------------------------------------------------------------------
 Sort  (cost=23.59..23.60 rows=5 width=39) (actual time=0.085..0.085 rows=5 loops=1)
   Sort Key: created_at DESC
   Sort Method: quicksort  Memory: 25kB
   Buffers: shared hit=11 read=3
   ->  Bitmap Heap Scan on orders  (cost=4.47..23.53 rows=5 width=39) (actual time=0.039..0.062 rows=5 loops=1)
         Recheck Cond: ((buyer_id = 4242) AND (created_at >= (now() - '90 days'::interval)))
         Heap Blocks: exact=5
         Buffers: shared hit=8 read=3
         ->  Bitmap Index Scan on orders_buyer_created_idx  (cost=0.00..4.47 rows=5 width=0) (actual time=0.029..0.029 rows=5 loops=1)
               Index Cond: ((buyer_id = 4242) AND (created_at >= (now() - '90 days'::interval)))
               Buffers: shared hit=3 read=3
 Planning:
   Buffers: shared hit=167 read=3
 Planning Time: 0.331 ms
 Execution Time: 0.113 ms
```

**Що змінилось:** `Seq Scan`, який читав усі 100 000 рядків і відкидав 99 995
фільтром, зник — composite-індекс `(buyer_id, created_at)` через `Bitmap Index Scan`
одразу веде до ~5 потрібних рядків, і buffers впали з 1034 до 14.

---

## q2 — черга замовлень у статусі `pending` (рідкісний статус, адмінка)

### До

```
                                                      QUERY PLAN
----------------------------------------------------------------------------------------------------------------------
 Limit  (cost=2517.29..2517.41 rows=50 width=30) (actual time=5.323..5.327 rows=50 loops=1)
   Buffers: shared hit=1034
   ->  Sort  (cost=2517.29..2535.07 rows=7113 width=30) (actual time=5.322..5.324 rows=50 loops=1)
         Sort Key: created_at
         Sort Method: top-N heapsort  Memory: 31kB
         Buffers: shared hit=1034
         ->  Seq Scan on orders  (cost=0.00..2281.00 rows=7113 width=30) (actual time=0.009..4.808 rows=7023 loops=1)
               Filter: (status = 'pending'::text)
               Rows Removed by Filter: 92977
               Buffers: shared hit=1031
 Planning:
   Buffers: shared hit=92
 Planning Time: 0.228 ms
 Execution Time: 5.351 ms
```

### Після

```
                                                                   QUERY PLAN
-------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.28..31.32 rows=50 width=30) (actual time=0.032..0.219 rows=50 loops=1)
   Buffers: shared hit=50 read=2
   ->  Index Scan using orders_pending_created_idx on orders  (cost=0.28..4316.56 rows=6953 width=30) (actual time=0.031..0.216 rows=50 loops=1)
         Buffers: shared hit=50 read=2
 Planning:
   Buffers: shared hit=149
 Planning Time: 0.355 ms
 Execution Time: 0.247 ms
```

**Що змінилось:** зникли одразу два вузли — `Seq Scan` і `Sort`: partial-індекс
`(created_at) WHERE status = 'pending'` містить лише pending-рядки й уже впорядкований
за `created_at`, тож `Index Scan` під `LIMIT 50` читає рівно 50 рядків без сортування,
а buffers впали з 1034 до 52.

---

## q3 — пошук за іменем отримувача без урахування регістру (`lower(shipping_name) = ?`)

### До

```
                                               QUERY PLAN
--------------------------------------------------------------------------------------------------------
 Seq Scan on orders  (cost=0.00..2531.00 rows=500 width=30) (actual time=1.298..15.738 rows=19 loops=1)
   Filter: (lower(shipping_name) = 'customer 4242'::text)
   Rows Removed by Filter: 99981
   Buffers: shared hit=1031
 Planning:
   Buffers: shared hit=69
 Planning Time: 0.197 ms
 Execution Time: 15.757 ms
```

### Після

```
                                                               QUERY PLAN
-----------------------------------------------------------------------------------------------------------------------------------------
 Bitmap Heap Scan on orders  (cost=4.45..76.39 rows=20 width=30) (actual time=0.041..0.107 rows=19 loops=1)
   Recheck Cond: (lower(shipping_name) = 'customer 4242'::text)
   Heap Blocks: exact=19
   Buffers: shared hit=19 read=2
   ->  Bitmap Index Scan on orders_shipping_name_lower_idx  (cost=0.00..4.44 rows=20 width=0) (actual time=0.031..0.031 rows=19 loops=1)
         Index Cond: (lower(shipping_name) = 'customer 4242'::text)
         Buffers: shared read=2
 Planning:
   Buffers: shared hit=127
 Planning Time: 0.318 ms
 Execution Time: 0.146 ms
```

**Що змінилось:** `Seq Scan` (звичайний індекс по колонці тут марний — у `WHERE`
стоїть функція `lower()`) поступився `Bitmap Index Scan` по expression-індексу
`(lower(shipping_name))`; сканування впало з 100 000 рядків до 19, buffers — з 1031 до 21.
