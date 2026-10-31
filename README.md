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

---

# ORM layer (ДЗ №13 — TypeORM, міграції, N+1)

Схема з ДЗ №12 переїжджає в код на **TypeORM** по-продовому: entities + relations +
**міграції без `synchronize`**. Плюс доводимо ціну ORM: знаходимо в домені **N+1**,
показуємо його в лозі SQL і лікуємо; один агрегатний звіт — через **QueryBuilder**.

| Файл | Призначення |
|---|---|
| `src/entities/*.entity.ts` | `User`, `Product`, `Order`, `OrderItem` — дзеркало схеми ДЗ №12 (гроші — integer-копійки) |
| `src/data-source.ts` | `DataSource` із `synchronize: false`, підключення суто з `process.env.DB_URL` |
| `src/migrations/*-Init.ts` | згенерована й дороблена руками початкова міграція |
| `src/seed.ts` | детермінований **ідемпотентний** seed |
| `src/demo-nplus1.ts` | N+1 «до/після» з лічильником запитів |
| `src/report.ts` | звіт «виторг по продавцях» через `createQueryBuilder().getRawMany()` |
| `scripts/with-secrets.sh` | обгортка «команда зі сховища» (наш аналог `infisical run`) |

> **Гроші — `integer` у мінорних одиницях (копійки):** колонки `price_cents` / `total_cents` /
> `unit_price_cents` — не float і не рядок-decimal (правило з ДЗ №1). Тому в `seed` `total`
> рахується **цілим** додаванням, а агрегат `SUM(…_cents)` у `report` приходить рядком (bigint)
> і друкується як є.

> **Індекси на FK `order_items`** (`order_items_order_id_idx`, `order_items_product_id_idx`) —
> Postgres не індексує FK-колонки автоматично; без них і наївний N+1-цикл, і join у `report`
> ішли б `Seq Scan` по `order_items`.

> **Збірка — `tsc`** (не esbuild): entities покладаються на метадані декораторів
> (`emitDecoratorMetadata`), яких type-stripping/esbuild не емітять. CLI міграцій працює
> зі **скомпільованим** DataSource (`dist/data-source.js`), тож після правок — `npm run build`.

## Підключення — зі сховища (п.7), з аварійним входом для грейдера (п.8)

Усі команди, що ходять у БД (`migrate*`, `seed`, `demo:nplus1`, `report`), загорнуті в
`scripts/with-secrets.sh dev …`. Обгортка наповнює `DB_URL` зі сховища ДЗ №11
(gitignored `.env` + `secrets/db_password`) — це основний, «прод-шейпнутий» шлях.

Грейдер сховища не має, тож ходить аварійним входом: `SKIP_VAULT=1` змушує обгортку
взяти `DB_URL` уже з оточення (як CI-runner підкладає секрети замість CLI сховища).
У `src/data-source.ts` немає жодного зашитого хоста/пароля.

## Auth

ДЗ #24 закриває API: `POST /orders` більше не зробить будь-хто від чийого завгодно імені.
Дві різні задачі, які не можна плутати: **автентифікація** («хто це?», перевіряється
криптографією — підпис JWT) і **авторизація** («чи можна йому це?», криптографією НЕ
перевіряється, бо залежить від даних, яких у токені немає — ролі в БД та власності ресурсу).

**Змінні (джерело — колонка, яку читає критерій 3):**

