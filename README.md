# Marketplace API — Nest-версія (гілка `nestjs`)

Порт застосунку **Marketplace API** з мінімального Express на **NestJS**, зі збереженням
початкової філософії ДЗ: **contract-first**. `openapi/openapi.yaml` лишається **джерелом
правди**, а Nest працює поверх Express, у який глобальним middleware вбудовано
[`express-openapi-validator`](https://www.npmjs.com/package/express-openapi-validator).

> Це відгалуження від гілки з ДЗ №1. Оригінальна Express-версія (`app.js`) — на `main`.

## Підхід: contract-first (не code-first)

Валідація запитів **і відповідей** — на валідаторі проти спеки, а не на DTO + `class-validator`.
Тобто `@nestjs/swagger` спеку **не генерує**; навпаки — спека диктує контракт, а контролери
лишаються тонкими. Це зберігає «Варіант Б» з ДЗ: `validateResponses: true` ловить **DRIFT**
між тим, що віддає хендлер, і схемою відповіді (розбіжність імен полів → 500, а не тихо
зіпсована відповідь).

### Як валідатор інтегровано в Nest (три ключові деталі)

Nest ховає Express-інстанс усередині, тож порядок middleware треба вибудувати вручну
(`src/main.ts`):

1. **`bodyParser: false` + власний `express.json()` ПЕРЕД валідатором.** Інакше валідатор
   спрацює раніше за парсинг тіла й побачить `req.body === undefined`.
2. **Валідатор чіпляємо на express-інстанс ДО `app.init()`** — щоб він стояв раніше за роутер
   Nest і встиг перевірити запит.
3. **Express-error-handler додаємо ПІСЛЯ `app.init()`** — щоб він був останнім (arity-4) і
   ловив `next(err)` від валідатора запитів. Помилки, кинуті вже _всередині_ Nest
   (404/422, drift відповіді), ловить глобальний `ProblemJsonFilter`. Обидва шляхи віддають
   однаковий `application/problem+json`.

## Стек і версії

| Пакет | Версія | Навіщо |
|---|---|---|
| Node | v24.13.1 | стенд |
| NestJS (`@nestjs/*`) | ^10.4 | фреймворк; platform-express тримає **Express 4** під капотом |
| express | 4.22.2 | з express@4 валідатор працює без сюрпризів (express@5 — ні) |
| express-openapi-validator | 5.6.2 | runtime-валідація запитів і відповідей проти спеки |
| TypeScript | ^5.6 | Nest — на TS (декоратори + `emitDecoratorMetadata`) |
| @redocly/cli | 2.46.0 (dev) | lint + bundle спеки |

> **Чому Nest 10, а не 11:** Nest 11 за замовчуванням тягне Express 5, з яким
> `express-openapi-validator` не дружить. Nest 10 = Express 4 — тому інтеграція стабільна.

> **Чому не `node --experimental-strip-types`:** Nest покладається на метадані декораторів
> (`reflect-metadata` + `emitDecoratorMetadata`), а type-stripping їх не емітить. Тому потрібен
> справжній компіляційний крок (`tsc`).

## Структура

```
marketplace/
├── openapi/
│   └── openapi.yaml          # джерело правди (не змінювалось при порті)
├── src/
│   ├── main.ts               # bootstrap: json → валідатор → Nest → error-handler
│   ├── app.module.ts
│   ├── common/
│   │   ├── models.ts         # інтерфейси Product / OrderItem / Order
│   │   ├── pagination.ts     # helper cursor-пагінації (непрозорий base64url(id))
│   │   └── problem-json.filter.ts   # ExceptionFilter → problem+json
│   ├── products/             # controller + service + module
│   └── orders/               # controller + service + module (idempotency тут)
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore                # node_modules/, dist/, spec.json, ...
```

## Установка

```bash
npm install
```

## Запуск

```bash
npm start          # prestart зіб'є tsc → node dist/main.js  -> http://localhost:3000
npm run build      # лише компіляція у dist/
npm run start:dev  # node --watch dist/main.js (перезапуск на зміну зібраного коду)
```

Ендпойнти (in-memory дані): `GET /products`, `GET /products/{id}`,
`GET /orders`, `POST /orders`, `GET /orders/{id}`.

## Перевірки (acceptance criteria)

Спекові перевірки (1–5) — незмінні, бо `openapi.yaml` той самий.

### 1. Спека валідна

```bash
npm run lint:spec        # npx @redocly/cli lint openapi/openapi.yaml  -> exit 0
```

### 2. Обсяг спеки (≥2 ресурси, ≥5 операцій, Idempotency-Key required, опис ≥40)

```bash
npm run bundle:spec
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```

### 3–5. Idempotency-Key / cursor-пагінація / problem+json у контракті

```bash
grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

### 6. Застосунок працює наживо

Спочатку в одному терміналі:

```bash
npm start
```

Потім в іншому:

```bash
# 6a. POST /orders БЕЗ Idempotency-Key -> 400 + application/problem+json
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"product_id":"prod_1","quantity":2}]}'
# detail: request/headers must have required property 'idempotency-key'

