# Marketplace API — ДЗ №1 (гілка `hw-09`)

Перше домашнє завдання курсового проєкту **Marketplace API**. Мета — спроєктувати
**контракт** (OpenAPI-спеку) ще до написання ендпойнтів і поставити «того, хто звіряє»,
щоб спека машинно перевірялась, а не залишалась просто файлом.

## Обраний варіант contract-частини: **ВАРІАНТ Б — runtime-валідація**

Мінімальний **Express**-сервер, де [`express-openapi-validator`](https://www.npmjs.com/package/express-openapi-validator)
валідує **запити й відповіді** проти нашої спеки, а error-handler перекладає його
помилки у `application/problem+json` (RFC 7807).

> Варіант А (consumer-driven Pact) свідомо **не** обрано.

Ключова деталь: увімкнено `validateResponses: true` — валідатор ловить **DRIFT** між тим,
що віддає хендлер, і схемою відповіді у спеці. Якщо імена полів розійдуться — це 500, а не
тихо зіпсована відповідь.

## Стек і версії

| Пакет | Версія | Навіщо |
|---|---|---|
| Node | v24.13.1 | стенд |
| npm | 11.8.0 | — |
| Модульна система | **CommonJS** (без `"type": "module"`) | приклади валідатора йдуть через `require(...)` |
| express | 4.22.2 | з express@4 валідатор працює без сюрпризів (express@5 — ні) |
| express-openapi-validator | 5.6.2 | runtime-валідація запитів і відповідей |
| @redocly/cli | 2.46.0 (dev) | lint + bundle спеки |
| nodemon | 3.1.x (dev) | автоперезапуск у розробці |

## Структура

```
marketplace/
├── openapi/
│   └── openapi.yaml    # спека: 2 ресурси, 5 операцій, cursor-пагінація,
│                       #        Idempotency-Key, problem+json
├── app.js              # Express + express-openapi-validator (Варіант Б)
├── package.json        # залежності + скрипти
├── README.md           # цей файл
├── CLAUDE.md           # опис завдання й домовленостей
└── .gitignore          # node_modules/, spec.json, ...
```

`spec.json` — це згенерований `redocly bundle` артефакт, тому він у `.gitignore`.

## Установка

```bash
npm install
```

## Запуск

```bash
npm start        # node app.js       -> http://localhost:3000
npm run dev      # nodemon app.js    -> те саме, з автоперезапуском
```

Доступні ендпойнти (in-memory дані): `GET /products`, `GET /products/{id}`,
`GET /orders`, `POST /orders`, `GET /orders/{id}`.

## Перевірки (acceptance criteria)

Усі проходять **після чистого `npm install`**, без ручних кроків.

### 1. Спека валідна (errors — ні; warnings можна)

```bash
npm run lint:spec
# або: npx @redocly/cli lint openapi/openapi.yaml   # exit code 0
```

### 2. Обсяг спеки (≥2 ресурси, ≥5 операцій, Idempotency-Key required з описом ≥40)

```bash
npm run bundle:spec
# або: npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];\
const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));\
const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));\
console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);\
console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
# очікуємо: операцій ≥ 5 · ресурсів ≥ 2 · required = true · опис ≥ 40
```

### 3. Idempotency-Key задекларовано

```bash
grep -c 'Idempotency-Key' openapi/openapi.yaml   # ≥ 1, і в POST це header required:true
```

### 4. Cursor-пагінація в контракті

```bash
grep -c 'next_cursor' openapi/openapi.yaml        # ≥ 1; спискова опер. має cursor+limit, items+next_cursor
```

### 5. problem+json скрізь у помилках

```bash
grep -c 'application/problem+json' openapi/openapi.yaml   # ≥ 2; у components.schemas є Problem
```

### 6. Варіант Б працює наживо

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

# 6c. Валідний запит -> 201 + Order
curl -s -i -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: key-123' \
  -d '{"items":[{"product_id":"prod_1","quantity":2},{"product_id":"prod_3","quantity":1}]}'
# 201; total_cents: 5500 (2×2600 + 1×300)
```

## Що містить контракт

- **2 ресурси / 5 операцій:** `/products` (list + get), `/orders` (list + create + get).
  Кожна операція має `operationId`, `summary` та описані відповіді, включно з помилками.
- **Cursor-пагінація** на `GET /products` і `GET /orders`: query `limit` + `cursor`
  (непрозорий токен), відповідь `{ items, next_cursor }`, де `next_cursor` **nullable**
  (`null` = сторінок більше немає).
- **Idempotency-Key** на `POST /orders`: header, `required: true`, опис із семантикою повтору.
- **problem+json** — кожна 4xx віддає `application/problem+json` зі схемою `Problem`
  (обовʼязкові поля: `type`, `title`, `status`, `detail`, `instance`).
- **Гроші — цілі копійки:** `price_cents`, `unit_price_cents`, `total_cents` — `integer`,
  не float і не рядок-decimal.