| Змінна | Джерело | Навіщо |
|---|---|---|
| `JWT_PRIVATE_KEY` | сховище (#11) | підпис access-токенів (ES256, base64 від PKCS8 PEM) |
| `JWT_PUBLIC_KEY` | сховище (#11) | верифікація підпису access-токенів (base64 від SPKI PEM) |
| `JWT_KID` | сховище (#11) | який ключ перевіряти — `kid` у заголовку JWT (overlap-ротація) |
| `REFRESH_TOKEN_PEPPER` | сховище (#11) | HMAC-«перець» для `token_hash` refresh-токена (≥16 символів) |
| `REDIS_QUEUE_URL` | compose / оточення | денилист `jti` відкликаних access (noeviction-інстанс #23) |
| `DB_URL` / `DATABASE_URL` | compose / оточення | дев-креденшели БД, секретом не є |

Ключі БЕЗ дефолтів у схемі (`src/config/env.schema.ts`): дефолт тут = зашитий у код ключ,
тобто можливість підписати токен будь-кого. Без ключа голий `npm run start` падає на валідації
**до** підключення до БД і називає змінну, якої бракує. Ціна витоку різна: витік `DB_URL` — це
доступ до бази з мережі; витік ключа підпису — можливість виписати собі токен будь-кого без
жодного доступу. Тому ключ живе лише у сховищі, а в `## Grading` грейдер генерує одноразову пару.

**Алгоритм — ES256 (асиметричний).** OWASP радить ES256/PS256/EdDSA й позначає RS256 як «Not
recommended»; ES256 обрано свідомо. Головне — верифікатор має лише **публічний** ключ і фізично
не може виписати валідний токен (на відміну від HS256, де верифікатор = підписувач, і треба
окремо доводити, чому він не випише собі `role: admin`). У верифікації стоїть **явний**
`algorithms: ['ES256']` (`src/auth/token.service.ts` і модуль) — єдиний надійний запобіжник від
algorithm-confusion (RFC 8725 §3.1): без нього атака підміняє `alg` на `none`/`HS256`.

**`kid` і overlap-ротація ключа.** Кожен access несе `kid` у заголовку → яким ключем його
перевіряти. Ротація ключа підпису — з **перекриттям**: певний час приймаємо і старий, і новий
`kid` (старі видані токени ще валідні до свого `exp`), і лише коли старих не лишилось — прибираємо
старий ключ. `kid` і є те, що дає робити це без «розлогінення всіх».

**Логаут — це ДВІ дії** (і вони в різних сховищах — свідомий dual-write, не вдаваний atomic, урок
#22): (1) у Postgres відкликаємо всю **сімʼю** refresh-токенів (`revoked_at` на `family_id`) —
джерело правди, комітиться першим; (2) у Redis кладемо `jti` access-токена в **денилист** із
`TTL = залишок exp`. Чому обидві: refresh — рядок у БД, його досить позначити; а access
**self-contained** і живе до `exp` незалежно від БД — без денилиста вкрадений access працював би
до кінця свого життя. `exp` перевіряє бібліотека, `revoked` — ми; тому денилист має зникати сам
(TTL = залишок життя токена, ні секундою більше), інакше сховище росте без межі.

**Ротація refresh із детекцією повтору** (`demo:reuse`, ⭐). Кожен успішний `refresh` видає нову
пару й вбиває стару; усі токени одного логіна — в одній `family_id`. Прийшов токен, який **уже
використано** (`used_at` не порожній) — це сигнал компрометації: відкликаємо **всю сімʼю** й
пишемо в лог. Ротація БЕЗ детекції нічого не дає: злодій рефрешиться першим, чесний клієнт
отримує 401 і мовчки перелогінюється, а сесія злодія живе далі. RFC 9700 §4.14.2 вимагає або
sender-constrained токен, або ротацію з детекцією — і звʼязок через `family_id` і є те, чим
відкликати виявлений повтор. Усе це — в **одній транзакції** з `SELECT … FOR UPDATE` (atomic, як
відкликання+видача в #14): паралельні рефреші одного токена серіалізуються, а не читають
`used_at IS NULL` двічі.

**Гонка рефрешу на клієнті — серіалізація на клієнті.** Два паралельні запити фронта могли б
обидва піти рефрешити один токен і виглядати як компрометація. Обрано: клієнт серіалізує рефреш
(один проміс на всіх вкладок). Сервер лишається **строгим** — будь-який повтор валить сімʼю; це
тримає `demo:reuse` чесним і не вводить «вікна благодаті», у яке міг би проскочити злодій.

**401 проти 403 — розділені жорстко.** Нема/протух/зіпсований/підмінений/денилистнутий токен →
**401** (автентифікація, `JwtAuthGuard`). Токен валідний, але прав немає → **403** (авторизація:
`RolesGuard` для ролі або перевірка власності). Це не стиль: SDK на 401 іде рефрешити токен, на
403 показує помилку. `anon=401` + `foreign=403` у `demo:rbac` — і є це розділення.

**RBAC — два рівні.** *Рівень ролі:* запис у `products` (`POST /products`) — лише `seller`/`admin`
(`@Roles` + `RolesGuard`); покупець → 403. *Рівень власності:* `GET /orders/{id}` — власник → 200,
чуже → 403. **Межа власності НЕ в гарді:** гард стоїть до завантаження ресурсу й даних про
власника не має (інакше ходив би в базу двічі). Власність перевіряється у `OrdersController.get`
**після** `orders.get(id)` (який дає 404 для неіснуючого навіть власнику), звіркою `ownerOf(id)`
з `sub` токена; в реальному БД-ресурсі це був би `WHERE owner_id = $user` прямо в запиті.

**`role` у токені — КЕШ, не джерело правди.** Джерело правди — колонка `users.role`. Наслідок:
свіжо-розжалуваний адмін **лишається адміном до `exp` свого access-токена** (≤10 хв). Це свідомий
компроміс (ціна stateless-токена), а не баг: короткий TTL тримає вікно малим, а критичні дії
завжди можна додатково звіряти з БД.

**Відбитки ключів (доказ, що оточення різні).** У лог/README іде відбиток (SHA-256 від SPKI-DER,
перші 16 hex), не сам ключ (прийом #11). Dev: `a5820614a0fd87fb` (kid `dev-a5820614a0fd87fb`).
Prod: `15615708e74d0ef4`. Різні відбитки = різні ключі в різних оточеннях: токен, підписаний
dev-ключем, у проді не пройде верифікацію.

## Grading

Свіжий клон, чиста БД, без доступу до сховища. Виконати в корені репо:

```bash
docker compose up -d --wait
export SKIP_VAULT=1                 # у грейдера немає доступу до сховища
# застосунок ходить ЧЕРЕЗ PgBouncer (порт 6432), а не напряму в Postgres
export DB_URL=postgres://marketplace:marketplace_dev_pw@127.0.0.1:6432/marketplace
export DATABASE_URL="$DB_URL"       # ops-скрипти (backup/restore-drill) читають DATABASE_URL
# ДЗ #19 — адреса брокера подій (дев-креди локального RabbitMQ з docker-compose, не секрет)
export BROKER_URL=amqp://app:app@127.0.0.1:5672
# ДЗ #23 — два інстанси Redis: кеш (allkeys-lru) і черга+сесії+ліміт (noeviction)
export REDIS_URL=redis://127.0.0.1:6391
export REDIS_QUEUE_URL=redis://127.0.0.1:6392

# ДЗ #24 — одноразова пара ES256 для прогону (PEM → base64, щоб багаторядковість не поїхала в
# export; грейдер копіює цей блок дослівно — справжній ключ лишається у сховищі й не потрібен).
node -e 'const {generateKeyPairSync}=require("node:crypto");
const k=generateKeyPairSync("ec",{namedCurve:"P-256",
  privateKeyEncoding:{type:"pkcs8",format:"pem"},
  publicKeyEncoding:{type:"spki",format:"pem"}});
const fs=require("node:fs");
fs.writeFileSync("/tmp/priv.b64",Buffer.from(k.privateKey).toString("base64"));
fs.writeFileSync("/tmp/pub.b64",Buffer.from(k.publicKey).toString("base64"));'
export JWT_KID=grader
export JWT_PRIVATE_KEY="$(cat /tmp/priv.b64)"
export JWT_PUBLIC_KEY="$(cat /tmp/pub.b64)"
export REFRESH_TOKEN_PEPPER=grader-pepper-at-least-16-bytes

npm ci
npm run build
npm run migrate            # створює схему з нуля (через PgBouncer)
npm run migrate:show       # усі міграції як [X]
npm run seed               # і ще раз — кількість рядків не зміниться
npm run demo:nplus1        # друкує к-сть запитів «до» і «після»
npm run report             # агрегований виторг по продавцях

# ДЗ #14 — конкурентність (ходять у ту саму БД через обгортку)
npm run demo:race          # 50 паралельних checkout: успішних рівно 10, без oversell
npm run demo:workers       # пул воркерів через SKIP LOCKED: кожна задача рівно раз
npm run demo:retry         # serialization failure + retry: фінал арифметично коректний

# ДЗ #15 — бекап і restore-drill (беруть DATABASE_URL; pg_dump іде крізь PgBouncer)
bash scripts/with-secrets.sh dev bash scripts/backup.sh         # датований -Fc дамп у backups/
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh  # відновлює у чистий контейнер → MATCH

# ДЗ #19 — асинхронні події через RabbitMQ (беруть BROKER_URL; ефект — у ту саму БД)
npm run demo:publish       # published=5 effect=5 dlq=0 prefetch=N (happy path + prefetch)
npm run demo:dlq           # work=0 dlq=1 dlq-reason=rejected (отруєне → DLQ, причина прочитана)
npm run demo:duplicate     # deliveries=2 effect=1 (дубль доставлено, ефект застосовано раз)

# ДЗ #22 — transactional outbox + ідемпотентність (ходять у ту саму БД через обгортку)
npm run demo:outbox        # requests=2 orders=1 outbox=1 published=1 effect=1 processed=1
npm run demo:crash-write   # write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0
npm run demo:crash-relay   # deliveries>=2 applied=1 effect=1 processed=1 (дубль, ефект один)

# ДЗ #23 — Redis: кеш, сесії, ліміт, черга (ходять у Redis через обгортку)
npm run demo:cache      # db-calls=1 db-calls-warm=0 cache-lru=1 cache-maxmemory=1 (лавина → 1 похід)
npm run demo:session    # sessions=1 in-redis=1 ttl-renewed=1 (сесія в Redis + rolling TTL)
npm run demo:ratelimit  # status=429 retry-after=1 allowed==limit (ліміт спільний на 2 поди)
npm run demo:queue      # completed=1 added=2 queued=1 queue-noeviction=1 (ретрай + дедуп + планувальник)

# ДЗ #24 — auth: JWT + ротація з детекцією повтору + RBAC + денилист (демо самоочисні,
#          самі піднімають застосунок на своєму порту; числа — HTTP-статуси, детерміновані)
npm run demo:auth    # login=200 no-token=401 with-token=200 refresh=200 logout=200 after-logout=401 refresh-after-logout=401
npm run demo:reuse   # login=200 r1-refresh=200 r1-reuse=401 r2-after-reuse=401  (⭐ повтор валить усю сімʼю)
npm run demo:rbac    # anon=401 own=200 foreign=403 role-denied=403 role-allowed=201 tampered=401
```

> Дев-креденшели ролі `marketplace`/`marketplace_dev_pw` (їх створює `init.sql`) —
> **не секрет**, як домовлено на ДЗ №11; тому їх можна тримати прямо тут.
> Порти: PgBouncer — `${PGBOUNCER_PORT:-6432}`, Postgres — `${DB_PORT:-5432}`. Якщо
> котрийсь зайнятий, підніми на інших (`DB_PORT=5441 PGBOUNCER_PORT=6432 docker compose
> up -d --wait`) і встав порт PgBouncer у `DB_URL`/`DATABASE_URL`.

## Міграції (без `synchronize`)

`synchronize: false` — схему створює **лише** міграція. Початкову згенеровано
`migration:generate` проти порожньої БД, потім дороблено руками два індекси, яких
декоратор не виражає: **`DESC`** у composite `orders_buyer_created_idx (buyer_id,
created_at DESC)` та **expression** `orders_shipping_name_lower_idx (lower(shipping_name))`.
`down()` реально відкочує (дропає FK/таблиці/індекси), тож цикл оборотний:

```bash
npm run migrate           # up
npm run migrate:revert    # down — доменні таблиці зникають
npm run migrate           # up знову
```

## Relations і вибір `onDelete`

`order_items` несе дані на зв'язку M:N (кількість, ціна на момент), тому це **явна
join-entity**, а не `@ManyToMany`. Для кожного FK — свідома стратегія:

| Зв'язок | `onDelete` | Чому |
|---|---|---|
| `order_items.order_id → orders` | **CASCADE** | позиція не існує без замовлення — гине разом із ним |
| `order_items.product_id → products` | **RESTRICT** | не дати видалити товар, поки він у чиємусь замовленні (історія) |
| `products.seller_id → users` | **RESTRICT** | не дати видалити продавця з наявними товарами |
| `orders.buyer_id → users` | **RESTRICT** | не дати видалити покупця з наявними замовленнями |

## Seed — детермінований та ідемпотентний

Природні ключі (`email`, `seller_id+title`, `shipping_name='SEED-ORDER-N'`) → повторний
запуск нічого не дублює й не падає:

```bash
npm run seed && npm run seed
docker compose exec -T db psql -U marketplace -d marketplace -Atc \
  "SELECT 'users='||count(*) FROM users UNION ALL SELECT 'products='||count(*) FROM products \
   UNION ALL SELECT 'orders='||count(*) FROM orders UNION ALL SELECT 'order_items='||count(*) FROM order_items"
# users=6 · products=8 · orders=12 · order_items=24 — між запусками не змінюється
```

## N+1: доведено і вилікувано

`npm run demo:nplus1` міряє граф **`order → items → product`** (2 рівні зв'язків, N = 12):

| Стратегія | Запитів | Коментар |
|---|---|---|
| наївно (запит у циклі) | **37** | `= 1 + N + позиції` — росте з N |
| `relations` / `leftJoinAndSelect` (join) | **1** | константа, не залежить від N |
| `relationLoadStrategy: 'query'` | **4** | теж константа, `≤ 1 + 2×рівнів = 5` |

Незалежність від N: та сама join-стратегія на меншій вибірці (3 замовлення) — теж **1**
запит. Тобто «після» — мала константа, що не росте з розміром колекції.

## Repository vs QueryBuilder

Межа проста: **Repository** (`find`/`save`) — коли результат лягає в entity-обʼєкти:
CRUD і завантаження графа зв'язків через `relations`. **QueryBuilder + `getRawMany()`** —
коли потрібен агрегат / `GROUP BY` / обчислені колонки, яких немає в entity (виторг,
лічильники): результат не мапиться на рядок таблиці, тож `find()` тут безсилий. Саме тому
`report.ts` — на QueryBuilder, а seed і N+1-демо — на репозиторіях.

---

# Concurrency (ДЗ №14 — checkout, гонки, воркери, retry)

Транзакційний checkout і три демо конкурентності поверх схеми ДЗ #13. Нова міграція
додала `products.stock`, `users.balance_cents` і таблицю черги `tasks` (усе без `synchronize`).
Демо ходять у БД через ту саму обгортку `scripts/with-secrets.sh` (див. `## Grading`).

| Файл | Призначення |
|---|---|
| `src/checkout.ts` | транзакційний checkout: атомарний декремент stock + списання балансу + INSERT order/task |
| `src/demo-race.ts` | `npm run demo:race` — 50 паралельних checkout на товар зі stock=10 |
| `src/demo-workers.ts` | `npm run demo:workers` — пул воркерів через `FOR UPDATE SKIP LOCKED` |
| `src/demo-retry.ts` | `npm run demo:retry` — serialization failure під `REPEATABLE READ` + retry |
| `src/migrations/…-Concurrency.ts` | `stock` + `balance_cents` + таблиця `tasks` |

## Числа з моїх запусків

| Демо | Результат |
|---|---|
| `demo:race` | спроб **50**, успішних **10** (= stock), фінальний stock **0**, відʼємних рядків **0** |
| `demo:workers` | **40** задач на **3** воркери (14/13/13), оброблено двічі **0**, **242 мс** проти ~600 мс послідовно |
| `demo:retry` | **2** конкурентні інкременти, піймано **1** × `40001`, фінал **2** (без lost update) |

## Чому атомарний `UPDATE`, а не pessimistic `SELECT … FOR UPDATE`

Для захисту від oversell обрано **атомарний** `UPDATE products SET stock = stock - $n
WHERE id = $id AND stock >= $n RETURNING`. Це **один** стейтмент, який під рядковим локом
водночас перевіряє наявність і декрементує: **вікна між читанням і записом немає** взагалі,
0 рядків у відповіді = товару бракує. Pessimistic `SELECT … FOR UPDATE` теж коректний, але
це read-modify-write у два кроки (лок → рахунок у JS → окремий `UPDATE`): зайвий рейс і код,
а вигода зʼявляється лише коли перед записом треба прочитати кілька значень і ухвалити
складніше рішення. Для чистого декремента-з-перевіркою атомарний `UPDATE` — найщільніший.

## Чому retry ловить лише `40001` і `40P01`

Повторюваними є **тільки** ці два коди: `40001` (serialization_failure) і `40P01`
(deadlock_detected) — **транзієнтні**: транзакція програла гонку, і повтор із **новим
знімком** швидше за все пройде. Усі інші помилки детерміновані/бізнесові (порушення
`CHECK`/FK — клас `23xxx`, недостатньо коштів, невалідний вхід): повтор нічого не змінить —
лише зациклиться або сховає реальний баг. Тому обгортка `withRetry` пропускає рівно ці два
коди, а решту прокидає далі.

---

# Data layer ops (ДЗ №15 — PgBouncer + бекап + restore-drill)

Два прод-атрибути поверх схеми/транзакцій: **пулер з'єднань** перед Postgres і **бекап,
у відновленні якого ми впевнені** (бо прогнали restore-drill).

| Файл | Призначення |
|---|---|
| `pgbouncer/pgbouncer.ini` (+`userlist.txt`) | конфіг PgBouncer: `pool_mode=transaction`, пул, admin-консоль |
| `docker-compose.yml` → `pgbouncer` | сервіс пулера, порт `6432` опублікований на хост |
| `scripts/backup.sh` | `pg_dump -Fc` → датований файл у `backups/` |
| `backup.cron` | щонічний розклад бекапу |
| `scripts/restore-drill.sh` | відновлення останнього дампу в чистий контейнер + checksum |
| `RESTORE-DRILL.md` | протокол drill-у: дата, розмір, RTO, RPO |

## Підняти й підключитись через PgBouncer

```bash
docker compose up -d --wait
psql -h 127.0.0.1 -p 6432 -U marketplace -d marketplace -c "SELECT 1"   # → 1 (через пулер)
psql -h 127.0.0.1 -p 6432 -U marketplace -d pgbouncer -c "SHOW POOLS"   # marketplace: pool_mode=transaction
```

Застосунок (і `migrate`/`seed`/демо) ходять у базу через `DB_URL` → **PgBouncer:6432**,
не напряму в Postgres:5432.

## Бекап і відновлення

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh         # датований -Fc дамп у backups/
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh  # останній дамп → чистий контейнер → MATCH
```

`backup.cron` (`30 2 * * *`) ставить це на щоніч. Дампи — у `backups/` (поза git). Числа
останнього drill-у (розмір, RTO, RPO) — у [`RESTORE-DRILL.md`](RESTORE-DRILL.md).

> `pg_dump`/`pg_restore` ідуть логікою самого `pg_dump` (у нашому `DATABASE_URL` це PgBouncer;
> для `-Fc` single-connection дампу transaction mode не заважає). Відновлення drill-у — завжди
> в **окремий** свіжий контейнер, ніколи не в живу базу.

## Чому transaction mode і що він ламає

`pool_mode=transaction` повертає серверне з'єднання в пул **після кожної транзакції**, тож
100+ клієнтів мультиплексуються на кілька фізичних з'єднань — головний виграш пулера. Ціна —
**session-level стан не переживає межу транзакції**. Що ламається (мінімум три речі):

1. **Session-level prepared statements** — named prepared statement, підготовлений в одній
   транзакції, у наступній летить на інше серверне з'єднання й зникає. Лікуємо
   `max_prepared_statements = 200` (PgBouncer ≥1.21) — тому TypeORM/`pg` живуть через пул.
2. **Session-стан**: `SET`/session-GUC, `TEMP`-таблиці, незакриті курсори — усе, що живе в
   межах сесії, не гарантовано збережеться між транзакціями (сусідня транзакція може потрапити
   на інше з'єднання).
3. **`LISTEN`/`NOTIFY` і session-level advisory locks** — прив'язані до конкретного серверного
   з'єднання, тож у transaction mode ненадійні.

Тому адмін-операції (складні міграції розширень тощо) у проді ведуть **повз** пулер, напряму
в Postgres.

---

# Тестування (ДЗ №16 — integration + E2E + Pact + CI)

«Драбинка довіри» для домену: integration-тести проти **справжнього** Postgres у
testcontainers, E2E через supertest і контракт через **Pact** з брокером і `can-i-deploy`.

> **Де що покрито:** HTTP-застосунок Nest лишається **in-memory** (як у ДЗ #9). Справжню
> БД по-справжньому покриває **integration-suite** (репозиторії проти testcontainers-Postgres);
> E2E/Pact ганяють повний Nest із testcontainer-Postgres, під'єднаним через env.
> Збірка тестів — `ts-jest` (esbuild не емітить метадані декораторів); `maxWorkers: 1`
> (кожен воркер множить контейнери); `reporters: ['default']` (інакше Jest 30 у частині
> середовищ ховає `PASS`/назви тестів).

| Команда | Що робить |
|---|---|
| `npm run test:integration` | репо проти `postgres:16-alpine` (testcontainers): UNIQUE/FK/JOIN+GROUP BY |
| `npm run test:e2e` | повний Nest через supertest: happy (створити→прочитати) + негатив 404/400 |
| `npm run test:contract` | consumer-тести (GET /products/{id} + POST /orders) → `pacts/marketplace-web-marketplace-api.json` |
| `npm run verify:provider` | підняти реальний застосунок; `stateHandlers` сідають стан у стор провайдера (in-memory), Pact верифікує обидва interactions |

## Стратегія ізоляції — транзакція-ROLLBACK

Кожен integration-тест виконується в транзакції, яку `withRollback` **завжди відкочує**
(`BEGIN … ROLLBACK`). Схему створюють міграції один раз у `globalSetup`, а дані кожного тесту
зникають на `ROLLBACK` — тож тести не бачать одне одного й **повторний прогін suite поспіль
зелений без ручної чистки**. Це дешевше за `TRUNCATE` між тестами й за контейнер-на-файл.

## Брокер контрактів локально + гейт can-i-deploy

```bash
docker compose up -d --wait                       # серед сервісів — pact-broker (127.0.0.1:9292)
export PACT_BROKER_URL=http://127.0.0.1:9292
# publish контракту
curl -X PUT "$PACT_BROKER_URL/pacts/provider/marketplace-api/consumer/marketplace-web/version/1.0.0" \
  -H 'Content-Type: application/json' -d @pacts/marketplace-web-marketplace-api.json   # → 201
# верифікація провайдера з публікацією результату
PROVIDER_VERSION=1.0.0 bash scripts/with-secrets.sh dev npm run verify:provider        # → exit 0
#   (аварійна форма для грейдера: PACT_BROKER_URL=… SKIP_VAULT=1 npm run verify:provider)
```

Доказ, що гейт **справжній** (а не завжди-зелений) — can-i-deploy ДО і ПІСЛЯ тега prod:

```jsonc
// ДО тега: can-i-deploy ... to=prod  — немає prod-версії провайдера
{"deployable":null,"reason":"There is no verified pact between version 1.0.0 of marketplace-web and the latest version of marketplace-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}

// curl -X PUT "$PACT_BROKER_URL/pacticipants/marketplace-api/versions/1.0.0/tags/prod"  → 201

// ПІСЛЯ тега: той самий can-i-deploy
{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}
```

У CI ([`.github/workflows/contract.yml`](.github/workflows/contract.yml)) — **дві джоби**:

- **`contract`**: publish → `verify:provider` (`publishVerificationResult`) → гейт
  `can-i-deploy pacticipant=marketplace-api … to=prod`, який **валить джобу**, якщо `deployable` не `true`.
  Гейтимо САМЕ провайдера (цей репозиторій = `marketplace-api`): він зелений на успішній верифікації
  **без жодного prod-тега перед гейтом** — ніщо не «протягує» результат.
- **`deploy`** (`needs: contract`): запис розгортання — prod-тег версії провайдера ставиться **тут**,
  уже після зеленого гейта (а не перед ним). Брокер у CI ефемерний per-job, тож deploy-job
  відновлює стан (publish + verify) перед тегом; із постійним брокером лишився б самий тег.

Демо `unknown → true` вище показує, що гейт справжній: консюмерський `can-i-deploy` стає `true`
лише коли верифікована версія провайдера справді в prod (саме це й робить `deploy`-джоба).

## Секрети брокера

`PACT_BROKER_URL`/`PACT_BROKER_TOKEN` код читає **лише** з `process.env`: локально їх підкладає
обгортка `scripts/with-secrets.sh` зі сховища ДЗ #11, у CI — `secrets` GitHub. У репо токена
немає; локальний дефолт `http://127.0.0.1:9292` — це адреса власного compose-брокера, не секрет.
`DATABASE_URL` у тестах — окремий випадок: його видає testcontainer у рантаймі
(`container.getConnectionUri()`), сховища він не потребує.

## Контракт у git

`pacts/*.json` закомічено (грейдер бачить контракт одразу, без запуску consumer-тесту).
Регенерується `npm run test:contract`.

---

# Realtime (ДЗ №18 — WebSocket + SSE)

Подія «статус замовлення змінився» миттєво доходить до клієнта **двома транспортами** з
**однієї шини** (`OrderEventsService`: Subject + per-order буфер):

- **WebSocket** (`OrdersGateway`, socket.io): клієнт автентифікується `auth.userId`, шле
  `join {orderId}`; сервер кладе сокет у кімнату `orders:<id>` **лише якщо він власник**
  (аноніму/чужому — відмова). Зміна статусу емітить `order.status` **тільки в цю кімнату**.
- **SSE** (`GET /orders/:id/events`, `text/event-stream`): ті самі події з полем `id:`;
  доступ — **лише власнику** (header `X-User-Id`, та сама перевірка, що й у WS; чуже/анонімне → `403`
  `application/problem+json`). Реконект із `Last-Event-ID: N` → реплей пропущеного (`id > N`) з буфера;
  жива підписка відкривається **до** реплею, тож подія між реплеєм і підпискою не губиться.

Emit іде з **бізнес-логіки** зміни статусу (`OrdersService.changeStatus` → шина), не з контролера.
Per-order `seq`/`buffer` **очищаються на термінальному статусі** (`cancelled`/`completed`/`delivered`) —
замовлення завершене, подальших подій не буде, тож мапи не ростуть без межі.

## Запуск і демо

```bash
# застосунок in-memory → реальна БД не потрібна, лише задовольнити bootstrap
export DB_URL=postgres://marketplace@127.0.0.1:5432/marketplace
mkdir -p secrets && printf 'x' > secrets/db_password
npm start                 # → http://localhost:3000

# демо ізоляції кімнат (в іншому терміналі)
node scripts/realtime-demo.mjs              # A_RECEIVED=1  B_RECEIVED=0  exit=0
node scripts/realtime-demo.mjs --same-room  # A_RECEIVED=1  B_RECEIVED=1  exit=0

# SSE напряму — лише власник (header X-User-Id має збігатися з тим, хто створив замовлення)
curl -sN -H 'X-User-Id: <owner>' http://localhost:3000/orders/<order_id>/events
# без/з чужим X-User-Id → 403 application/problem+json
```

Контрольний `--same-room` іде тим самим кодом (прапорець вирішує і кімнату другого клієнта,
і очікуване `B_RECEIVED`) — тож скрипт не може просто друкувати константу.

## Trade-offs: WebSocket vs SSE

| Критерій | WebSocket (socket.io) | SSE |
|---|---|---|
| Напрям каналу | двобічний (клієнт ↔ сервер) | однобічний (сервер → клієнт) |
| Реконект / відновлення | вбудований reconnect, але повтор пропущених подій — руками | рідний `Last-Event-ID` → реплей пропущеного з коробки |
| Вимоги до інфраструктури | upgrade-протокол; за кластера потрібен Redis-адаптер; гірше з проксі | звичайний HTTP/1.1, проходить проксі/CDN без налаштувань |
| Ціна на подію | постійне з'єднання + overhead фреймів/heartbeat | дешевше; але HTTP/1.1 має ліміт з'єднань на домен |

**Висновок.** Для нашого сценарію (однобічні нотифікації «статус замовлення → клієнт») у
проді я лишив би **SSE**: простіша інфраструктура, рідний реконект із реплеєм (`Last-Event-ID`),
проходить проксі. WebSocket беру, коли реально потрібен двобічний канал (чат, спільне
редагування) — для одностороннього пушу це зайва складність.

## Два і більше інстансів

Кімнати socket.io і буфер подій тут **in-memory, per-instance**: клієнт на інстансі B не
почує подію, що емітнули на інстансі A, а SSE-буфер не матиме чужих подій. Лікується
**socket.io Redis-адаптером** (кросінстансний broadcast у кімнати) плюс спільною шиною/буфером
(Redis pub/sub) — підключиться на Лекції 23.

---

# Async-події через RabbitMQ (ДЗ #19)

У ДЗ #18 realtime доставляв лише тому, хто **зараз** підключений. Тут між сервісом і його
читачами з'являється **брокер**, який зберігає повідомлення до появи одержувача. За це
доводиться платити трьома окремими рахунками — і кожен має свою відповідь у коді:

| Рахунок | У чому проявляється | Чим платимо (у цьому репо) |
|---|---|---|
| Робота може **зникнути** | підтвердив рано (`autoAck`) — падіння забрало все у вікні | ручний `ack` **після** ефекту (`consumer.ts`, `noAck:false`) |
| Робота може виконатись **двічі** | `ack` не доїхав — брокер повернув повідомлення | **ідемпотентний ефект** (`effect.ts`, `INSERT … ON CONFLICT`) |
| Робота може **застрягти** | лист, що не обробиться ніколи, вічно гріє кластер | **DLQ як окремий контур** (`x-dead-letter-exchange` → DLX → DLQ) |

## Топологія

Оголошує її **споживач/бутстрап** (`topology.ts`), а не продюсер: продюсер не має знати,
хто його слухає. Routing key без відповідного binding — порожній звук (лист зникає, а
продюсер отримує позитивний confirm), тому binding робимо саме при оголошенні черги.

```
                 shop.events (topic)                 shop.events.dlx (fanout)
publisher ──order.placed──►  ├─ bind order.placed ─►  q.order.placed (quorum) ──reject──► ├─► q.order.placed.dlq
(confirm channel)            │                         x-dead-letter-exchange: shop.events.dlx
```

- **Публікація** (`publisher.ts`) — через **confirm-канал** (`createConfirmChannel` +
  колбек-підтвердження = `basic.ack` брокера). Без цього «опублікував» означає лише
  «віддав у сокет». Тіло — свідомий контракт (`eventId`, `type`, `occurredAt`, `data`),
  а не ORM-сутність через spread. `eventId` стабільний — саме за ним споживач упізнає дубль.
- **Споживач** (`consumer.ts`) — `noAck:false`, `ack` **після** ефекту; невалідне тіло →
  `reject(requeue=false)` → DLX → DLQ.
- Подія виходить із критичної бізнес-операції: `checkout.ts` викликає `emitOrderPlaced`
  **після `COMMIT`** (до коміту не публікуємо — інакше ризик події про замовлення, якого немає).

## prefetch

**`prefetch = 10`** (`topology.ts`). Обґрунтування за формулою `prefetch × час_обробки <
consumer_timeout`: ефект тут — один маленький `INSERT` (~одиниці мс), стоковий
`consumer_timeout` = 30 хв; `10 × ~5 мс ≈ 50 мс ≪ 30 хв`, тож конвеєр заповнений, а таймаут
недосяжний. Для **важких** задач (секунди на лист) ставили б `1`, щоб один споживач не
загрібав чергу й не пробивав таймаут; дефолтний `0` означає «без ліміту» — найгірший варіант.

## Числа трьох прогонів (мої)

| Демо | Вивід | Що доводить |
|---|---|---|
| `demo:publish` | `published=5 delivered=5 effect=5 acked=5 dlq=0 prefetch=10` | happy path: 5 подій → 5 ефектів → 5 ack, нічого в DLQ |
| `demo:dlq` | `rejected=1 work=0 dlq=1 dlq-reason=rejected effect=0` | отруєне повідомлення пішло в DLQ; причину прочитано з `x-first-death-reason` |
| `demo:duplicate` | `deliveries=2 effect=1 skipped=1` | дубль доставлено **двічі**, а ефект застосовано **один раз** |

Кожне демо **самоочисне** (purge черг + свіжі `eventId` на кожен прогін), друкує
`ключ=значення` по рядку й **само перевіряє** інваріант (`exit ≠ 0` при порушенні) —
проходить двічі поспіль без ручного чищення.

## Чому це at-least-once, а не exactly-once

**Exactly-once на рівні доставки не існує ні в кого** — і RabbitMQ його не дає. Брокер дає
**at-least-once доставку**: `ack` — це не «дійшло», це «я більше не вимагаю повтору».
Підтвердив рано — втрата; підтвердив пізно (а `ack` не доїхав) — повтор; третього немає.

Щоб результат усе ж був **один**, до at-least-once доставки я додав **ідемпотентний ефект**:
`INSERT INTO processed_events (event_id) … ON CONFLICT DO NOTHING`. Повторна доставка тієї
самої події вставляє 0 рядків — ефект мовчки пропускається. Разом:

> **at-least-once доставка + ідемпотентний ефект = exactly-once РЕЗУЛЬТАТ.**

Саме це видно очима в `demo:duplicate`: `deliveries=2`, але `effect=1`.

Сховище оброблених подій — **у Postgres, не в пам'яті процесу**: `Set`/`Map` живе рівно
стільки, скільки інстанс, і не існує між двома подами; таблиця ж переживає рестарт споживача.

**Ідемпотентність vs ключ ідемпотентності** (різні слова): *ідемпотентність* — властивість
операції (`UPDATE orders SET status='packed' WHERE id=42` ідемпотентний, `qty = qty - 1` — ні);
*ключ ідемпотентності* (`eventId`) — інструмент, яким неідемпотентну операцію роблять
безпечною для повтору. Тут ефект виражено через природний ключ, тож окремий дедуп не потрібен.

## Тип черги та DLQ

Робоча черга — **quorum** (`'x-queue-type':'quorum'`): durable за визначенням, підтримує
`delivery-limit`. DLQ показую детерміновано через `reject(requeue=false)` → причина
`rejected` (одна з чотирьох: `rejected | expired | maxlen | delivery_limit`). Повторну
доставку в `demo:duplicate` викликаю `nack(requeue=true)` **після** ефекту (імітація
падіння до того, як `ack` доїхав) — на quorum це не інкрементить delivery-count, тож
лист не йде в DLQ помилково, а просто повертається на другу доставку.

| Файл | Призначення |
|---|---|
| `src/events/topology.ts` | exchange + quorum-черга + binding + DLX; `x-dead-letter-exchange`, `prefetch` |
| `src/events/publisher.ts` | публікація через confirm-канал (`waitForConfirms`) |
| `src/events/consumer.ts` | споживач: `prefetch`, ручний `ack` після ефекту, `reject`→DLQ |
| `src/events/effect.ts` | `processed_events` + `INSERT … ON CONFLICT` (ідемпотентний ефект) |
| `src/events/order-placed.ts` | контракт події (`eventId`/`type`/`occurredAt`/`data`) + валідатор |
| `src/events/emit.ts` | місток `checkout` → публікація `order.placed` після `COMMIT` |
| `src/demo-publish.ts` / `demo-dlq.ts` / `demo-duplicate.ts` | три демо з контрактом виводу |

Команди запуску — у розділі [`## Grading`](#grading) (через `scripts/with-secrets.sh`,
`BROKER_URL` зі сховища ДЗ #11 або від грейдера з `SKIP_VAULT=1`).

---

# Outbox та ідемпотентність (ДЗ #22)

ДЗ #19 публікувало `order.placed` **після** `COMMIT` (`checkout` → `emitOrderPlaced`). Між
`COMMIT` бази й `publish` у брокер є проміжок, у який вміщається падіння процесу: замовлення
в базі є, подія назовні не пішла — **втрата**. Спільного `COMMIT` між Postgres і RabbitMQ не
існує. ДЗ #22 закриває цей проміжок **transactional outbox**-ом: подію пишемо рядком у таблицю
`outbox` **тією самою транзакцією**, що й замовлення, а окремий **relay**-воркер виносить її в
брокер. Платню за це — дублі на доставці — гасить **ідемпотентний ефект**.

> **at-least-once + ідемпотентний ефект = exactly-once РЕЗУЛЬТАТ.** Exactly-once дає не
> брокер, а те, що повторна доставка не змінює стан. У `checkout` post-commit `emitOrderPlaced`
> більше не шлях доставки — його замінив рядок у `outbox` всередині транзакції.

## Два боки «фейлу запису» (це серце ДЗ — їх не можна плутати)

| Демо | Що падає | Що має статись |
|---|---|---|
| `demo:crash-write` | **бізнес-запис**: транзакція валиться вже **після** `INSERT` у `outbox` | подія не виходить назовні взагалі; order і outbox-рядок зникають **разом** (один `COMMIT`) |
| ⭐ `demo:crash-relay` | **службовий запис** `published_at`: relay «вмирає» рівно **між** `publish` і `UPDATE` | подію опубліковано **вдруге**, а ефект лишився **один** |

`crash-relay` доводить, що доставка **at-least-once**, а exactly-once береться з ідемпотентного
ефекту, а не з брокера. **Форму обриву relay обрано змодельовану** — виняток рівно в точці між
`publish` і `UPDATE published_at` (крок 8 коду лекції), а не `kill -9`: критерій перевіряє
наслідок, а не спосіб, а змодельований обрив детермінований і не флакає в самоперевірці демо.

## Потік

```
checkout(): BEGIN
  UPDATE products stock-=q (захист від oversell) ; UPDATE users balance-=sum
  INSERT orders ; INSERT order_items ; INSERT tasks
  INSERT outbox (payload = toOrderPlacedEvent(order), published_at = NULL)  ← той самий COMMIT
COMMIT
        │
relay:  SELECT … WHERE published_at IS NULL ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED LIMIT N  →  publish → UPDATE published_at
        │
consumer (одна транзакція):
        INSERT processed_messages(message_id, consumer) ON CONFLICT DO NOTHING  ← рівень 2 (inbox)
        якщо вставили: INSERT order_confirmations(order_id) ON CONFLICT DO NOTHING  ← рівень 1 (природний ключ)
        COMMIT → ack
```

## Чому не можна поміняти місцями `publish` і `UPDATE published_at`

Якщо спершу позначити рядок винесеним (`UPDATE published_at`), а потім публікувати — відмова
`publish` (чи падіння між цими двома діями) дасть «позначили, але не віддали»: подія **втрачена
назавжди**, бо для relay вона вже не `NULL` і він її більше не підбере. У поточному ж порядку
(`publish` → `UPDATE`) та сама відмова залишає `published_at = NULL`, тож наступний прогін
виносить подію **вдруге**. Вибір тут не між «добре» і «погано», а між **дублем і втратою**:
дубль лікується дедуплікацією на консюмері, втрата не лікується нічим. Додатково: помилка
`publish` не означає, що лист не доставлено — загубитися могла відповідь брокера, — тому дедуп
на консюмері обовʼязковий незалежно від акуратності relay.

## Три рівні ідемпотентності

1. **Природний ключ (ефект).** Ефект — `INSERT INTO order_confirmations(order_id) ON CONFLICT
   DO NOTHING`: один рядок підтвердження на замовлення. Повтор нічого не змінює — на відміну від
   `UPDATE qty = qty - 1`, який на другій доставці зняв би вдвічі.
2. **Inbox (`processed_messages`).** Позначка `(message_id, consumer)` і сам ефект — в **одній**
   транзакції на одному клієнті пулу. Позначити в Redis, а ефект записати в Postgres — це знову
   dual write, тільки в профіль. Саме тому межа «позначив оброблене ↔ застосував ефект» тут
   закрита спільним `COMMIT`.
3. **Ключ на API-краю (`idempotency_keys`).** Той самий `Idempotency-Key` з ДЗ #9, тепер із
   серверною механікою **у БД** (не in-memory Map — те сховище не переживало б рестарт процесу
   й не було б спільним між інстансами). Два однакові запити з тим самим ключем → **одне**
   замовлення, одна подія, один ефект. `checkout()` клеймить ключ `INSERT … ON CONFLICT (key)
   DO NOTHING` у своїй транзакції; HTTP `POST /orders` ходить у ту саму таблицю (колонки
   `body_hash`/`response`: той самий ключ+тіло → replay збереженої відповіді, інше тіло → 422).
   Ключ ідентифікує **намір**: саме хеш тіла як КЛЮЧ схлопнув би два легітимні однакові
   замовлення в одне — тому ключем лишається заголовок, а `body_hash` лише стереже від підміни тіла.

## Числа трьох прогонів (мої)

```
demo:outbox        requests=2 orders=1 outbox=1 published=1 deliveries=1 effect=1 processed=1
demo:crash-write   write-failed=1 orders=0 outbox=0 published=0 deliveries=0 effect=0
demo:crash-relay   published=2 deliveries=2 applied=1 effect=1 processed=1
```

У `crash-relay` `deliveries=2` при `effect=1` — дубль справді стався, а ефект застосовано раз.

## Порядок, партиціонування і чистка

- **Порядок доставки не гарантований.** `SKIP LOCKED` розкидає рядки між воркерами, тож `ORDER
  BY created_at, id` задає лише порядок *вибірки*, не доставки. Порядок існує тільки в межах
  ключа партиціонування; тут він не потрібен (`order.placed` самодостатня).
- **Чому `published_at IS NULL`, а не курсор по `id`.** `bigint IDENTITY` видає номер на
  `nextval`, а видимим рядок стає на `COMMIT` — тож «усі `id` більші за останній оброблений»
  пропускав би рядки, що закомітились пізніше з меншим номером. Прапорець `NULL` такої діри не має.
- **Чистка `outbox`.** Таблиця росте й гальмує той самий частковий індекс, від якого залежить
  relay. План: періодично видаляти винесені старі рядки — `DELETE FROM outbox WHERE published_at
  < now() - interval '7 days'` (нічний cron). Частковий індекс `WHERE published_at IS NULL`
  індексує лише «хвіст», тож на швидкість relay обсяг винесених рядків не впливає, але місце й
  autovacuum — впливають.

## Debezium (чому snake_case тут безпечний)

Ролі полів `outbox` — ті, що читає Debezium Outbox Event Router, тож пізніший перехід на CDC не
перепише консюмерів. Канонічні імена в Debezium — **без** підкреслень (`aggregatetype`,
`aggregateid`), і саме `aggregatetype` стоїть у `route.by.field` за замовчуванням. Мій
snake_case (`aggregate_type`, `aggregate_id`) вимагав би явного перевизначення конектора:
`route.by.field=aggregate_type`, `table.field.event.key=aggregate_id`. Жоден із девʼяти
критеріїв на імена колонок не дивиться.

| Файл | Призначення |
|---|---|
| `src/migrations/1792681513324-Outbox.ts` | `outbox` + `processed_messages` + `order_confirmations` + `idempotency_keys`; частковий індекс `WHERE published_at IS NULL` |
| `src/migrations/1793120051983-IdempotencyResponse.ts` | колонки `body_hash`/`response` для серверного `Idempotency-Key` на HTTP-краю |
| `src/checkout.ts` | бізнес-рядок і рядок `outbox` одним `COMMIT`; `Idempotency-Key` на API-краю |
| `src/orders/orders.service.ts` | `POST /orders`: ключ ідемпотентності в БД `idempotency_keys`, а не in-memory Map |
| `src/outbox/relay.ts` | `FOR UPDATE SKIP LOCKED` → `publish` → `UPDATE published_at` (саме в цьому порядку) |
| `src/outbox/consumer.ts` | ефект через природний ключ + позначка в `processed_messages` в одній транзакції |
| `src/outbox/event.ts` | явний `toOrderPlacedEvent(order)` — контракт, а не spread ORM-сутності |
| `src/outbox/broker.ts` | виділена топологія ДЗ #22 (`outbox.events`) + confirm-publisher |
| `src/outbox/schema.ts` | фікстури демо + запобіжне `CREATE … IF NOT EXISTS` (канон — міграція) |
| `src/outbox/demo-outbox.ts` / `demo-crash-write.ts` / `demo-crash-relay.ts` | три демо з контрактом виводу |

---

# Redis: кеш, сесії, ліміти, черга (ДЗ #23)

Redis **не робить систему правильною — він робить її швидкою**. Та сама подія `order.placed`,
яку ДЗ #22 навчилось атомарно писати в outbox, тепер може поїхати в чергу BullMQ; а
найгарячіше читання API перестає щоразу ходити в базу. Чотири задачі — кеш, сесії, ліміт,
черга — на **двох** інстансах Redis, бо їхні політики витіснення несумісні.

## Чому ДВА інстанси Redis

| Інстанс | Політика | Для чого | Порт |
|---|---|---|---|
| `redis-cache` | `maxmemory 64mb` + **`allkeys-lru`** | cache-aside (картка товару) | `6391` |
| `redis-queue` | **`noeviction`** + AOF everysec | черга BullMQ, сесії, rate-limit | `6392` |

Кеш **вимагає** витіснення (`allkeys-lru`); BullMQ **вимагає протилежного** — документація прямо
каже, що черга «cannot work properly if Redis evicts keys arbitrarily», тому `noeviction`.
`maxmemory-policy` **одна на весь процес**, і `SELECT <n>` її не розводить (бази логічні, пам'ять
спільна) — тому це **два контейнери**, а не два номери бази в одному. Критерій 6 перевіряє це
поведінково: `demo:cache` друкує `cache-lru=1`, `demo:queue` — `queue-noeviction=1`; один інстанс
обидва дати не може. Сесії теж **не** в кеші: `allkeys-lru` колись викинув би сесію й дав
розлогінення, яке ніхто не відтворить, — тому сесії/ліміт на noeviction-інстансі разом із чергою.

## Що зроблено

1. **Cache-aside** на дорогому читанні (картка = продукт + залишок + агрегат проданого). Промах →
   БД → запис із **TTL+джитер** (`300 + rand(0..60)`с, розкид 60с): без джитера ключі, прогріті
   одним циклом, протухли б в одну секунду й дали stampede на порожньому місці. `cacheSet` у
   `try/catch` — кеш, який роняє запит на OOM, це не кеш.
2. **Single-flight лок проти stampede**: `SET lock:<key> <token> NX PX`, знімаємо **Lua
   compare-and-delete** (голий `DEL` зняв би чужий лок). ≥20 одночасних запитів на холодний ключ →
   **один** похід у базу; `db-calls` рахується на рівні репозиторію, а не «скільки викликів».
3. **Сесії** — хеш у Redis із **rolling TTL** (`EXPIRE` на кожному доступі): активний користувач
   не вилітає. Сховище — Redis (переживає рестарт процесу), інстанс — noeviction.
4. **Rate-limit — ковзне вікно одним Lua-скриптом**. Чому ця модель: запитання завжди «дозволяємо
   сплеск чи ні?» — ковзне вікно каже **ні** (фіксоване пропускало б до 2× ліміту на стику вікон).
   Тут атомарність — **вимога коректності**: між `ZCARD` і `ZADD` інакше влазить інший под, і ліміт
   протікає рівно під навантаженням. Лічильник у Redis → два поди ділять один ліміт; перевищення →
   `429` + `Retry-After`.
5. **Черга BullMQ**: `attempts:3` + exponential backoff з jitter; `jobId` для дедупу (два `add` →
   одна задача; `removeOnComplete` тримаємо `{age}`, бо `true` вимикає дедуп); планувальник через
   **`upsertJobScheduler`** (repeatable-API у BullMQ 6 прибрано; `upsert`, не `add`, — інакше кожен
   рестарт плодив би дублікати). Воркер — з `maxRetriesPerRequest:null`.

## Що станеться, якщо stampede-лок зламається (і чому тут це прийнятно)

Якщо лок у пункті 2 зламається — наприклад, процес завмер довше за TTL лока, той протух і його
взяв інший, — лавина запитів дасть **кілька паралельних походів у базу** замість одного. Ціна —
кілька зайвих центів і трохи навантаження, **стан не псується**: усі походи читають те саме й
пишуть у кеш те саме. Саме тому тут вистачає простого `SET NX` і не потрібен монотонний **fencing
token**: лок — це **оптимізація**, а не захист бізнес-інваріанта. Той самий `SET NX PX` у ролі
захисту інваріанта (напр. «не списати оплату двічі») коштував би **зіпсованого стану** — і такий
інваріант ми локом не захищаємо (його тримає транзакція + ідемпотентність із ДЗ #14/#22). Різниця
не в коді, а в ціні відмови: дубль у кеші лікується дедупом, зіпсований баланс — нічим.

## Числа моїх прогонів

```
demo:cache      cache-lru=1 cache-maxmemory=1 warmed=60 ttl-distinct=37 concurrent=30 db-calls=1 db-calls-warm=0
demo:session    requests=3 sessions=1 in-redis=1 ttl-renewed=1
demo:ratelimit  instances=2 limit=5 requests=12 allowed=5 blocked=7 status=429 retry-after=1
demo:queue      queue-noeviction=1 attempts=3 completed=1 added=2 queued=1 schedulers=1 scheduled-runs=2
```

`ttl-distinct` плаває від прогону до прогону (джитер) — без нього було б рівно 1. `db-calls=1`
натомість детерміноване: `SET NX` виграє рівно один клієнт.

| Файл | Призначення |
|---|---|
| `docker-compose.yml` | `redis-cache` (allkeys-lru + maxmemory) і `redis-queue` (noeviction + AOF) |
| `src/redis/cache.ts` | cache-aside, джитер-TTL, `db-calls`-лічильник на рівні репозиторію |
| `src/redis/lock.ts` | single-flight `SET NX PX` + Lua compare-and-delete |
| `src/redis/session.ts` | сесія-хеш із rolling TTL (noeviction-інстанс) |
| `src/redis/ratelimit.ts` | ковзне вікно одним атомарним Lua-скриптом |
| `src/redis/queue.ts` | BullMQ Queue/Worker: `attempts`, backoff, `jobId`-дедуп, scheduler |
| `src/redis/demo-cache.ts` / `demo-session.ts` / `demo-ratelimit.ts` / `demo-queue.ts` | чотири демо з контрактом виводу |