# 6b. POST /orders з ПОРОЖНІМ items -> 400
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: key-123' \
  -d '{"items":[]}'
# detail: request/body/items must NOT have fewer than 1 items

# 6c. Валідний запит -> 201 + Order (total_cents: 5500)
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: key-123' \
  -d '{"items":[{"product_id":"prod_1","quantity":2},{"product_id":"prod_3","quantity":1}]}'
```

### Додатково — повна семантика Idempotency-Key

```bash
# повтор того самого ключа + тіла -> 201 + заголовок Idempotency-Replay: true
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: key-123' \
  -d '{"items":[{"product_id":"prod_1","quantity":2},{"product_id":"prod_3","quantity":1}]}' \
  | grep -i idempotency-replay

# той самий ключ з ІНШИМ тілом -> 422 problem+json
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: key-123' \
  -d '{"items":[{"product_id":"prod_2","quantity":1}]}'
```

## Що лишилось незмінним із контракту

- **2 ресурси / 5 операцій**, cursor-пагінація (`limit`/`cursor`, `next_cursor` nullable),
  `Idempotency-Key` (header, required), `problem+json` на кожній 4xx, гроші — `*_cents: integer`.
- Уся ця частина живе у `openapi/openapi.yaml` — при порті на Nest спека не змінювалась.

---

# Configuration (ДЗ №2 — конфіг і секрети)

Ланцюжок конфігурації:

```
process.env → zod-схема (fail-fast) → ConfigService<Env, true> → код
secrets/db_password → password: () => readFile() → pg.Pool → БД
```

Зіпсована змінна **вбиває процес на старті** зі зрозумілою помилкою, а не на першому
запиті в проді. Жоден секрет не живе ані в git, ані в шарах docker-образу. Пароль БД
можна **ротувати без рестарту** сервісу.

## Змінні середовища

Єдине джерело правди — zod-схема `src/config/env.schema.ts`. Контракт для людей —
`.env.example` (у git; синхронність зі схемою стежить `npm run check:env`).

| Змінна | Обовʼязкова | Дефолт | Джерело | Призначення |
|---|---|---|---|---|
| `NODE_ENV` | ні | `development` | `.env` | `development` \| `test` \| `production` |
| `PORT` | ні | `3000` | `.env` | порт HTTP-сервера (`z.coerce.number`) |
| `DB_URL` | **так** | — | **сховище** (`.env` / secret-файл, поза git) | `postgres://user@host:port/db` **без пароля** |
| `DB_PASSWORD_FILE` | ні | `secrets/db_password` | `.env` | шлях до файла-секрета з паролем БД |

> **Рядок підключення (`DB_URL`) живе у сховищі з ДЗ №11, а не в новому env-файлі.**
> У git трекається лише `.env.example` (фейкові значення); реальний `DB_URL` — у `.env`,
> який у `.gitignore`. Дев-креденшели самого контейнера Postgres (`postgres`/`postgres`)
> — у `docker-compose.yml`: це окремий шлях для грейдера, не секрет застосунку.

> Пароля БД у env **немає навмисно** — він у файлі-секреті, який `pg.Pool` перечитує
> на кожне нове зʼєднання. Це й уможливлює ротацію без рестарту.

## Локальний запуск

```bash
# 1) Postgres у docker (роль marketplace + БД marketplace створює init.sql)
docker compose up -d db

# 2) файл-секрет (пароль має збігатися з init.sql)
mkdir -p secrets && printf '%s' 'marketplace_dev_pw' > secrets/db_password

# 3) конфіг зі зразка
cp .env.example .env

# 4) запуск (build + node dist/main.js; НЕ watch — щоб був чесний exit code)
npm start
```

Перевірка живучості:

```bash
curl -s localhost:3000/health   # {"status":"ok","db":"up","uptime_seconds":...}
```

`npm run start:dev` — те саме, але з `node --watch` (для розробки, окремо від `start`).

## Ротація пароля БД без рестарту

```bash
curl -s localhost:3000/health          # запамʼятай uptime_seconds
bash rotate.sh                         # ALTER ROLE → оновити файл → terminate
curl -s localhost:3000/health          # знову 200, uptime_seconds БІЛЬШИЙ
```

