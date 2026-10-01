# Restore drill — протокол

Доказ, що бекап курсової БД **реально відновлюється** (не «є файл», а «дані повертаються»).
Прогнано скриптом [`scripts/restore-drill.sh`](scripts/restore-drill.sh): останній дамп →
чистий ефемерний `postgres:16` контейнер (порожній volume, окремий порт) →
`pg_restore --no-owner` → порівняння контрольної суми по **всіх доменних таблицях** до/після.

Контрольна сума — count по **всіх доменних таблицях** + агрегат по `orders`
(формат `users|products|orders|order_items|tasks|sum`), тож втрата рядків будь-де дає
MISMATCH, а не хибний MATCH лише за `orders`.

## Результат прогону

| Параметр | Значення |
|---|---|
| Дата drill-у | **2026-10-01** |
| Дамп | `backups/marketplace-2026-10-01_121608.dump` |
| Розмір дампу | **16 604 байт** (~20 KB) |
| Контрольна сума ДЖЕРЕЛА | `6\|8\|12\|24\|0\|451740` (users\|products\|orders\|order_items\|tasks\|sum) |
| Контрольна сума ВІДНОВЛЕНОГО | `6\|8\|12\|24\|0\|451740` — збігається |
| Вердикт | **MATCH** (exit 0), повторний запуск — теж MATCH |

## RTO / RPO

- **RTO (Recovery Time Objective) ≈ 2.4 секунди** (2400 мс). Виміряно як **повний цикл
  відновлення**: підняти чистий `postgres:16` контейнер + `createdb` + `pg_restore`. З них
  сам `pg_restore` — **~0.1 секунди** (100 мс); решта ~2.3 с — старт свіжого Postgres.
  На цьому seed-обсязі число мале; на проді RTO росте з розміром дампу, але лишається
  прогнозованим (лінійно від обсягу).
- **RPO (Recovery Point Objective) = до 24 годин.** Бекап іде **щоночі**
  ([`backup.cron`](backup.cron), розклад `30 2 * * *`), тож у найгіршому випадку між останнім
  нічним дампом і збоєм втрачається **до 24 год** змін. Зменшити RPO — частіший розклад
  (напр. щогодини → RPO ≤ 1 год) або WAL-архівація/PITR (RPO → секунди).

## Як відтворити

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://marketplace:marketplace_dev_pw@127.0.0.1:6432/marketplace
export SKIP_VAULT=1
bash scripts/with-secrets.sh dev bash scripts/backup.sh         # створює датований дамп
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh  # → друкує MATCH, exit 0
```
