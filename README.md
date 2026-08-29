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