Що робить `rotate.sh` (порядок критичний):

1. `ALTER ROLE marketplace WITH PASSWORD '<новий>'` — міняє пароль на сервері;
2. **одразу** пише новий пароль у `secrets/db_password` — щоб нові зʼєднання брали його;
3. `pg_terminate_backend(...)` — рве старі зʼєднання, і пул перепідключається вже з новим
   секретом (`pool.on('error')` ловить розрив — процес **не падає**).

`uptime` у `/health` після ротації більший — доказ, що процес не рестартував.

> Після `docker compose down -v` том зникає, `init.sql` виконується знову і пароль ролі
> повертається до `marketplace_dev_pw` — **поверни й файл-секрет** до цього значення,
> інакше `password authentication failed`.

## Секрети поза git і поза образом

- `.env` і `secrets/` — у `.gitignore` (у git лежить лише `.env.example`).
- `.dockerignore` не пускає `.env` та `secrets/` у контекст збірки; `Dockerfile`
  не оголошує жодного `ENV` з паролем. Перевірка:

```bash
docker build -t myapp .
docker run --rm myapp ls -a /app                 # є .env.example, немає .env і secrets/
docker run --rm myapp sh -c 'cat /app/.env' 2>&1 # No such file or directory
docker inspect --format '{{.Config.Env}}' myapp  # лише PATH/NODE_VERSION/YARN_VERSION
docker history --no-trunc myapp | grep -i password  # порожньо
```

## Перевірка контракту .env.example

```bash
npm run check:env    # exit 0, якщо .env.example збігається зі схемою; exit 1, якщо відстав
```

---

# Data layer (ДЗ №12 — схема, seed, індекси)

Дата-шар домену Marketplace: 4 таблиці, реалістичний обсяг через `generate_series`,
три повільні запити API та мінімальний набір індексів, що їх лікує. Докази —
плани `EXPLAIN (ANALYZE, BUFFERS)` до/після в [`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

**Головна таблиця — `orders`** (100 000 рядків у seed).

Файли:

| Файл | Призначення |
|---|---|
| `db/schema.sql` | 4 таблиці (`users`, `products`, `orders`, `order_items`) + 4 FOREIGN KEY + CHECK/NOT NULL |
| `db/seed.sql` | генерація даних (перекошені розподіли) + `VACUUM (ANALYZE)` |
| `db/queries/q1..q3.sql` | по одному запиту на файл (owner+період, рідкісний статус, `lower()`-пошук) |
| `db/indexes.sql` | 3 індекси: composite, **partial**, **expression** |
| `db/OPTIMIZATIONS.md` | 3 пари `EXPLAIN` до/після + пояснення |

## Підняти Postgres (один рядок)

```bash
docker compose up -d --wait
```

> Створює БД `marketplace` через `init.sql`. Дев-креденшели — у `docker-compose.yml`
> (`postgres`/`postgres`), тож на свіжому клоні пароль вгадувати не треба.
> Порт хоста — `${DB_PORT:-5432}`; усі команди нижче йдуть через `docker compose exec`,
> тож від порту не залежать.

## Підключитись (один рядок)

```bash
docker compose exec -T db psql -U postgres -d marketplace -Atc "SELECT 1"   # -> 1
```

## Прогнати всі кроки

Порядок критичний: `schema` → `seed` → EXPLAIN «до» (Seq Scan) → `indexes` →
`ANALYZE` → EXPLAIN «після» (Index Scan).

```bash
# 1) схема (на чисту базу, без помилок)
docker compose exec -T db psql -U postgres -d marketplace -v ON_ERROR_STOP=1 -f - < db/schema.sql

# 2) дані: 100k+ рядків у orders + VACUUM (ANALYZE)
docker compose exec -T db psql -U postgres -d marketplace -v ON_ERROR_STOP=1 -f - < db/seed.sql

# 3) EXPLAIN «до» — кожен запит дає Seq Scan
for q in db/queries/q1.sql db/queries/q2.sql db/queries/q3.sql; do
  docker compose exec -T db psql -U postgres -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat $q)"
done

# 4) індекси + оновлення статистики
docker compose exec -T db psql -U postgres -d marketplace -v ON_ERROR_STOP=1 -f - < db/indexes.sql
docker compose exec -T db psql -U postgres -d marketplace -c "ANALYZE;"

# 5) EXPLAIN «після» — Index/Bitmap Scan, Seq Scan зник
for q in db/queries/q1.sql db/queries/q2.sql db/queries/q3.sql; do
  docker compose exec -T db psql -U postgres -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat $q)"
done
```

Скинути все начисто (новий том):

```bash
docker compose down -v && docker compose up -d --wait
```
