const express = require('express');
const path = require('path');
const { middleware: OpenApiValidator } = require('express-openapi-validator');

const app = express();
app.use(express.json());

const products = [
  { id: 'prod_1', name: 'Кавоварка', price_cents: 2600, currency: 'UAH' },
  { id: 'prod_2', name: 'Електрочайник', price_cents: 1500, currency: 'UAH' },
  { id: 'prod_3', name: 'Кухоль', price_cents: 300, currency: 'UAH' },
];
const orders = [];
let orderSeq = 0;
const idempotencyStore = new Map();

app.use(
  OpenApiValidator({
    apiSpec: path.join(__dirname, './openapi/openapi.yaml'),
    validateRequests: true,
    validateResponses: true,
  })
);

app.get('/products', (req, res) => {
  res.json({ items: products, next_cursor: null });
});

app.get('/products/:id', (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) {
    const err = new Error(`Product ${req.params.id} not found`);
    err.status = 404;
    throw err;
  }
  res.json(product);
});

app.get('/orders/:id', (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    const err = new Error(`Order ${req.params.id} not found`);
    err.status = 404;
    throw err;
  }
  res.json(order);
});

app.post('/orders', (req, res) => {
  const key = req.headers['idempotency-key'];
  const bodyKey = JSON.stringify(req.body);
  const saved = idempotencyStore.get(key);
  if (saved) {
    if (saved.bodyKey === bodyKey) {
      res.set('Idempotency-Replay', 'true');
      return res.status(saved.status).json(saved.response);
    }
    const err = new Error(`Idempotency-Key '${key}' was already used with a different request body`);
    err.status = 422;
    throw err;
  }

  const items = req.body.items.map((line) => {
    const product = products.find((p) => p.id === line.product_id);
    if (!product) {
      const err = new Error(`Product ${line.product_id} not found`);
      err.status = 422;
      throw err;
    }
    return {
      product_id: product.id,
      quantity: line.quantity,
      unit_price_cents: product.price_cents,
    };
  });

  const total_cents = items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0);
  const currency = products.find((p) => p.id === items[0].product_id).currency;

  const order = {
    id: `order_${++orderSeq}`,
    status: 'created',
    items,
    total_cents,
    currency,
    created_at: new Date().toISOString(),
  };

  orders.push(order);
  idempotencyStore.set(key, { bodyKey, status: 201, response: order });
  res.status(201).json(order);
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  res
    .status(status)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: err.name || 'Error',
      status,
      detail: err.message || 'Unexpected error',
      instance: req.originalUrl,
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Marketplace API on http://localhost:${PORT}`);
});
